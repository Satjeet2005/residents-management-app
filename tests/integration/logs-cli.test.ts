import { execFile } from "node:child_process";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readErrorEvents, type Queryable } from "@/server/error-reader";
import { createLogsRole, type TestAppRole } from "./app-role-helpers";
import { connect } from "./db";

/** D135: `npm run logs:errors` run as a real process against a seeded database, with the real read-only logs role. */

let owner: Client;
let role: TestAppRole;
const TAG = `/cli-${Date.now().toString(36)}`;

type Seed = { ref: string; level?: string; source?: string; route?: string; digest?: string | null; requestId?: string | null; message?: string; stack?: string | null; ageMs?: number };
async function seed(row: Seed): Promise<void> {
  await owner.query(
    `INSERT INTO error_events (ref, level, source, route, digest, request_id, error_name, error_code, message, stack, method, status, deployment, environment, fingerprint, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'Error', '42P01', $7, $8, 'POST', 500, 'abcdef0', 'test', 'f', now() - ($9 || ' milliseconds')::interval)`,
    [row.ref, row.level ?? "ERROR", row.source ?? "ROUTE", `${TAG}${row.route ?? "/a"}`, row.digest ?? null, row.requestId ?? null, row.message ?? "relation does not exist", row.stack ?? "at run (/app/x.ts:1:1)", String(row.ageMs ?? 1000)],
  );
}

beforeAll(async () => {
  owner = await connect();
  role = await createLogsRole(owner);
  await seed({ ref: "E-CLI001", route: "/pay", digest: "5550001111", requestId: "req-aaa" });
  await seed({ ref: "E-CLI002", level: "WARN", source: "PROVIDER", route: "/classifier", message: "provider breaker opened" });
  await seed({ ref: "E-CLI003", route: "/old", ageMs: 3 * 86_400_000 });
  await seed({ ref: "E-CLI004", route: "/dirty", message: "phone 9876543210 mail a@b.com token=abc123", stack: `at x (${"k".repeat(40)}:1:1)` });
}, 30_000);
afterAll(async () => {
  if (role) await role.drop();
  await owner?.end();
});

type Result = { code: number; out: string; err: string };
function run(args: string[], env: Record<string, string | undefined> = { LOGS_DATABASE_URL: role.url }): Promise<Result> {
  return new Promise((resolve) => {
    const clean = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } as unknown as NodeJS.ProcessEnv;
    for (const [key, value] of Object.entries(env)) if (value !== undefined) clean[key] = value;
    execFile("node_modules/.bin/tsx", ["scripts/logs.ts", ...args], { env: clean, cwd: process.cwd(), timeout: 20_000, encoding: "utf8" }, (error, out, err) => {
      resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, out, err });
    });
  });
}

