import { execFile } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { dbPoolOptions } from "@/server/db-options";
import { createAppRole, createLogsRole, type TestAppRole } from "./app-role-helpers";
import { T0 } from "./auth-helpers";
import { connect } from "./db";

/**
 * D135, D136: the whole workflow. A request fails through the guard as the insert-only app role; the person is shown a reference; the developer, as the
 * read-only logs role, finds that reference with `npm run logs:errors -- --ref ... --paste`; and the secrets that were in the failure are in neither.
 */

const SECRET = "e2e-pepper-value-0123456789abcdef-xyz";
let owner: Client;
let appRole: TestAppRole;
let logsRole: TestAppRole;
let prisma: PrismaClient;

beforeAll(async () => {
  owner = await connect();
  appRole = await createAppRole(owner);
  logsRole = await createLogsRole(owner);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: appRole.url, ...dbPoolOptions({ DB_POOL_MAX: "2" }) }) });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma?.$disconnect();
  if (appRole) await appRole.drop();
  if (logsRole) await logsRole.drop();
  await owner?.end();
});

function cli(args: string[]): Promise<{ out: string; err: string }> {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LOGS_DATABASE_URL: logsRole.url } as unknown as NodeJS.ProcessEnv;
    execFile("node_modules/.bin/tsx", ["scripts/logs.ts", ...args], { env, cwd: process.cwd(), timeout: 20_000, encoding: "utf8" }, (_error, out, err) => resolve({ out, err }));
  });
}

describe("D135 the reference workflow", () => {
  it("a failing request gives a reference, and the developer finds that reference and its redacted detail with --paste", async () => {
    vi.stubEnv("OTP_PEPPER", SECRET);
    const guards = createGuards(() => ({ db: prisma, sender: mockOtpSender, now: () => T0 }));
    const route = guards.publicRoute(() => {
      throw Object.assign(new Error(`could not reach ${SECRET} for phone 9876543210`), { code: "08006" });
    });
    const response = await route(new Request("http://localhost/api/e2e/flow", { method: "POST", body: "9876543210", headers: { cookie: `session=${SECRET}` } }));
    vi.unstubAllEnvs();
    const { ref } = (await response.json()) as { ref: string };
    expect(response.status).toBe(500);

    const found = await cli([`--ref=${ref}`, "--paste"]);
    expect(found.out).toContain(`ref: ${ref}`);
    expect(found.out).toContain("route: /api/e2e/flow");
    expect(found.out).toContain("method: POST");
    expect(found.out).toContain("status: 500");
    expect(found.out).toContain("error code: 08006");
    expect(found.out).toContain("message: could not reach [secret] for phone [secret]");
    expect(found.out + found.err).not.toMatch(new RegExp(`${SECRET}|9876543210`));
  });

  it("the app role that wrote the row cannot read it back, and the logs role that reads it cannot write", async () => {
    const reader = await logsRole.open();
    const writer = await appRole.open();
    try {
      await expect(writer.query("SELECT count(*) FROM error_events")).rejects.toMatchObject({ code: "42501" });
      await expect(reader.query("DELETE FROM error_events")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await reader.end();
      await writer.end();
    }
  });
});
