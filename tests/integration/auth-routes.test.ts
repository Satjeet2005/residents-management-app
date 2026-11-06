import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { handleLogout, handleLogoutAll, handleOtpRequest, handleOtpVerify, type AuthRouteDeps } from "@/server/auth/handlers";
import { mockOtpSender, type OtpSender } from "@/server/auth/otp-service";
import { requestOtpBody, verifyOtpBody } from "@/server/auth/schemas";
import { sessionTokenHash } from "@/server/auth/crypto";
import { T0, TEST_PEPPER, dumpTables, freshIp, freshPhone, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
let clock = T0;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  useAuthEnv("true");
  vi.stubEnv("VERCEL", "1");
  clock = T0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const deps = (sender: OtpSender = mockOtpSender): AuthRouteDeps => ({ db: prisma, sender, now: () => clock });
const URL_BASE = "http://localhost/api/auth";

function post(path: string, body: unknown, options: { ip?: string; cookie?: string; origin?: string; raw?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-vercel-forwarded-for": options.ip ?? freshIp() };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  return new Request(`${URL_BASE}/${path}`, { method: "POST", headers, body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
}
const call = async (response: Response) => ({ status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers });
const demoUser = (options: Parameters<typeof makeUser>[1] = {}) => makeUser(prisma, { phone: freshPhone(5), ...options });

/** Asks for a code and logs in through the routes. Returns the cookie to send back. */
async function login(user: { phone: string }, returnTo?: string) {
  const asked = await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone })));
  const verified = await call(await handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: asked.body.demoCode, returnTo })));
  const setCookie = verified.headers.get("set-cookie") ?? "";
  return { verified, cookie: setCookie.split(";")[0], setCookie };
}

describe("V1 POST /api/auth/otp/request", () => {
  it("V1 a registered and an unregistered phone get the same status, headers and body shape", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const registered = await makeUser(prisma);
    const a = await call(await handleOtpRequest(deps(), post("otp/request", { phone: registered.phone })));
    const b = await call(await handleOtpRequest(deps(), post("otp/request", { phone: freshPhone() })));
    expect(a.status).toBe(200);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(a.body).toEqual({ message: "OTP_SENT_GENERIC", retryAfterSeconds: 30 });
    expect(a.headers.get("set-cookie")).toBeNull();
  });

  it("V1 an invalid phone is a 400 INVALID_PHONE", async () => {
    expect(await call(await handleOtpRequest(deps(), post("otp/request", { phone: "12345" })))).toMatchObject({ status: 400, body: { error: "INVALID_PHONE" } });
  });

  it("V1 the sender is called for an active phone only, through the route", async () => {
    const calls: string[] = [];
    const sender: OtpSender = { async send(phone) { calls.push(phone); } };
    const active = await makeUser(prisma);
    await handleOtpRequest(deps(sender), post("otp/request", { phone: active.phone }));
    await handleOtpRequest(deps(sender), post("otp/request", { phone: freshPhone() }));
    expect(calls).toEqual([active.phone]);
  });
});

describe("V2 limits through the route", () => {
  it("V2 a request inside the cooldown is a 429 with Retry-After", async () => {
    const user = await makeUser(prisma);
    const ip = freshIp();
    await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip }));
    clock = T0 + 29_999;
    const blocked = await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip })));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("1");
    expect(blocked.body).toEqual({ error: "TOO_MANY_REQUESTS", retryAfterSeconds: 1 });
    clock = T0 + 30_000;
    expect((await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip })))).status).toBe(200);
  });

  it("V2 the phone limit and the address limit give the same generic 429 body", async () => {
    const phoneUser = await makeUser(prisma);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      clock = T0 + i * 31_000;
      await handleOtpRequest(deps(), post("otp/request", { phone: phoneUser.phone }, { ip }));
    }
    clock = T0 + 5 * 31_000;
    const byPhone = await call(await handleOtpRequest(deps(), post("otp/request", { phone: phoneUser.phone }, { ip })));
    const crowdIp = freshIp();
    clock = T0;
    for (let i = 0; i < 30; i++) await handleOtpRequest(deps(), post("otp/request", { phone: freshPhone() }, { ip: crowdIp }));
    const byIp = await call(await handleOtpRequest(deps(), post("otp/request", { phone: freshPhone() }, { ip: crowdIp })));
    expect(byPhone.status).toBe(429);
    expect(byIp.status).toBe(429);
    expect(Object.keys(byPhone.body).sort()).toEqual(Object.keys(byIp.body).sort());
    expect(byPhone.body.error).toBe(byIp.body.error);
    expect(Number(byPhone.headers.get("retry-after"))).toBe(3600 - 155);
    expect(Number(byIp.headers.get("retry-after"))).toBe(3600);
  });
});

