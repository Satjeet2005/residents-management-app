import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { mockOtpSender, requestOtp, verifyOtp, type OtpDeps, type OtpSender } from "@/server/auth/otp-service";
import { T0, bytesForCode, codesInOrder, dumpTables, freshIp, freshPhone, makeUser, newPrisma, sixDigits, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => useAuthEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A sender that records what it was asked to send. */
function recordingSender() {
  const calls: { phone: string; code: string }[] = [];
  const sender: OtpSender = { async send(phone, code) { calls.push({ phone, code }); } };
  return { sender, calls };
}

const deps = (sender: OtpSender = mockOtpSender, randomBytes?: (n: number) => Uint8Array): OtpDeps => ({ db: prisma, sender, randomBytes });
const SECOND = 1000;
const rowsFor = (phone: string) => prisma.otpCode.findMany({ where: { phone }, orderBy: { createdAt: "asc" } });

describe("V1 requestOtp", () => {
  it("V1 a registered and an unregistered phone get identical answers", async () => {
    const registered = await makeUser(prisma);
    const unregistered = freshPhone();
    const ip = freshIp();
    const a = await requestOtp(deps(), { phoneInput: registered.phone, ip, now: T0 });
    const b = await requestOtp(deps(), { phoneInput: unregistered, ip, now: T0 });
    expect(a).toEqual({ status: "SENT", message: "OTP_SENT_GENERIC", retryAfterSeconds: 30 });
    expect(b).toEqual(a);
  });

  it("V1 the sender is called once for an active phone and never for an unregistered, inactive or invalid one", async () => {
    const active = await makeUser(prisma);
    const inactive = await makeUser(prisma, { active: false });
    const { sender, calls } = recordingSender();
    const ip = freshIp();
    await requestOtp(deps(sender), { phoneInput: active.phone, ip, now: T0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].phone).toBe(active.phone);
    await requestOtp(deps(sender), { phoneInput: freshPhone(), ip, now: T0 });
    await requestOtp(deps(sender), { phoneInput: inactive.phone, ip, now: T0 });
    await requestOtp(deps(sender), { phoneInput: "not a phone", ip, now: T0 });
    await requestOtp(deps(sender), { phoneInput: "+1 415 555 0132", ip, now: T0 });
    expect(calls).toHaveLength(1);
  });

  it("V1 a row is stored for registered, inactive and unregistered phones alike, and none for an invalid one", async () => {
    const active = await makeUser(prisma);
    const inactive = await makeUser(prisma, { active: false });
    const unknown = freshPhone();
    for (const phone of [active.phone, inactive.phone, unknown]) {
      await requestOtp(deps(), { phoneInput: phone, ip: freshIp(), now: T0 });
      const rows = await rowsFor(phone);
      expect(rows).toHaveLength(1);
      expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].requestedIpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].expiresAt.getTime()).toBe(T0 + 300 * SECOND);
    }
    const before = await prisma.otpCode.count();
    await requestOtp(deps(), { phoneInput: "12345", ip: freshIp(), now: T0 });
    expect(await prisma.otpCode.count()).toBe(before);
  });

  it("V1 an invalid format gives INVALID_PHONE", async () => {
    expect(await requestOtp(deps(), { phoneInput: "abc", ip: freshIp(), now: T0 })).toEqual({ status: "INVALID_PHONE" });
    expect(await requestOtp(deps(), { phoneInput: "", ip: freshIp(), now: T0 })).toEqual({ status: "INVALID_PHONE" });
  });

  it("V1 a sender that throws gives the same answer as one that works", async () => {
    const user = await makeUser(prisma);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: OtpSender = { async send() { throw new Error("provider down"); } };
    const result = await requestOtp(deps(failing), { phoneInput: user.phone, ip: freshIp(), now: T0 });
    expect(result).toEqual({ status: "SENT", message: "OTP_SENT_GENERIC", retryAfterSeconds: 30 });
  });

  it("V1 only the newest code stays valid: earlier unconsumed codes are retired in the same request", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 });
    await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 30 * SECOND });
    const rows = await rowsFor(user.phone);
    expect(rows.map((r) => r.consumedAt !== null)).toEqual([true, false]);
  });
});