describe("D135 logs:errors", () => {
  it("refuses to run without LOGS_DATABASE_URL, and says so in a sentence", async () => {
    const result = await run([], {});
    expect(result.code).toBe(1);
    expect(result.err).toContain("LOGS_DATABASE_URL is not set");
    expect(result.out).toBe("");
  });

  it("prints the host and the database name, never the user or the password", async () => {
    const result = await run([`--route=${TAG}`]);
    const url = new URL(role.url);
    expect(result.err).toContain(`host ${url.host}, database ${url.pathname.slice(1)}`);
    for (const secret of [url.username, url.password]) expect(result.out + result.err).not.toContain(secret);
  });

  it("lists the recent events of a route, newest first, and leaves out an event older than 24 hours", async () => {
    const result = await run([`--route=${TAG}`]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("E-CLI001");
    expect(result.out).toContain("E-CLI002");
    expect(result.out).not.toContain("E-CLI003");
  });

  it("--since=7d includes it", async () => {
    expect((await run([`--route=${TAG}/old`, "--since=7d"])).out).toContain("E-CLI003");
    expect((await run([`--route=${TAG}/old`, "--since=24h"])).out).toContain("No error events matched");
  });

  it("filters by --ref, --digest, --request-id, --level, --source and --route", async () => {
    expect((await run(["--ref=E-CLI001"])).out).toMatch(/^.*E-CLI001.*$/m);
    expect((await run(["--ref=E-CLI001"])).out).not.toContain("E-CLI002");
    expect((await run(["--digest=5550001111"])).out).toContain("E-CLI001");
    expect((await run(["--request-id=req-aaa"])).out).toContain("E-CLI001");
    const warn = await run([`--route=${TAG}`, "--level=warn"]);
    expect(warn.out).toContain("E-CLI002");
    expect(warn.out).not.toContain("E-CLI001");
    expect((await run([`--route=${TAG}`, "--source=PROVIDER"])).out).toContain("E-CLI002");
    expect((await run([`--route=${TAG}/CLASS`])).out).toContain("E-CLI002");
  });

  it("--limit caps the rows", async () => {
    const result = await run([`--route=${TAG}`, "--since=7d", "--limit=2"]);
    expect(result.out.trim().split("\n")).toHaveLength(2);
  });

  it("--paste prints one plain-text block per event with the fields to paste", async () => {
    const result = await run(["--ref=E-CLI001", "--paste"]);
    for (const field of ["ref: E-CLI001", "level: ERROR", "source: ROUTE", `route: ${TAG}/pay`, "method: POST", "status: 500", "error name: Error", "error code: 42P01", "message: relation does not exist", "stack:", "deployment: abcdef0", "digest: 5550001111"]) {
      expect(result.out).toContain(field);
    }
  });

  it("--json prints valid JSON", async () => {
    const parsed = JSON.parse((await run(["--ref=E-CLI001", "--json"])).out) as { ref: string }[];
    expect(parsed.map((row) => row.ref)).toEqual(["E-CLI001"]);
  });

  it("redacts again: a phone number, an e-mail address, a token and a long key in the table never reach the output", async () => {
    for (const mode of ["--paste", "--json", ""]) {
      const result = await run(["--ref=E-CLI004", ...(mode === "" ? [] : [mode])]);
      expect(result.out).toContain("E-CLI004");
      expect(result.out).not.toMatch(/9876543210|a@b\.com|abc123|k{32}/);
    }
  });

  it("an empty result is a plain sentence", async () => {
    const result = await run(["--ref=E-NOPE99"]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("No error events matched. Widen --since or drop a filter.");
  });

  it("refuses a bad option without touching the database", async () => {
    const result = await run(["--since=2h"], { LOGS_DATABASE_URL: "postgresql://nobody:x@127.0.0.1:1/none" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("--since must be one of");
  });

  it("a wrong connection string is a sentence with a code, never the string", async () => {
    const result = await run([], { LOGS_DATABASE_URL: "postgresql://nobody:SuperSecretPw@127.0.0.1:1/none" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("could not be read");
    expect(result.out + result.err).not.toContain("SuperSecretPw");
  });
});

describe("D135 the reader runs in a READ ONLY transaction", () => {
  it("the SELECT runs while transaction_read_only is on, and a write in that transaction is refused", async () => {
    const reader = await role.open();
    const seen: string[] = [];
    let writeState: string | null = null;
    const probe: Queryable = {
      query: async (text, values) => {
        if (!text.startsWith("SELECT ref")) return reader.query(text, values);
        seen.push((await reader.query("SHOW transaction_read_only")).rows[0].transaction_read_only);
        const answer = await reader.query(text, values);
        // A write attempted inside the same transaction (it aborts the transaction, so it comes last).
        writeState = await reader.query("CREATE TEMP TABLE t (a int)").then(() => null, (e: { code?: string }) => e.code ?? "no-code");
        return answer;
      },
    };
    try {
      await readErrorEvents(probe, { since: "24h", limit: 1 }, Date.now());
    } finally {
      await reader.end();
    }
    expect(seen).toEqual(["on"]);
    expect(writeState).toBe("25006");
  });
});