describe("V3 POST /api/auth/otp/verify", () => {
  it("V3 the right code gives 200, the role, a home redirect and a session cookie; the cookie holds only the token", async () => {
    const staff = await demoUser({ role: "STAFF" });
    const resident = await demoUser();
    const a = await login(staff);
    const b = await login(resident);
    expect(a.verified.status).toBe(200);
    expect(a.verified.body).toEqual({ role: "STAFF", redirectTo: "/staff" });
    expect(b.verified.body).toEqual({ role: "RESIDENT", redirectTo: "/" });
    expect(a.setCookie).toMatch(/^session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
    expect(b.setCookie).toContain(`Max-Age=${30 * 86400}`);
    const token = a.cookie.split("=")[1];
    expect(await prisma.session.count({ where: { tokenHash: sessionTokenHash(token) } })).toBe(1);
  });

  it("V3 a wrong code is a 400 with a generic key, a locked code OTP_LOCKED, and no cookie", async () => {
    const user = await demoUser();
    await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone })));
    const wrong = await call(await handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: "000000" })));
    expect(wrong).toMatchObject({ status: 400, body: { error: "OTP_NOT_ACCEPTED" } });
    expect(wrong.headers.get("set-cookie")).toBeNull();
    let last = wrong;
    for (let i = 1; i < 5; i++) last = await call(await handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: String(i).padStart(6, "0") })));
    expect(last.body).toEqual({ error: "OTP_LOCKED" });
  });

  it("V3 an unregistered phone, an unknown phone and a bad phone all get 400 OTP_NOT_ACCEPTED", async () => {
    const asked = await call(await handleOtpRequest(deps(), post("otp/request", { phone: freshPhone(5) })));
    const unregisteredPhone = (await prisma.otpCode.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).phone;
    const results = await Promise.all([
      call(await handleOtpVerify(deps(), post("otp/verify", { phone: unregisteredPhone, code: asked.body.demoCode }))),
      call(await handleOtpVerify(deps(), post("otp/verify", { phone: freshPhone(), code: "123456" }))),
      call(await handleOtpVerify(deps(), post("otp/verify", { phone: "nonsense", code: "123456" }))),
    ]);
    for (const r of results) expect(r).toMatchObject({ status: 400, body: { error: "OTP_NOT_ACCEPTED" } });
  });
});

