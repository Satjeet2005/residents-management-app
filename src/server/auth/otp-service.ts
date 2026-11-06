import { CLIENT_MESSAGE_KEYS, authMessageKey, evaluateOtpAttempt, evaluateOtpRequest, otpFromRandom, type ClientMessageKey, type OtpRequestRefusal } from "@/domain/auth/otp";
import { isDemoPhone, normalizePhone } from "@/domain/auth/phone";
import { authPolicy, type Role } from "@/domain/auth/policy";
import { writeAuthAudit } from "./audit";
import { codeHash, hashesEqual, ipHash, randomBytesFor } from "./crypto";
import type { Db } from "./db";

const HOUR_MS = 3_600_000;
const otp = authPolicy.otp;

/** How a code reaches a person. The mock sender sends nothing and is the only implementation (D3). */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}
export const mockOtpSender: OtpSender = { async send() {} };

export type OtpDeps = {
  db: Db;
  sender: OtpSender;
  /** Random bytes for the code. Production leaves this out and gets the operating system's generator. */
  randomBytes?: (n: number) => Uint8Array;
};

export type RequestOtpResult =
  | { status: "INVALID_PHONE" }
  | { status: "BLOCKED"; reason: OtpRequestRefusal; retryAfterSeconds: number }
  | { status: "SENT"; message: typeof CLIENT_MESSAGE_KEYS.sent; retryAfterSeconds: number; demoCode?: string };

type LoginUser = { id: string; role: Role; active: boolean; name: string; permissions: string[] };

async function findUser(db: Db, phone: string): Promise<LoginUser | null> {
  const user = await db.user.findUnique({
    where: { phone },
    select: { id: true, role: true, active: true, name: true, permissions: { select: { permission: true } } },
  });
  return user === null ? null : { id: user.id, role: user.role, active: user.active, name: user.name, permissions: user.permissions.map((p) => p.permission) };
}

/**
 * Asks for a code. A phone that is not valid gets INVALID_PHONE (a format error says nothing about accounts).
 * Every other phone, registered or not, takes the same path: limits are checked, older codes are retired,
 * a new code row is stored, and the same answer is given. Only an active user is sent the code.
 * The plain code is returned (as demoCode) only when DEMO_MODE is exactly "true" and the phone is a demo
 * phone; it is never stored or logged.
 */
export async function requestOtp(deps: OtpDeps, input: { phoneInput: string; ip: string; now: number }): Promise<RequestOtpResult> {
  const { db } = deps;
  const phone = normalizePhone(input.phoneInput);
  if (phone === null) return { status: "INVALID_PHONE" };
  const ipH = ipHash(input.ip);
  const since = new Date(input.now - HOUR_MS);
  const [phoneRows, ipRows, user] = await Promise.all([
    db.otpCode.findMany({ where: { phone, createdAt: { gt: since } }, select: { createdAt: true } }),
    db.otpCode.findMany({ where: { requestedIpHash: ipH, createdAt: { gt: since } }, select: { createdAt: true } }),
    findUser(db, phone),
  ]);
  const decision = evaluateOtpRequest(
    { now: input.now, phoneRequestTimes: phoneRows.map((r) => r.createdAt.getTime()), ipRequestTimes: ipRows.map((r) => r.createdAt.getTime()) },
    otp,
  );
  if (!decision.allowed) {
    await writeAuthAudit(db, { action: "OTP_BLOCKED", userId: user?.id ?? null, phone, ipHash: ipH, reason: decision.reason, now: input.now });
    return { status: "BLOCKED", reason: decision.reason, retryAfterSeconds: decision.retryAfterSeconds };
  }

  const code = otpFromRandom(deps.randomBytes ?? randomBytesFor, otp.digits);
  const at = new Date(input.now);
  await db.$transaction(async (tx) => {
    await tx.otpCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: at } });
    await tx.otpCode.create({ data: { phone, codeHash: codeHash(phone, code), expiresAt: new Date(input.now + otp.ttlSeconds * 1000), requestedIpHash: ipH, createdAt: at } });
    await writeAuthAudit(tx, { action: "OTP_REQUESTED", userId: user?.id ?? null, phone, ipHash: ipH, reason: null, now: input.now });
  });

  if (user !== null && user.active) {
    try {
      await deps.sender.send(phone, code);
    } catch {
      // The answer must not depend on whether a code could be sent, or it would show that the phone has an account.
      console.error("otp sender failed");
    }
  }
  const sent = { status: "SENT", message: CLIENT_MESSAGE_KEYS.sent, retryAfterSeconds: otp.resendCooldownSeconds } as const;
  return process.env.DEMO_MODE === "true" && isDemoPhone(phone) ? { ...sent, demoCode: code } : sent;
}