describe("V1 demoCode", () => {
  it("V1 is returned only with DEMO_MODE exactly 'true' and a demo phone, and is the code the sender gets", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const demo = await makeUser(prisma, { phone: freshPhone(5) });
    const { sender, calls } = recordingSender();
    const result = await requestOtp(deps(sender, codesInOrder(739162)), { phoneInput: demo.phone, ip: freshIp(), now: T0 });
    expect(result).toEqual({ status: "SENT", message: "OTP_SENT_GENERIC", retryAfterSeconds: 30, demoCode: "739162" });
    expect(calls[0].code).toBe("739162");
  });

  it("V1 an unregistered demo phone gets a demoCode of the same shape", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const result = await requestOtp(deps(), { phoneInput: freshPhone(5), ip: freshIp(), now: T0 });
    expect(result).toMatchObject({ status: "SENT", demoCode: expect.stringMatching(/^[0-9]{6}$/) });
  });

  it.each(["false", "", "TRUE", "True", "1", "yes", " true"])("V1 DEMO_MODE=%j gives no demoCode", async (mode) => {
    vi.stubEnv("DEMO_MODE", mode);
    const demo = await makeUser(prisma, { phone: freshPhone(5) });
    const result = await requestOtp(deps(), { phoneInput: demo.phone, ip: freshIp(), now: T0 });
    expect(result).not.toHaveProperty("demoCode");
  });

  it("V1 a non-demo phone gets no demoCode even in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const user = await makeUser(prisma, { phone: freshPhone(9) });
    expect(await requestOtp(deps(), { phoneInput: user.phone, ip: freshIp(), now: T0 })).not.toHaveProperty("demoCode");
  });

  it("V1 the plain code is in no text column of otp_codes, audit_log or sessions, and in no log call", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const user = await makeUser(prisma, { phone: freshPhone(5) });
    const code = "739162";
    const result = await requestOtp(deps(mockOtpSender, codesInOrder(739162)), { phoneInput: user.phone, ip: freshIp(), now: T0 });
    expect(result).toMatchObject({ demoCode: code });
    await verifyOtp(deps(), { phoneInput: user.phone, code, ip: freshIp(), now: T0 + SECOND });
    await verifyOtp(deps(), { phoneInput: user.phone, code: "000000", ip: freshIp(), now: T0 + 2 * SECOND });
    expect(await dumpTables(prisma)).not.toContain(code);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
  });
});

describe("V2 limits (the clock is injected)", () => {
  it("V2 the cooldown refuses at 29,999 ms and allows at 30,000 ms", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 });
    expect(await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 29_999 })).toEqual({ status: "BLOCKED", reason: "COOLDOWN", retryAfterSeconds: 1 });
    expect(await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 30_000 })).toMatchObject({ status: "SENT" });
  });

  it("V2 a refused request is not recorded, so it cannot lengthen the wait", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 });
    await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 10_000 });
    expect(await rowsFor(user.phone)).toHaveLength(1);
  });

  it("V2 a phone may ask 5 times an hour; the 6th is PHONE_LIMIT with the wait until the first leaves the hour", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect(await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + i * 31 * SECOND })).toMatchObject({ status: "SENT" });
    }
    const sixth = await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 5 * 31 * SECOND });
    expect(sixth).toEqual({ status: "BLOCKED", reason: "PHONE_LIMIT", retryAfterSeconds: 3600 - 155 });
    expect(await requestOtp(deps(), { phoneInput: user.phone, ip, now: T0 + 3_600_000 })).toMatchObject({ status: "SENT" });
  });

  it("V2 an address may ask 30 times an hour for different phones; the 31st is IP_LIMIT", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      expect(await requestOtp(deps(), { phoneInput: freshPhone(), ip, now: T0 + i * SECOND })).toMatchObject({ status: "SENT" });
    }
    expect(await requestOtp(deps(), { phoneInput: freshPhone(), ip, now: T0 + 30 * SECOND })).toEqual({ status: "BLOCKED", reason: "IP_LIMIT", retryAfterSeconds: 3600 - 30 });
    expect(await requestOtp(deps(), { phoneInput: freshPhone(), ip: freshIp(), now: T0 + 30 * SECOND })).toMatchObject({ status: "SENT" });
  });

  it("V2 limits are the same for registered and unregistered phones", async () => {
    const registered = await makeUser(prisma);
    const ip = freshIp();
    for (const phone of [registered.phone, freshPhone()]) {
      await requestOtp(deps(), { phoneInput: phone, ip, now: T0 });
      expect(await requestOtp(deps(), { phoneInput: phone, ip, now: T0 + 1000 })).toMatchObject({ status: "BLOCKED", reason: "COOLDOWN" });
    }
  });
});