describe("V5 redirects", () => {
  it("V5 a safe returnTo is kept", async () => {
    expect((await login(await demoUser({ role: "STAFF" }), "/staff/payments?month=2026-10")).verified.body.redirectTo).toBe("/staff/payments?month=2026-10");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/%2f%2fevil.com", "javascript:alert(1)", "/a\r\nSet-Cookie: x=y", "", `/${"a".repeat(300)}`])(
    "V5 the hostile returnTo %j goes to the role's home",
    async (returnTo) => {
      expect((await login(await demoUser(), returnTo)).verified.body.redirectTo).toBe("/");
      expect((await login(await demoUser({ role: "STAFF" }), returnTo)).verified.body.redirectTo).toBe("/staff");
    },
  );
});

describe("V5 bodies", () => {
  it("V5 zod rejects wrong types, oversized values and bad JSON with a generic 400", async () => {
    const cases: [string, string, unknown, string?][] = [
      ["request", "otp/request", { phone: 9876543210 }],
      ["request", "otp/request", {}],
      ["request", "otp/request", { phone: "9".repeat(33) }],
      ["request", "otp/request", null],
      ["request", "otp/request", [5]],
      ["request", "otp/request", undefined, "{not json"],
      ["request", "otp/request", undefined, ""],
      ["request", "otp/request", { phone: "9876543210", pad: "x".repeat(5000) }],
      ["verify", "otp/verify", { phone: "9876543210", code: "x".repeat(10_000) }],
      ["verify", "otp/verify", { phone: "9876543210", code: 123456 }],
      ["verify", "otp/verify", { phone: "9876543210", code: "12345" }],
      ["verify", "otp/verify", { phone: "9876543210", code: "1234567" }],
      ["verify", "otp/verify", { phone: "9876543210", code: "12345a" }],
      ["verify", "otp/verify", { phone: "9876543210", code: "123456", returnTo: 5 }],
      ["verify", "otp/verify", { phone: "9876543210", code: "123456", returnTo: "/".padEnd(2001, "a") }],
    ];
    for (const [, path, body, raw] of cases) {
      const handler = path.endsWith("request") ? handleOtpRequest : handleOtpVerify;
      const r = await call(await handler(deps(), post(path, body, { raw })));
      expect(r, `${path} ${JSON.stringify(body)?.slice(0, 40)}`).toEqual({ status: 400, body: { error: "INVALID_REQUEST" }, headers: expect.anything() });
    }
  });

  it("V5 extra fields are stripped by the schemas", () => {
    expect(requestOtpBody.parse({ phone: "9876543210", role: "STAFF", admin: true })).toEqual({ phone: "9876543210" });
    expect(verifyOtpBody.parse({ phone: "9876543210", code: "123456", role: "STAFF", active: true })).toEqual({ phone: "9876543210", code: "123456" });
  });

  it("V5 a request from another origin is refused, and from this origin is allowed", async () => {
    const user = await makeUser(prisma);
    expect(await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { origin: "https://evil.example" })))).toMatchObject({ status: 403, body: { error: "CSRF_BLOCKED" } });
    expect((await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { origin: "http://localhost" })))).status).toBe(200);
  });
});

