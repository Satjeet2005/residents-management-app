import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createGuards } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { handleImport, handleImportSample, handleSummary } from "@/server/statements/handlers";
import { importStatement } from "@/server/statements/import";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { DUE_ON_27_OCT, HEADER, csv, upiRow } from "./statements-helpers";

/** SI8: who may import, through the real guards, as the APP role. */
let fx: PaymentsFixture;
let matcher: string;
let reporter: string;
let resident: string;
let lockHolder: Client;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  matcher = (await fx.userByPhone("5000000001")).id; // Priya Nair: payments:match
  reporter = (await fx.owner.user.create({ data: { phone: "5444444444", name: "Reports Only", role: "STAFF", permissions: { create: [{ permission: "reports:view" }] } } })).id;
  resident = (await fx.makeResident()).user.id;
  lockHolder = new Client({ connectionString: fx.scratchUrl });
  await lockHolder.connect();
}, 120_000);
afterAll(async () => {
  await lockHolder?.end();
  await fx?.close();
}, 60_000);

const guards = () => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => DEMO_NOW }));
const post = async (cookie: string | null, body: unknown) => {
  const route = guards().withPermission("payments:match", (context) => handleImport(context, { now: DEMO_NOW }));
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost" };
  if (cookie !== null) headers.cookie = cookie;
  return route(new Request("http://localhost/api/statements", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
};
const get = async (cookie: string | null, id: string) => {
  const route = guards().withPermission("payments:match", (context) => handleSummary(context));
  return route(new Request(`http://localhost/api/statements/${id}`, { headers: cookie === null ? { host: "localhost" } : { host: "localhost", cookie } }));
};
const as = (userId: string, role: "STAFF" | "RESIDENT") => fx.signIn(userId, role, DEMO_NOW);

describe("SI8 who may import a statement", () => {
  it("a resident gets 403 and nothing is stored", async () => {
    const before = await fx.owner.statementImport.count();
    const response = await post(await as(resident, "RESIDENT"), { filename: "s.csv", csv: csv("2026-10-26,CASH,1.00,") });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    expect(await fx.owner.statementImport.count()).toBe(before);
  });

  it("staff without payments:match get 403", async () => {
    const response = await post(await as(reporter, "STAFF"), { filename: "s.csv", csv: csv("2026-10-26,CASH,1.00,") });
    expect(response.status).toBe(403);
    expect((await get(await as(reporter, "STAFF"), crypto.randomUUID())).status).toBe(403);
  });

  it("no session is 401", async () => {
    expect((await post(null, { filename: "s.csv", csv: csv() })).status).toBe(401);
    expect((await get(null, crypto.randomUUID())).status).toBe(401);
  });

  it("staff with payments:match get 200 and the summary, and the import ran as the app role (the privilege-limited login)", async () => {
    const who = await fx.app.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
    expect(who[0].user).toBe(fx.role.name);
    const flat = await fx.makeResident();
    const response = await post(await as(matcher, "STAFF"), { filename: "october.csv", csv: csv(upiRow(flat, DUE_ON_27_OCT), "2026-10-26,NEFT/ACME HOUSEKEEPING/INV 77,,25.00") });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ importId: expect.any(String), accounted: true, csvErrors: [], summary: { rowsRead: 2, validRows: 2, autoMatched: 1, ignored: 1, queued: 0, creditTotalPaise: "646800", autoMatchedTotalPaise: "646800" } });
    const summary = await get(await as(matcher, "STAFF"), body.importId);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ importId: body.importId, filename: "october.csv", accounted: true, summary: { autoMatched: 1, ignored: 1, validRows: 2 } });
  });
});

