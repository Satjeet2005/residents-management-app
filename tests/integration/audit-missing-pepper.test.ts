import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { createSession } from "@/server/auth/session-service";
import { T0, TEST_PEPPER, freshIp, makeUser, newPrisma } from "./auth-helpers";

/** D129: an ACCESS_DENIED row is written even when the address cannot be hashed (the pepper is missing). The 403 is the same either way. */
let prisma: PrismaClient;
beforeAll(() => {
  prisma = newPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const guards = createGuards(() => ({ db: prisma, sender: mockOtpSender, now: () => T0 }));
const staffOnly = guards.withPermission("STAFF", () => Response.json({ ok: true }));

async function setUpRefusal() {
  vi.stubEnv("OTP_PEPPER", TEST_PEPPER);
  vi.stubEnv("NODE_ENV", "test");
  const user = await makeUser(prisma, { role: "RESIDENT" });
  const session = await createSession(prisma, { id: user.id, role: "RESIDENT" }, T0);
  const ip = freshIp();
  const forbidden = async () => {
    const response = await staffOnly(new Request("http://localhost/api/thing", { headers: { cookie: `session=${session.token}`, "x-forwarded-for": ip } }));
    return { status: response.status, body: await response.json() };
  };
  return { user, ip, forbidden };
}
const rows = (userId: string) => prisma.auditLog.findMany({ where: { action: "ACCESS_DENIED", actorId: userId } });

describe("D129 access-denied audit and the address hash", () => {
  it("with the pepper set the row has the address hash, and it is not the address", async () => {
    const { user, ip, forbidden } = await setUpRefusal();
    expect(await forbidden()).toEqual({ status: 403, body: { error: "FORBIDDEN" } });
    const [row, ...more] = await rows(user.id);
    expect(more).toHaveLength(0);
    const detail = row.detail as Record<string, unknown>;
    expect(detail.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail).not.toHaveProperty("ipHashStatus");
    expect(JSON.stringify(detail)).not.toContain(ip);
  });

  it("with the pepper unset the 403 is unchanged and exactly one row is written, with no hash and ipHashStatus 'unavailable'", async () => {
    const { user, ip, forbidden } = await setUpRefusal();
    vi.stubEnv("OTP_PEPPER", undefined as unknown as string);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await forbidden()).toEqual({ status: 403, body: { error: "FORBIDDEN" } });
    const [row, ...more] = await rows(user.id);
    expect(more).toHaveLength(0);
    expect(row.detail).toEqual({ need: "STAFF", method: "GET", path: "/api/thing", ipHash: null, ipHashStatus: "unavailable" });
    expect(logged).toHaveBeenCalledWith("access denied audit: address hash unavailable");
    expect(logged).not.toHaveBeenCalledWith("access denied audit failed");
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain(ip);
    expect(text).not.toContain(TEST_PEPPER);
    expect(text).not.toContain("OTP_PEPPER");
  });

  it("a pepper that is too short in production fails the hash the same way and the row is still written", async () => {
    const { user, forbidden } = await setUpRefusal();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "short");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await forbidden()).status).toBe(403);
    expect((await rows(user.id))[0].detail).toMatchObject({ ipHash: null, ipHashStatus: "unavailable" });
  });

  it("a database failure of the audit write is still logged without data and the 403 stands", async () => {
    const { forbidden } = await setUpRefusal();
    vi.spyOn(prisma.auditLog, "create").mockRejectedValue(new Error("boom: secret detail"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await forbidden()).status).toBe(403);
    expect(logged).toHaveBeenCalledWith("access denied audit failed");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret detail");
  });
});
