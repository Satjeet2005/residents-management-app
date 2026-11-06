import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { runAction } from "@/server/auth/access";
import type { Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createSession, revokeSession } from "@/server/auth/session-service";
import { T0, makeUser, newPrisma, useAuthEnv } from "./auth-helpers";

let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(() => prisma.$disconnect());
beforeEach(() => {
  vi.unstubAllEnvs();
  useAuthEnv();
});

const deps = () => ({ db: prisma, sender: mockOtpSender, now: () => T0 });
const meta = (cookie: string | null, referer: string | null = "http://localhost/staff/payments?month=10") => ({ cookie, referer, ipHeaders: new Headers() });
const double = async (_ctx: unknown, n: number) => n * 2;
const run = (cookie: string | null, need: Need, referer?: string | null) => runAction(deps(), meta(cookie, referer), need, double, [21]);

async function signIn(role: "RESIDENT" | "STAFF", permissions: string[] = []) {
  const user = await makeUser(prisma, { role, permissions });
  const session = await createSession(prisma, { id: user.id, role }, T0);
  return { user, cookie: `session=${session.token}`, sessionId: session.sessionId };
}

describe("D81 runAction (the core of withPermissionAction)", () => {
  it("D81 no session gives UNAUTHENTICATED and the action does not run", async () => {
    let ran = false;
    const result = await runAction(deps(), meta(null), "ANY_USER", async () => { ran = true; return 1; }, []);
    expect(result).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(ran).toBe(false);
  });

  it("D81 a person who passes gets the action's result, and the context carries the user", async () => {
    const { user, cookie } = await signIn("STAFF", ["payments:match"]);
    expect(await run(cookie, "payments:match")).toEqual({ ok: true, data: 42 });
    const seen = await runAction(deps(), meta(cookie), "STAFF", async (ctx) => ctx.user.id, []);
    expect(seen).toEqual({ ok: true, data: user.id });
  });

  it("D82 a resident on a staff action gets FORBIDDEN and an ACCESS_DENIED row with method ACTION and the Referer's path", async () => {
    const { user, cookie } = await signIn("RESIDENT");
    expect(await run(cookie, "STAFF")).toEqual({ ok: false, error: "FORBIDDEN" });
    const rows = await prisma.auditLog.findMany({ where: { action: "ACCESS_DENIED", actorId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ need: "STAFF", method: "ACTION", path: "/staff/payments" });
    expect(JSON.stringify(rows)).not.toContain("month=10");
  });

  it("D82 a missing or odd Referer is recorded as path unknown", async () => {
    const { user, cookie } = await signIn("RESIDENT");
    await run(cookie, "STAFF", null);
    await run(cookie, "STAFF", "not a url");
    const rows = await prisma.auditLog.findMany({ where: { action: "ACCESS_DENIED", actorId: user.id } });
    expect(rows.map((r) => (r.detail as { path: string }).path)).toEqual(["/unknown", "/unknown"]);
  });

  it("D81 a revoked session is refused on the very next call", async () => {
    const { cookie, sessionId } = await signIn("STAFF");
    expect(await run(cookie, "STAFF")).toMatchObject({ ok: true });
    await revokeSession(prisma, sessionId, T0 + 1);
    expect(await run(cookie, "STAFF")).toEqual({ ok: false, error: "UNAUTHENTICATED" });
  });
});