describe("V4 logout and logout-all through the routes", () => {
  it("V4 logout ends the session, clears the cookie and answers 204; repeating it is harmless", async () => {
    const { cookie } = await login(await demoUser());
    clock = T0 + 1000;
    const out = await call(await handleLogout(deps(), post("logout", undefined, { cookie })));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/^session=; .*Max-Age=0/);
    const again = await call(await handleLogout(deps(), post("logout", undefined, { cookie })));
    expect(again.status).toBe(204);
    expect((await call(await handleLogoutAll(deps(), post("logout-all", undefined, { cookie })))).status).toBe(401);
  });

  it("V4 logout without a cookie is a 204 that clears the cookie", async () => {
    const out = await call(await handleLogout(deps(), post("logout", undefined)));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("V4 logout-all ends both devices of the person and not another person's", async () => {
    const user = await demoUser();
    const other = await demoUser();
    const phone = await login(user);
    clock = T0 + 31_000;
    const laptop = await login(user);
    const bystander = await login(other);
    clock = T0 + 90_000;
    const out = await call(await handleLogoutAll(deps(), post("logout-all", undefined, { cookie: phone.cookie })));
    expect(out.status).toBe(204);
    for (const device of [phone, laptop]) {
      expect((await call(await handleLogoutAll(deps(), post("logout-all", undefined, { cookie: device.cookie })))).status).toBe(401);
    }
    expect((await call(await handleLogoutAll(deps(), post("logout-all", undefined, { cookie: bystander.cookie })))).status).toBe(204);
  });

  it("V4 logout-all without a session is a 401 with a generic body", async () => {
    expect(await call(await handleLogoutAll(deps(), post("logout-all", undefined)))).toMatchObject({ status: 401, body: { error: "UNAUTHENTICATED" } });
  });

  it("V4 a logout from another origin is refused and the session stays", async () => {
    const { cookie } = await login(await demoUser());
    const refused = await call(await handleLogout(deps(), post("logout", undefined, { cookie, origin: "https://evil.example" })));
    expect(refused).toMatchObject({ status: 403, body: { error: "CSRF_BLOCKED" } });
    expect((await call(await handleLogoutAll(deps(), post("logout-all", undefined, { cookie })))).status).toBe(204);
  });
});

describe("V6 audit", () => {
  it("V6 rows are written for each event, with a masked phone and an address hash, and never a secret", async () => {
    const user = await demoUser({ role: "STAFF" });
    const ip = freshIp();
    const secrets: string[] = [TEST_PEPPER, user.phone, ip];

    const asked = await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip })));
    secrets.push(asked.body.demoCode);
    await handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: "000000" }, { ip }));
    clock = T0 + 10_000;
    expect((await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip })))).status).toBe(429);
    clock = T0 + 40_000;
    const next = await call(await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }, { ip })));
    const verified = await call(await handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: next.body.demoCode }, { ip })));
    const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0];
    secrets.push(next.body.demoCode, cookie.split("=")[1]);
    clock = T0 + 50_000;
    await handleLogout(deps(), post("logout", undefined, { cookie, ip }));
    clock = T0 + 80_000;
    const again = await login(user);
    secrets.push(again.cookie.split("=")[1]);
    clock = T0 + 90_000;
    await handleLogoutAll(deps(), post("logout-all", undefined, { cookie: again.cookie, ip }));

    const masked = `******${user.phone.slice(-4)}`;
    const rows = await prisma.auditLog.findMany({ where: { entityType: "auth", detail: { path: ["phone"], equals: masked } } });
    const actions = new Set(rows.map((r) => r.action));
    for (const action of ["OTP_REQUESTED", "OTP_BLOCKED", "LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGOUT", "LOGOUT_ALL"]) expect(actions.has(action), action).toBe(true);
    for (const row of rows) {
      expect(row.entityId).toBe(user.id);
      expect(row.actorId).toBe(user.id);
      expect(row.detail).toMatchObject({ phone: masked });
    }
    const everything = JSON.stringify(rows);
    for (const secret of secrets) expect(everything, `audit leaks ${secret.slice(0, 4)}...`).not.toContain(secret);
    expect(everything).toMatch(/"ipHash":"[0-9a-f]{64}"/);
    const wholeTable = await dumpTables(prisma, ["audit_log"]);
    for (const secret of secrets) expect(wholeTable, `audit_log leaks ${secret.slice(0, 4)}...`).not.toContain(secret);
  });

  it("V6 an unknown phone is audited with entity 'unknown' and no actor", async () => {
    const phone = freshPhone();
    await handleOtpRequest(deps(), post("otp/request", { phone }));
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "OTP_REQUESTED", detail: { path: ["phone"], equals: `******${phone.slice(-4)}` } } });
    expect(row.entityId).toBe("unknown");
    expect(row.actorId).toBeNull();
  });

  it("V6 a known user is audited with their id", async () => {
    const user = await makeUser(prisma);
    await handleOtpRequest(deps(), post("otp/request", { phone: user.phone }));
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "OTP_REQUESTED", actorId: user.id } });
    expect(row.entityId).toBe(user.id);
  });
});

describe("V7 the pepper fails closed", () => {
  it("V7 in production with the pepper missing or short, the first use throws and nothing is written", async () => {
    const user = await makeUser(prisma);
    for (const pepper of ["", "short"]) {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("OTP_PEPPER", pepper);
      const before = [await prisma.otpCode.count(), await prisma.auditLog.count(), await prisma.session.count()];
      await expect(handleOtpRequest(deps(), post("otp/request", { phone: user.phone }))).rejects.toThrow("OTP_PEPPER");
      await expect(handleOtpVerify(deps(), post("otp/verify", { phone: user.phone, code: "123456" }))).rejects.toThrow("OTP_PEPPER");
      expect([await prisma.otpCode.count(), await prisma.auditLog.count(), await prisma.session.count()]).toEqual(before);
    }
  });
});
