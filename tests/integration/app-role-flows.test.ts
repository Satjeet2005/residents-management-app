import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { createGuards } from "@/server/auth/guard";
import { handleLogout, handleLogoutAll, handleOtpRequest, handleOtpVerify, type AuthRouteDeps } from "@/server/auth/handlers";
import { buildMe } from "@/server/auth/me";
import { mockOtpSender, requestOtp, verifyOtp } from "@/server/auth/otp-service";
import { createSession, resolveSession, revokeAllSessions, revokeSession } from "@/server/auth/session-service";
import { dbPoolOptions } from "@/server/db-options";
import { connect } from "./db";
import { createAppRole, type TestAppRole } from "./app-role-helpers";
import { T0, addMember, codesInOrder, freshIp, freshPhone, makeFlat, makeUser, newPrisma, sixDigits, useAuthEnv } from "./auth-helpers";

/**
 * D95: the real auth services, run through a Prisma client that logs in as the APP role (not the owner), to prove the
 * grants are enough for everything the app does today. If a flow here fails with "permission denied", the matrix is
 * missing a privilege: that is a decision for a human, not something to widen quietly.
 */
let ownerClient: Client;
let role: TestAppRole;
let appPrisma: PrismaClient;
let ownerPrisma: PrismaClient;

beforeAll(async () => {
  ownerClient = await connect();
  role = await createAppRole(ownerClient);
  appPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: role.url, ...dbPoolOptions({ DB_POOL_MAX: "4" }) }) });
  ownerPrisma = newPrisma();
});
afterAll(async () => {
  await appPrisma?.$disconnect();
  await ownerPrisma?.$disconnect();
  if (role) await role.drop();
  await ownerClient?.end();
});
beforeEach(() => {
  useAuthEnv("true");
});
afterEach(() => vi.unstubAllEnvs());

const deps = (): AuthRouteDeps => ({ db: appPrisma, sender: mockOtpSender, now: () => T0 });
const guards = createGuards(() => deps());
const SECOND = 1000;

