import type { OtpPolicy } from "./policy";

/** Bytes are asked for in batches of four words. A rejected word is rare, so one batch almost always suffices. */
const BATCH_BYTES = 16;
const WORD_COUNT = 2 ** 32;
/** After this many rejected words the byte source is treated as broken. */
export const MAX_REJECTED_WORDS = 1000;

/**
 * A numeric one-time code of `digits` digits, with leading zeros kept.
 *
 * Each 32-bit big-endian word is accepted only when it is below floor(2^32 / 10^digits) * 10^digits.
 * That makes every code equally likely: a plain modulo would favour the codes below 2^32 mod 10^digits.
 * The caller supplies the random bytes (the server uses the operating system's generator), so this
 * function stays pure and testable. It throws a RangeError when the digit count is not an integer
 * from 4 to 9, when the source returns the wrong number of bytes, and when MAX_REJECTED_WORDS words
 * have been rejected in one call.
 */
export function otpFromRandom(nextBytes: (n: number) => Uint8Array, digits: number): string {
  if (!Number.isInteger(digits) || digits < 4 || digits > 9) {
    throw new RangeError(`digits must be an integer from 4 to 9, got ${digits}`);
  }
  const modulus = 10 ** digits;
  const limit = Math.floor(WORD_COUNT / modulus) * modulus;
  let rejected = 0;
  for (;;) {
    const bytes = nextBytes(BATCH_BYTES);
    if (bytes.length !== BATCH_BYTES) throw new RangeError(`nextBytes(${BATCH_BYTES}) returned ${bytes.length} bytes`);
    for (let at = 0; at < BATCH_BYTES; at += 4) {
      const word = bytes[at] * 2 ** 24 + bytes[at + 1] * 2 ** 16 + bytes[at + 2] * 2 ** 8 + bytes[at + 3];
      if (word < limit) return String(word % modulus).padStart(digits, "0");
      rejected += 1;
      if (rejected >= MAX_REJECTED_WORDS) throw new RangeError(`${MAX_REJECTED_WORDS} random words were rejected`);
    }
  }
}

const HOUR_MS = 3_600_000;

export type OtpRequestRefusal = "COOLDOWN" | "PHONE_LIMIT" | "IP_LIMIT";
export type OtpRequestDecision = { allowed: true } | { allowed: false; reason: OtpRequestRefusal; retryAfterSeconds: number };

/** Whole seconds, rounded up, and never less than 1 so a client is never told to retry "now". */
const secondsUntil = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

/**
 * When must the caller wait before another request in a one-hour window?
 * `times` are the earlier requests (epoch ms, any order). Ones after `now` are ignored, and so is one
 * that is a full hour old or older. A request is allowed while fewer than `limit` remain.
 * The wait is until enough of the oldest have left the window to get below the limit; with exactly
 * `limit` requests that is until the oldest leaves.
 */
function windowWait(times: readonly number[], now: number, limit: number): number | null {
  const inWindow = times.filter((t) => t <= now && now - t < HOUR_MS).sort((a, b) => a - b);
  if (inWindow.length < limit) return null;
  const mustLeave = inWindow[inWindow.length - limit];
  return secondsUntil(mustLeave + HOUR_MS - now);
}

/**
 * May a code be sent? Checks in this order: COOLDOWN (this phone asked less than the cooldown ago),
 * PHONE_LIMIT, IP_LIMIT. The caller records every request it answers, for registered and
 * unregistered phones alike, so the answer never shows which phones have an account.
 */
export function evaluateOtpRequest(
  input: { now: number; phoneRequestTimes: readonly number[]; ipRequestTimes: readonly number[] },
  policy: OtpPolicy,
): OtpRequestDecision {
  const { now } = input;
  const past = input.phoneRequestTimes.filter((t) => t <= now);
  if (past.length > 0) {
    const elapsed = now - Math.max(...past);
    const cooldownMs = policy.resendCooldownSeconds * 1000;
    if (elapsed < cooldownMs) return { allowed: false, reason: "COOLDOWN", retryAfterSeconds: secondsUntil(cooldownMs - elapsed) };
  }
  const phoneWait = windowWait(input.phoneRequestTimes, now, policy.maxRequestsPerPhonePerHour);
  if (phoneWait !== null) return { allowed: false, reason: "PHONE_LIMIT", retryAfterSeconds: phoneWait };
  const ipWait = windowWait(input.ipRequestTimes, now, policy.maxRequestsPerIpPerHour);
  if (ipWait !== null) return { allowed: false, reason: "IP_LIMIT", retryAfterSeconds: ipWait };
  return { allowed: true };
}

export type OtpAttemptOutcome = "OK" | "WRONG" | "EXPIRED" | "LOCKED" | "CONSUMED";

/**
 * What happens when someone enters a code. Checks in this order: CONSUMED (a code works once),
 * EXPIRED (at exactly `expiresAt` it is already expired), LOCKED (too many attempts, even when this
 * code is right), then OK or WRONG. The caller adds one to `attempts` after a WRONG answer.
 * `attemptsLeft` is what remains after this answer: 0 for CONSUMED, EXPIRED and LOCKED.
 */
export function evaluateOtpAttempt(
  input: { now: number; expiresAt: number; attempts: number; consumedAt: number | null; codeMatches: boolean },
  policy: OtpPolicy,
): { outcome: OtpAttemptOutcome; attemptsLeft: number } {
  const { now, expiresAt, attempts, consumedAt, codeMatches } = input;
  if (consumedAt !== null) return { outcome: "CONSUMED", attemptsLeft: 0 };
  if (now >= expiresAt) return { outcome: "EXPIRED", attemptsLeft: 0 };
  if (attempts >= policy.maxAttempts) return { outcome: "LOCKED", attemptsLeft: 0 };
  if (codeMatches) return { outcome: "OK", attemptsLeft: policy.maxAttempts - attempts };
  return { outcome: "WRONG", attemptsLeft: policy.maxAttempts - (attempts + 1) };
}

/** What the client may be told. These are deliberately few, so a response never shows why a code failed. */
export const CLIENT_MESSAGE_KEYS = {
  sent: "OTP_SENT_GENERIC",
  notAccepted: "OTP_NOT_ACCEPTED",
  locked: "OTP_LOCKED",
  tooManyRequests: "TOO_MANY_REQUESTS",
} as const;
export type ClientMessageKey = (typeof CLIENT_MESSAGE_KEYS)[keyof typeof CLIENT_MESSAGE_KEYS];

/** An outcome that needs a message. A code that is accepted needs none. */
export type AuthOutcome = "SENT" | OtpRequestRefusal | Exclude<OtpAttemptOutcome, "OK">;

/**
 * The one message key for an outcome. A sent code reads the same for a registered and an
 * unregistered phone. A wrong, expired or already used code reads the same. All three request
 * refusals read the same, so the client cannot tell a phone limit from an address limit.
 */
export function authMessageKey(outcome: AuthOutcome): ClientMessageKey {
  switch (outcome) {
    case "SENT":
      return CLIENT_MESSAGE_KEYS.sent;
    case "WRONG":
    case "EXPIRED":
    case "CONSUMED":
      return CLIENT_MESSAGE_KEYS.notAccepted;
    case "LOCKED":
      return CLIENT_MESSAGE_KEYS.locked;
    case "COOLDOWN":
    case "PHONE_LIMIT":
    case "IP_LIMIT":
      return CLIENT_MESSAGE_KEYS.tooManyRequests;
  }
}
