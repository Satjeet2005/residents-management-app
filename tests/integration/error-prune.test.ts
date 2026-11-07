import { execFile } from "node:child_process";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createScratchDatabase, type ScratchDatabase } from "./scratch-database";

/** D135: `npm run db:prune-errors` as a real process against a fresh local database (township_test_*), never the shared one. */

let scratch: ScratchDatabase;
let owner: Client;

beforeAll(async () => {
  scratch = await createScratchDatabase();
  owner = new Client({ connectionString: scratch.url });
  await owner.connect();
  expect((await owner.query("SELECT current_database() AS name")).rows[0].name).toBe(scratch.name);
}, 60_000);
afterAll(async () => {
  await owner?.end();
  await scratch?.drop();
});

const AGES_IN_DAYS = [400, 40, 29, 1];
beforeEach(async () => {
  await owner.query("DELETE FROM error_events");
  for (const [i, days] of AGES_IN_DAYS.entries()) {
    await owner.query(
      "INSERT INTO error_events (ref, level, source, route, error_name, message, environment, fingerprint, occurred_at) VALUES ($1, 'ERROR', 'ROUTE', '/x', 'Error', 'm', 'test', 'f', now() - make_interval(days => $2))",
      [`E-PRN00${i}`, days],
    );
  }
});

const refs = async () => (await owner.query("SELECT ref FROM error_events ORDER BY ref")).rows.map((r) => r.ref as string);

function prune(args: string[], url: string | null = scratch.url): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...(url === null ? {} : { DATABASE_URL: url }) } as unknown as NodeJS.ProcessEnv;
    execFile("node_modules/.bin/tsx", ["scripts/prune-errors.ts", ...args], { env, cwd: process.cwd(), timeout: 20_000, encoding: "utf8" }, (error, out, err) => {
      resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, out, err });
    });
  });
}

describe("D135 db:prune-errors", () => {
  it("deletes the rows older than the default 30 days, prints only the number, and keeps the newer ones", async () => {
    const result = await prune(["--yes", `--confirm-database=${scratch.name}`]);
    expect(result).toMatchObject({ code: 0, out: "Deleted 2 rows.\n", err: "" });
    expect(await refs()).toEqual(["E-PRN002", "E-PRN003"]);
  });

  it("--days=7 deletes the 29 day old row too, and --days=365 only the 400 day old one", async () => {
    expect((await prune(["--days=365", "--yes", `--confirm-database=${scratch.name}`])).out).toBe("Deleted 1 rows.\n");
    expect(await refs()).toEqual(["E-PRN001", "E-PRN002", "E-PRN003"]);
    expect((await prune(["--days=7", "--yes", `--confirm-database=${scratch.name}`])).out).toBe("Deleted 2 rows.\n");
    expect(await refs()).toEqual(["E-PRN003"]);
  });

  it("nothing to delete is 0 rows", async () => {
    await prune(["--yes", `--confirm-database=${scratch.name}`]);
    expect((await prune(["--yes", `--confirm-database=${scratch.name}`])).out).toBe("Deleted 0 rows.\n");
  });

  it.each([
    ["without --yes", (name: string) => [`--confirm-database=${name}`]],
    ["without --confirm-database", () => ["--yes"]],
    ["with another database name", () => ["--yes", "--confirm-database=township"]],
    ["with --days=0", (name: string) => ["--days=0", "--yes", `--confirm-database=${name}`]],
    ["with --days=366", (name: string) => ["--days=366", "--yes", `--confirm-database=${name}`]],
    ["with an unknown option", (name: string) => ["--all", "--yes", `--confirm-database=${name}`]],
  ])("refuses %s, and deletes nothing", async (_title, args) => {
    const result = await prune(args(scratch.name));
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(await refs()).toHaveLength(4);
  });

  it("refuses without DATABASE_URL", async () => {
    const result = await prune(["--yes", `--confirm-database=${scratch.name}`], null);
    expect(result.code).toBe(1);
    expect(result.err).toContain("DATABASE_URL is not set");
  });

  it("refuses a hosted database without --allow-remote, naming neither the user nor the password", async () => {
    const result = await prune(["--yes", "--confirm-database=neondb"], "postgresql://owner:SuperSecretPw@ep-quiet-lake-123.neon.tech/neondb");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--allow-remote");
    expect(result.out + result.err).not.toMatch(/SuperSecretPw|owner:/);
  });

  it("the app role cannot do this itself: the delete needs the owner (see app-role.test.ts)", async () => {
    expect((await owner.query("SELECT has_table_privilege(current_user, 'error_events', 'DELETE') AS ok")).rows[0].ok).toBe(true);
  });
});