const post = (path: string, body?: unknown, cookie?: string) =>
  new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp(), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("D95 the auth services as the app role", () => {
  it("D95 requestOtp and verifyOtp: code stored, older codes retired, attempts counted, code used up, audit rows written", async () => {
    const user = await makeUser(ownerPrisma, { role: "STAFF", permissions: ["payments:match"] });
    const ip = freshIp();
    const first = await requestOtp({ db: appPrisma, sender: mockOtpSender, randomBytes: codesInOrder(246810, 135790) }, { phoneInput: user.phone, ip, now: T0 });
    expect(first).toMatchObject({ status: "SENT" });
    const second = await requestOtp({ db: appPrisma, sender: mockOtpSender, randomBytes: codesInOrder(135790) }, { phoneInput: user.phone, ip, now: T0 + 31 * SECOND });
    expect(second).toMatchObject({ status: "SENT" });
    const rows = await ownerPrisma.otpCode.findMany({ where: { phone: user.phone }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.consumedAt !== null)).toEqual([true, false]);

    const wrong = await verifyOtp({ db: appPrisma, sender: mockOtpSender }, { phoneInput: user.phone, code: "000000", ip, now: T0 + 32 * SECOND });
    expect(wrong).toEqual({ status: "REFUSED", message: "OTP_NOT_ACCEPTED" });
    expect((await ownerPrisma.otpCode.findUniqueOrThrow({ where: { id: rows[1].id } })).attempts).toBe(1);
    const right = await verifyOtp({ db: appPrisma, sender: mockOtpSender }, { phoneInput: user.phone, code: sixDigits(135790), ip, now: T0 + 33 * SECOND });
    expect(right).toMatchObject({ status: "OK", user: { role: "STAFF", permissions: ["payments:match"] } });
    expect((await ownerPrisma.otpCode.findUniqueOrThrow({ where: { id: rows[1].id } })).consumedAt).not.toBeNull();
    const audit = await ownerPrisma.auditLog.findMany({ where: { entityId: right.status === "OK" ? right.user.id : "" } });
    expect(audit.map((a) => a.action).sort()).toEqual(["LOGIN_FAILED", "OTP_REQUESTED", "OTP_REQUESTED"]);
  });

  it("D95 an unknown phone takes the same path (a row and an audit row are written)", async () => {
    const phone = freshPhone();
    expect(await requestOtp(deps(), { phoneInput: phone, ip: freshIp(), now: T0 })).toMatchObject({ status: "SENT" });
    expect(await ownerPrisma.otpCode.count({ where: { phone } })).toBe(1);
  });

  it("D95 ten concurrent wrong guesses stop at 5 attempts (the atomic UPDATE ... RETURNING)", async () => {
    const user = await makeUser(ownerPrisma);
    await requestOtp({ db: appPrisma, sender: mockOtpSender, randomBytes: codesInOrder(111222) }, { phoneInput: user.phone, ip: freshIp(), now: T0 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => verifyOtp(deps(), { phoneInput: user.phone, code: sixDigits(500 + i), ip: freshIp(), now: T0 + SECOND })));
    expect((await ownerPrisma.otpCode.findFirstOrThrow({ where: { phone: user.phone } })).attempts).toBe(5);
  });

  it("D95 createSession, resolveSession (with the touch), revokeSession and revokeAllSessions", async () => {
    const user = await makeUser(ownerPrisma, { role: "STAFF", permissions: ["reports:view"] });
    const a = await createSession(appPrisma, { id: user.id, role: "STAFF" }, T0);
    const b = await createSession(appPrisma, { id: user.id, role: "STAFF" }, T0);
    const seen = await resolveSession(appPrisma, a.token, T0 + 61 * SECOND);
    expect(seen?.user.permissions).toEqual(["reports:view"]);
    expect((await ownerPrisma.session.findUniqueOrThrow({ where: { id: a.sessionId } })).lastSeenAt.getTime()).toBe(T0 + 61 * SECOND);
    await revokeSession(appPrisma, a.sessionId, T0 + 62 * SECOND);
    expect(await resolveSession(appPrisma, a.token, T0 + 63 * SECOND)).toBeNull();
    expect(await revokeAllSessions(appPrisma, user.id, T0 + 64 * SECOND)).toBe(1);
    expect(await resolveSession(appPrisma, b.token, T0 + 65 * SECOND)).toBeNull();
  });

  it("D95 the whole login over the handlers: request, verify, /api/me data, 403 audit, logout-all", async () => {
    const user = await makeUser(ownerPrisma, { role: "RESIDENT", phone: freshPhone(5) });
    const flat = await makeFlat(ownerPrisma);
    await addMember(ownerPrisma, flat.id, user.id, "2020-01-01");
    const asked = await (await handleOtpRequest(deps(), post("auth/otp/request", { phone: user.phone }))).json();
    const verified = await handleOtpVerify(deps(), post("auth/otp/verify", { phone: user.phone, code: asked.demoCode }));
    expect(verified.status).toBe(200);
    const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0];

    const me = guards.withPermission("ANY_USER", async ({ user: u, deps: d, now }) => Response.json(await buildMe(d.db, u, now)));
    const mine = await me(new Request("http://localhost/api/me", { headers: { cookie } }));
    expect(await mine.json()).toMatchObject({ role: "RESIDENT", flats: [flat.code] });

    const staffOnly = guards.withPermission("payments:match", () => Response.json({}));
    expect((await staffOnly(new Request("http://localhost/api/x", { headers: { cookie } }))).status).toBe(403);
    expect(await ownerPrisma.auditLog.count({ where: { action: "ACCESS_DENIED", actorId: user.id } })).toBe(1);

    const logoutAll = guards.withPermission("ANY_USER", handleLogoutAll);
    expect((await logoutAll(post("auth/logout-all", undefined, cookie))).status).toBe(204);
    expect((await me(new Request("http://localhost/api/me", { headers: { cookie } }))).status).toBe(401);
    const actions = (await ownerPrisma.auditLog.findMany({ where: { actorId: user.id } })).map((a) => a.action).sort();
    expect(actions).toEqual(["ACCESS_DENIED", "LOGIN_SUCCEEDED", "LOGOUT_ALL", "OTP_REQUESTED"]);
  });

  it("D95 logout over the handler revokes the session and writes its audit row", async () => {
    const user = await makeUser(ownerPrisma, { role: "RESIDENT", phone: freshPhone(5) });
    const asked = await (await handleOtpRequest(deps(), post("auth/otp/request", { phone: user.phone }))).json();
    const verified = await handleOtpVerify(deps(), post("auth/otp/verify", { phone: user.phone, code: asked.demoCode }));
    const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await handleLogout(deps(), post("auth/logout", undefined, cookie))).status).toBe(204);
    expect(await ownerPrisma.auditLog.count({ where: { action: "LOGOUT", actorId: user.id } })).toBe(1);
  });
});

describe("D95 the same app role cannot do the damage the grants forbid, even through Prisma", () => {
  it("D95 a Prisma update or delete of the ledger or the audit log is refused", async () => {
    await expect(appPrisma.$executeRaw`UPDATE ledger_entries SET note = 'x'`).rejects.toThrow(/permission denied/i);
    await expect(appPrisma.$executeRaw`DELETE FROM audit_log`).rejects.toThrow(/permission denied/i);
    await expect(appPrisma.$executeRaw`ALTER TABLE ledger_entries DISABLE TRIGGER ALL`).rejects.toThrow(/must be owner|permission denied/i);
  });
});