describe("the routes' answers", () => {
  const staff = () => as(matcher, "STAFF");

  it.each([
    ["not JSON", "{nope"],
    ["no filename", { csv: "x" }],
    ["an empty filename", { filename: "", csv: "x" }],
    ["a filename over 200 characters", { filename: "f".repeat(201), csv: "x" }],
    ["a csv that is not text", { filename: "s.csv", csv: 5 }],
  ])("%s is 400 INVALID_REQUEST", async (_label, body) => {
    const response = await post(await staff(), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("a bad header is 422 INVALID_CSV with the errors, and stores nothing", async () => {
    const before = await fx.owner.statementImport.count();
    const response = await post(await staff(), { filename: "s.csv", csv: "Date,Credit\n2026-10-26,5.00\n" });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("INVALID_CSV");
    expect(body.errors[0]).toMatchObject({ rowNumber: 0, column: "narration" });
    expect(await fx.owner.statementImport.count()).toBe(before);
  });

  it("a NUL byte is 422 INVALID_CSV", async () => {
    const response = await post(await staff(), { filename: "s.csv", csv: `${HEADER}\n2026-10-26,CASH\0,1.00,\n` });
    expect(response.status).toBe(422);
    expect((await response.json()).errors[0].message).toMatch(/NUL/);
  });

  it("a file over 2,000,000 characters is 413 TOO_LARGE, and so is one with over 20,000 rows", async () => {
    const big = await post(await staff(), { filename: "s.csv", csv: "x".repeat(2_000_001) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "TOO_LARGE" });
    const rows = await post(await staff(), { filename: "s.csv", csv: csv(...Array.from({ length: 20_001 }, (_x, i) => `2026-10-26,CASH ${i},1.00,`)) });
    expect(rows.status).toBe(413);
    const body = await post(await staff(), `{"filename":"s.csv","csv":"${"y".repeat(2_700_000)}"}`);
    expect(body.status).toBe(413);
  });

  it("another import holding the lock for longer than the wait is 409 IMPORT_IN_PROGRESS, and nothing is stored", async () => {
    const before = await fx.owner.statementImport.count();
    await lockHolder.query("BEGIN");
    await lockHolder.query("SELECT pg_advisory_xact_lock(hashtext('statement-import'))");
    try {
      const result = await importStatement({ db: fx.app, user: { id: matcher }, filename: "s.csv", csvText: csv("2026-10-26,CASH,1.00,"), now: DEMO_NOW, hooks: { lockTimeoutMs: 300 } });
      expect(result).toEqual({ status: "IMPORT_IN_PROGRESS" });
    } finally {
      await lockHolder.query("COMMIT");
    }
    expect(await fx.owner.statementImport.count()).toBe(before);
    expect((await importStatement({ db: fx.app, user: { id: matcher }, filename: "s.csv", csvText: csv("2026-10-26,CASH,1.00,"), now: DEMO_NOW })).status).toBe("IMPORTED");
  });

  it("GET with an id that is not a UUID, or not an import, is 404", async () => {
    expect((await get(await staff(), "not-a-uuid")).status).toBe(404);
    expect((await get(await staff(), crypto.randomUUID())).status).toBe(404);
  });
});

describe("the sample statement route (demo only)", () => {
  const sample = async (cookie: string | null, env: Record<string, string | undefined>) => {
    const route = guards().withPermission("payments:match", (context) => handleImportSample(context, { env, now: DEMO_NOW }));
    const headers: Record<string, string> = { host: "localhost" };
    if (cookie !== null) headers.cookie = cookie;
    return route(new Request("http://localhost/api/statements/sample", { method: "POST", headers }));
  };

  it("in demo mode it imports sample-statement.csv and answers like POST /api/statements", async () => {
    const response = await sample(await as(matcher, "STAFF"), { DEMO_MODE: "true" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ importId: expect.any(String), accounted: true, csvErrors: [], summary: { rowsRead: expect.any(Number), validRows: expect.any(Number), autoMatched: expect.any(Number), queued: expect.any(Number), ignored: expect.any(Number) } });
    const stored = await fx.owner.statementImport.findUniqueOrThrow({ where: { id: body.importId } });
    expect(stored.filename).toBe("sample-statement.csv");
    expect(stored.uploadedById).toBe(matcher);
  });

  it.each([["unset", undefined], ["false", "false"], ["TRUE", "TRUE"], ["1", "1"], ["a space", "true "]])("DEMO_MODE %s is 404 NOT_FOUND and stores nothing", async (_label, value) => {
    const before = await fx.owner.statementImport.count();
    const response = await sample(await as(matcher, "STAFF"), { DEMO_MODE: value });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
    expect(await fx.owner.statementImport.count()).toBe(before);
  });

  it("a resident and staff without payments:match are 403, and no session is 401, even in demo mode", async () => {
    expect((await sample(await as(resident, "RESIDENT"), { DEMO_MODE: "true" })).status).toBe(403);
    expect((await sample(await as(reporter, "STAFF"), { DEMO_MODE: "true" })).status).toBe(403);
    expect((await sample(null, { DEMO_MODE: "true" })).status).toBe(401);
  });
});
