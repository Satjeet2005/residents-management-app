import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createGuards, type Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { handleApprove, handleIgnore, handleMatch, handleReject, handleSearchFlats } from "@/server/statements/reconciliation-handlers";
import { handleImport } from "@/server/statements/handlers";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { anonymousCredit, queuedRow, seedStaff } from "./reconciliation-helpers";
import { HEADER, csv } from "./statements-helpers";

/**
 * A-001: a NUL character (U+0000) in request text reached Postgres, which refuses it, and the answer was a 500. Every request text of the statement
 * and reconciliation routes now answers 400 INVALID_REQUEST, stores nothing, and answers normally without the character.
 */
let fx: PaymentsFixture;
let priyaCookie: string;
let rahulCookie: string;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  priyaCookie = await fx.signIn((await seedStaff(fx, "5000000001")).id, "STAFF", DEMO_NOW);
  rahulCookie = await fx.signIn((await seedStaff(fx, "5000000002")).id, "STAFF", DEMO_NOW);
}, 180_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const guards = () => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => DEMO_NOW }));
type Handler = (context: Parameters<Parameters<ReturnType<typeof guards>["withPermission"]>[1]>[0]) => Promise<Response>;
async function call(need: Need, handler: Handler, method: "GET" | "POST", path: string, cookie: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { host: "localhost", cookie };
  const init: RequestInit = { method, headers: body === undefined ? headers : { ...headers, "content-type": "application/json", origin: "http://localhost" }, body: body === undefined ? undefined : JSON.stringify(body) };
  return guards().withPermission(need, handler)(new Request(`http://localhost${path}`, init));
}
const NUL = "\u0000";
const invalid = async (response: Response) => {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
};

describe("A-001 POST /api/statements", () => {
  const statement = csv(anonymousCredit(123_400n));
  it("a NUL in the filename is 400 and no import is stored", async () => {
    const before = await fx.owner.statementImport.count();
    await invalid(await call("payments:match", (c) => handleImport(c, { now: DEMO_NOW }), "POST", "/api/statements", priyaCookie, { filename: `a${NUL}b.csv`, csv: statement }));
    expect(await fx.owner.statementImport.count()).toBe(before);
  });

  it("the same request without the NUL imports (200)", async () => {
    const response = await call("payments:match", (c) => handleImport(c, { now: DEMO_NOW }), "POST", "/api/statements", priyaCookie, { filename: "ok.csv", csv: statement });
    expect(response.status).toBe(200);
  });

  it("a NUL inside the CSV text is still the documented 422 INVALID_CSV (unchanged)", async () => {
    const response = await call("payments:match", (c) => handleImport(c, { now: DEMO_NOW }), "POST", "/api/statements", priyaCookie, { filename: "nul.csv", csv: `${HEADER}\n2026-10-27,UPI/1/a${NUL}b/x,10.00,` });
    expect(response.status).toBe(422);
  });
});

describe("A-001 the bank-row routes", () => {
  it("ignore: a NUL in the reason is 400, the row stays QUEUED at version 1 and no decision is stored", async () => {
    const row = await queuedRow(fx, 100_000n);
    await invalid(await call("payments:match", (c) => handleIgnore(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/ignore`, priyaCookie, { reason: `not ours${NUL}`, expectedVersion: 1 }));
    const after = await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.state, after.version]).toEqual(["QUEUED", 1]);
    expect(await fx.owner.paymentMatch.count({ where: { bankRowId: row.id } })).toBe(0);
  });

  it("ignore: the same request without the NUL works (200)", async () => {
    const row = await queuedRow(fx, 110_000n);
    const response = await call("payments:match", (c) => handleIgnore(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/ignore`, priyaCookie, { reason: "not ours at all", expectedVersion: 1 });
    expect(response.status).toBe(200);
  });

  it("match: a NUL in the reason or in the flat code is 400 and the row is unchanged", async () => {
    const row = await queuedRow(fx, 120_000n);
    await invalid(await call("payments:match", (c) => handleMatch(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/match`, priyaCookie, { flatCode: "T28-0101", reason: `Owner paid${NUL}`, rememberPayer: false, expectedVersion: 1 }));
    await invalid(await call("payments:match", (c) => handleMatch(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/match`, priyaCookie, { flatCode: `T28${NUL}0101`, reason: "Owner paid", rememberPayer: false, expectedVersion: 1 }));
    expect((await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } })).state).toBe("QUEUED");
  });

  it("reject and approve: a NUL in the reason or the note is 400", async () => {
    const row = await queuedRow(fx, 130_000n);
    await invalid(await call("payments:approve", (c) => handleReject(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/reject`, rahulCookie, { reason: `no${NUL}` }));
    await invalid(await call("payments:approve", (c) => handleApprove(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/approve`, rahulCookie, { note: `ok${NUL}` }));
  });

  it("reject without the NUL is read normally (not a 400)", async () => {
    const row = await queuedRow(fx, 140_000n);
    const response = await call("payments:approve", (c) => handleReject(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${row.id}/reject`, rahulCookie, { reason: "no request is waiting" });
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(500);
  });

  it("flat search: a NUL in q is 400; without it the search answers 200", async () => {
    await invalid(await call("payments:match", (c) => handleSearchFlats(c, { now: DEMO_NOW }), "GET", `/api/flats/search?q=${encodeURIComponent(`T28${NUL}`)}`, priyaCookie));
    const response = await call("payments:match", (c) => handleSearchFlats(c, { now: DEMO_NOW }), "GET", "/api/flats/search?q=T28", priyaCookie);
    expect(response.status).toBe(200);
  });
});