export type VerifyOtpResult =
  | { status: "OK"; user: LoginUser }
  | { status: "REFUSED"; message: Exclude<ClientMessageKey, typeof CLIENT_MESSAGE_KEYS.sent> };

const NOT_ACCEPTED = { status: "REFUSED", message: CLIENT_MESSAGE_KEYS.notAccepted } as const;
const LOCKED = { status: "REFUSED", message: CLIENT_MESSAGE_KEYS.locked } as const;

/** Adds one attempt, but only while fewer than the maximum were used. One statement, so parallel guesses cannot exceed the limit. */
async function addAttempt(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${id}::uuid AND attempts < ${otp.maxAttempts} RETURNING attempts`;
  return rows.length === 1;
}

/** Uses the code up, once, while it is unused, unexpired and under the attempt limit. Zero rows means a replay or a race lost. */
async function consume(db: Db, id: string, now: Date): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE otp_codes SET consumed_at = ${now}::timestamptz
    WHERE id = ${id}::uuid AND consumed_at IS NULL AND attempts < ${otp.maxAttempts} AND expires_at > ${now}::timestamptz
    RETURNING id`;
  return rows.length === 1;
}

/**
 * Checks a code for the newest code row of the phone. The caller gets only generic keys: wrong, expired,
 * used, old, unknown phone, or a correct code for a phone with no active user all read OTP_NOT_ACCEPTED.
 * A correct code for a phone with no active user is still used up.
 */
export async function verifyOtp(deps: OtpDeps, input: { phoneInput: string; code: string; ip: string; now: number }): Promise<VerifyOtpResult> {
  const { db } = deps;
  const ipH = ipHash(input.ip);
  const phone = normalizePhone(input.phoneInput);
  if (phone === null) {
    hashesEqual(codeHash("0000000000", input.code), codeHash("0000000000", "dummy"));
    return NOT_ACCEPTED;
  }
  const [row, user] = await Promise.all([
    db.otpCode.findFirst({ where: { phone }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    findUser(db, phone),
  ]);
  const given = codeHash(phone, input.code);
  const codeMatches = hashesEqual(given, row?.codeHash ?? codeHash(phone, "dummy"));
  if (row === null) return NOT_ACCEPTED;

  const attempt = evaluateOtpAttempt({ now: input.now, expiresAt: row.expiresAt.getTime(), attempts: row.attempts, consumedAt: row.consumedAt?.getTime() ?? null, codeMatches }, otp);
  const audit = (reason: ClientMessageKey) =>
    writeAuthAudit(db, { action: "LOGIN_FAILED", userId: user?.id ?? null, phone, ipHash: ipH, reason, now: input.now });

  switch (attempt.outcome) {
    case "CONSUMED":
    case "EXPIRED":
      return NOT_ACCEPTED;
    case "LOCKED":
      return LOCKED;
    case "WRONG": {
      if (!(await addAttempt(db, row.id))) return LOCKED;
      const key = authMessageKey(attempt.attemptsLeft === 0 ? "LOCKED" : "WRONG");
      await audit(key);
      return attempt.attemptsLeft === 0 ? LOCKED : NOT_ACCEPTED;
    }
    case "OK": {
      if (!(await consume(db, row.id, new Date(input.now)))) return NOT_ACCEPTED;
      if (user === null || !user.active) {
        await audit(CLIENT_MESSAGE_KEYS.notAccepted);
        return NOT_ACCEPTED;
      }
      return { status: "OK", user };
    }
  }
}
