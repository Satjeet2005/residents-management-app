import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { sessionTokenHash } from "@/server/auth/crypto";
import { createSession, resolveSession, revokeAllSessions, revokeSession } from "@/server/auth/session-service";
import { T0, dumpTables, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  vi.unstubAllEnvs();
  useAuthEnv();
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function start(role: "RESIDENT" | "STAFF", options: { permissions?: string[] } = {}) {
  const user = await makeUser(prisma, { role, permissions: options.permissions });
  const session = await createSession(prisma, { id: user.id, role }, T0);
  return { user, ...session };
}
const stored = (sessionId: string) => prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
const rowVersion = async (sessionId: string) => (await prisma.$queryRaw<{ v: string }[]>`SELECT xmin::text AS v FROM sessions WHERE id = ${sessionId}::uuid`)[0].v;

describe("V4 createSession", () => {
  it("V4 stores only the hash: the raw token is nowhere in the database", async () => {
    const { token, sessionId } = await start("STAFF");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await stored(sessionId)).tokenHash).toBe(sessionTokenHash(token));
    expect(await dumpTables(prisma, ["sessions", "audit_log", "otp_codes", "users"])).not.toContain(token);
  });

  it("V4 sets the end by role: staff 12 hours, residents 30 days", async () => {
    const staff = await start("STAFF");
    const resident = await start("RESIDENT");
    expect(staff.expiresAt).toBe(T0 + 12 * HOUR);
    expect((await stored(staff.sessionId)).expiresAt.getTime()).toBe(T0 + 12 * HOUR);
    expect((await stored(resident.sessionId)).expiresAt.getTime()).toBe(T0 + 30 * DAY);
  });

  it("V4 two sessions for one user have different tokens", async () => {
    const user = await makeUser(prisma);
    const a = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    const b = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    expect(a.token).not.toBe(b.token);
  });
});