describe("V3 verifyOtp", () => {
  const MESSAGES = new Set(["OTP_NOT_ACCEPTED", "OTP_LOCKED", "TOO_MANY_REQUESTS"]);

  async function loginSetup(options: { active?: boolean; registered?: boolean } = {}) {
    const phone = options.registered === false ? freshPhone() : (await makeUser(prisma, { active: options.active ?? true, role: "STAFF", permissions: ["payments:match"] })).phone;
    const ip = freshIp();
    await requestOtp(deps(mockOtpSender, codesInOrder(246810)), { phoneInput: phone, ip, now: T0 });
    return { phone, ip, code: sixDigits(246810) };
  }
  const verify = (phone: string, code: string, now: number, ip = freshIp()) => verifyOtp(deps(), { phoneInput: phone, code, ip, now });

  it("V3 the right code logs in an active user, and returns who they are", async () => {
    const { phone, code } = await loginSetup();
    const result = await verify(phone, code, T0 + SECOND);
    expect(result).toMatchObject({ status: "OK", user: { role: "STAFF", active: true, name: "Test Person", permissions: ["payments:match"] } });
    expect((await rowsFor(phone))[0].consumedAt).not.toBeNull();
  });

  it("V3 a wrong code adds one attempt and is generic", async () => {
    const { phone } = await loginSetup();
    expect(await verify(phone, "000000", T0 + SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect((await rowsFor(phone))[0].attempts).toBe(1);
  });

  it("V3 ten concurrent wrong guesses never push attempts past 5 and lose none", async () => {
    const { phone } = await loginSetup();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => verify(phone, sixDigits(100 + i), T0 + SECOND)));
    expect((await rowsFor(phone))[0].attempts).toBe(5);
    for (const r of results) expect(r).toMatchObject({ status: "REFUSED" });
    expect(results.filter((r) => r.status === "REFUSED" && r.message === "OTP_NOT_ACCEPTED").length).toBeLessThanOrEqual(5);
  });

  it("V3 a code is locked after 5 wrong attempts, even when the right code is then typed", async () => {
    const { phone, code } = await loginSetup();
    for (let i = 0; i < 4; i++) expect(await verify(phone, sixDigits(i), T0 + SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect(await verify(phone, "000009", T0 + SECOND)).toEqual({ status: "REFUSED", message: "OTP_LOCKED" });
    expect(await verify(phone, code, T0 + 2 * SECOND)).toEqual({ status: "REFUSED", message: "OTP_LOCKED" });
    expect((await rowsFor(phone))[0].consumedAt).toBeNull();
  });

  it("V3 the code expires at exactly expiresAt", async () => {
    const a = await loginSetup();
    expect(await verify(a.phone, a.code, T0 + 300_000 - 1)).toMatchObject({ status: "OK" });
    const b = await loginSetup();
    expect(await verify(b.phone, b.code, T0 + 300_000)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
  });

  it("V3 a consumed code cannot be used again (replay)", async () => {
    const { phone, code } = await loginSetup();
    expect(await verify(phone, code, T0 + SECOND)).toMatchObject({ status: "OK" });
    expect(await verify(phone, code, T0 + 2 * SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
  });

  it("V3 two concurrent uses of one right code succeed once", async () => {
    const { phone, code } = await loginSetup();
    const results = await Promise.all([verify(phone, code, T0 + SECOND), verify(phone, code, T0 + SECOND)]);
    expect(results.filter((r) => r.status === "OK")).toHaveLength(1);
  });

  it("V3 an older code is rejected after a newer request", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    await requestOtp(deps(mockOtpSender, codesInOrder(111111)), { phoneInput: user.phone, ip, now: T0 });
    await requestOtp(deps(mockOtpSender, codesInOrder(222222)), { phoneInput: user.phone, ip, now: T0 + 30 * SECOND });
    expect(await verify(user.phone, "111111", T0 + 31 * SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect(await verify(user.phone, "222222", T0 + 32 * SECOND)).toMatchObject({ status: "OK" });
  });

  it("V3 a correct code for an unregistered phone is not accepted, and uses the code up", async () => {
    const { phone, code } = await loginSetup({ registered: false });
    expect(await verify(phone, code, T0 + SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect((await rowsFor(phone))[0].consumedAt).not.toBeNull();
  });

  it("V3 a correct code for an inactive user is not accepted, and uses the code up", async () => {
    const { phone, code } = await loginSetup({ active: false });
    expect(await verify(phone, code, T0 + SECOND)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect((await rowsFor(phone))[0].consumedAt).not.toBeNull();
  });

  it("V3 a phone that never asked for a code, and an invalid phone, get the same generic answer", async () => {
    expect(await verify(freshPhone(), "123456", T0)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect(await verify("nonsense", "123456", T0)).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
  });

  it("V3 every refusal is one of the three generic keys", async () => {
    const { phone, code } = await loginSetup();
    const seen = new Set<string>();
    for (const [guess, at] of [["000001", 1], ["000002", 2], ["000003", 3], ["000004", 4], ["000005", 5], [code, 6], [code, 400]] as const) {
      const r = await verify(phone, guess, T0 + at * SECOND);
      if (r.status === "REFUSED") seen.add(r.message);
    }
    for (const message of seen) expect(MESSAGES.has(message)).toBe(true);
    expect(seen).toEqual(new Set(["OTP_NOT_ACCEPTED", "OTP_LOCKED"]));
  });

  it("V3 bytesForCode round-trips", () => {
    expect(bytesForCode(123456).slice(0, 4)).toEqual(Uint8Array.from([0, 1, 226, 64]));
  });
});