describe("V4 resolveSession", () => {
  it("V4 returns the user, role, active flag, name and permissions", async () => {
    const { token, sessionId, user } = await start("STAFF", { permissions: ["payments:match", "reports:view"] });
    const result = await resolveSession(prisma, token, T0 + SECOND);
    expect(result?.sessionId).toBe(sessionId);
    expect(result?.user).toMatchObject({ id: user.id, role: "STAFF", active: true, name: "Test Person" });
    expect(result?.user.permissions.sort()).toEqual(["payments:match", "reports:view"]);
  });

  it.each(["", "nonsense", "A".repeat(43)])("V4 an unknown token (%j) gives null", async (token) => {
    expect(await resolveSession(prisma, token, T0)).toBeNull();
  });

  it("V4 a staff session ends 30 minutes after the last visit, to the millisecond", async () => {
    const a = await start("STAFF");
    expect(await resolveSession(prisma, a.token, T0 + 30 * MINUTE - 1)).not.toBeNull();
    const b = await start("STAFF");
    expect(await resolveSession(prisma, b.token, T0 + 30 * MINUTE)).toBeNull();
  });

  it("V4 a staff session ends 12 hours after login even when kept busy", async () => {
    const { token, sessionId } = await start("STAFF");
    await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(T0 + 12 * HOUR - 1) } });
    expect(await resolveSession(prisma, token, T0 + 12 * HOUR - 1)).not.toBeNull();
    expect(await resolveSession(prisma, token, T0 + 12 * HOUR)).toBeNull();
  });

  it("V4 a resident session ends 14 days after the last visit and 30 days after login", async () => {
    const a = await start("RESIDENT");
    expect(await resolveSession(prisma, a.token, T0 + 14 * DAY - 1)).not.toBeNull();
    const b = await start("RESIDENT");
    expect(await resolveSession(prisma, b.token, T0 + 14 * DAY)).toBeNull();
    const c = await start("RESIDENT");
    await prisma.session.update({ where: { id: c.sessionId }, data: { lastSeenAt: new Date(T0 + 30 * DAY - 1) } });
    expect(await resolveSession(prisma, c.token, T0 + 30 * DAY - 1)).not.toBeNull();
    expect(await resolveSession(prisma, c.token, T0 + 30 * DAY)).toBeNull();
  });

  it("V4 last_seen_at is written at most once a minute: one UPDATE, then none until 60 s pass", async () => {
    const { token, sessionId } = await start("STAFF");
    const v0 = await rowVersion(sessionId);
    for (const at of [1, 10_000, 30_000, 59_999]) {
      await resolveSession(prisma, token, T0 + at);
      expect(await rowVersion(sessionId)).toBe(v0);
    }
    await resolveSession(prisma, token, T0 + 60_000);
    const v1 = await rowVersion(sessionId);
    expect(v1).not.toBe(v0);
    expect((await stored(sessionId)).lastSeenAt.getTime()).toBe(T0 + 60_000);
    await resolveSession(prisma, token, T0 + 60_000 + 59_999);
    expect(await rowVersion(sessionId)).toBe(v1);
    await resolveSession(prisma, token, T0 + 120_000);
    expect(await rowVersion(sessionId)).not.toBe(v1);
  });

  it("V4 a visit moves the idle clock: busy staff stay signed in past 30 minutes of wall time", async () => {
    const { token } = await start("STAFF");
    for (let minute = 25; minute <= 100; minute += 25) expect(await resolveSession(prisma, token, T0 + minute * MINUTE)).not.toBeNull();
    expect(await resolveSession(prisma, token, T0 + 100 * MINUTE + 30 * MINUTE)).toBeNull();
  });

  it("V4 a revoked session gives null", async () => {
    const { token, sessionId } = await start("RESIDENT");
    await revokeSession(prisma, sessionId, T0 + SECOND);
    expect(await resolveSession(prisma, token, T0 + 2 * SECOND)).toBeNull();
  });

  it("V4 a session of an inactive user gives null at once, with no revoke, and works again if they return", async () => {
    const { token, user } = await start("STAFF");
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await resolveSession(prisma, token, T0 + SECOND)).toBeNull();
    await prisma.user.update({ where: { id: user.id }, data: { active: true } });
    expect(await resolveSession(prisma, token, T0 + 2 * SECOND)).not.toBeNull();
  });

  it("V4 a role change is read on the next request", async () => {
    const { token, user } = await start("STAFF", { permissions: ["payments:match"] });
    await prisma.userPermission.deleteMany({ where: { userId: user.id } });
    expect((await resolveSession(prisma, token, T0 + SECOND))?.user.permissions).toEqual([]);
  });
});

describe("V4 logout and logout-all", () => {
  it("V4 revokeSession ends one device and leaves the other", async () => {
    const user = await makeUser(prisma);
    const phone = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    const laptop = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    await revokeSession(prisma, phone.sessionId, T0 + SECOND);
    expect(await resolveSession(prisma, phone.token, T0 + 2 * SECOND)).toBeNull();
    expect(await resolveSession(prisma, laptop.token, T0 + 2 * SECOND)).not.toBeNull();
  });

  it("V4 revoking twice keeps the first revoked time", async () => {
    const { sessionId } = await start("RESIDENT");
    await revokeSession(prisma, sessionId, T0 + SECOND);
    await revokeSession(prisma, sessionId, T0 + 9 * SECOND);
    expect((await stored(sessionId)).revokedAt?.getTime()).toBe(T0 + SECOND);
  });

  it("V4 revokeAllSessions ends every device of that user and nobody else's", async () => {
    const user = await makeUser(prisma);
    const other = await makeUser(prisma);
    const a = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    const b = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
    const bystander = await createSession(prisma, { id: other.id, role: "RESIDENT" }, T0);
    expect(await revokeAllSessions(prisma, user.id, T0 + SECOND)).toBe(2);
    expect(await resolveSession(prisma, a.token, T0 + 2 * SECOND)).toBeNull();
    expect(await resolveSession(prisma, b.token, T0 + 2 * SECOND)).toBeNull();
    expect(await resolveSession(prisma, bystander.token, T0 + 2 * SECOND)).not.toBeNull();
    expect(await revokeAllSessions(prisma, user.id, T0 + 3 * SECOND)).toBe(0);
  });
});
