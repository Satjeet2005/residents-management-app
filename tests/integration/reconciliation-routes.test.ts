import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { createGuards, type Need } from "@/server/auth/guard";
import { mockOtpSender } from "@/server/auth/otp-service";
import { importStatement } from "@/server/statements/import";
import {
  handleApprove,
  handleIgnore,
  handleListImports,
  handleListRows,
  handleMatch,
  handleReject,
  handleReview,
  handleSearchFlats,
} from "@/server/statements/reconciliation-handlers";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { type PaymentsFixture, createPaymentsFixture } from "./payments-fixture";
import { newStaff, queuedRow, seedStaff } from "./reconciliation-helpers";

/** The reconciliation routes (MP6 access, and the status mapping), through the real guards and the APP role, with the real permissions. */
let fx: PaymentsFixture;
let priyaCookie: string;
let rahulCookie: string;
let reportsCookie: string;
let residentCookie: string;
let sampleImportId: string;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  const priya = await seedStaff(fx, "5000000001");
  const rahul = await seedStaff(fx, "5000000002");
  const reports = await newStaff(fx, ["reports:view"]);
  priyaCookie = await fx.signIn(priya.id, "STAFF", DEMO_NOW);
  rahulCookie = await fx.signIn(rahul.id, "STAFF", DEMO_NOW);
  reportsCookie = await fx.signIn(reports.id, "STAFF", DEMO_NOW);
  residentCookie = await fx.signIn((await fx.userByPhone("5000000007")).id, "RESIDENT", DEMO_NOW);
  const result = await importStatement({ db: fx.app, user: { id: priya.id }, filename: "sample.csv", csvText: getSampleStatement(), now: DEMO_NOW });
  if (result.status !== "IMPORTED") throw new Error(result.status);
  sampleImportId = result.importId;
}, 180_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const guards = () => createGuards(() => ({ db: fx.app, sender: mockOtpSender, now: () => DEMO_NOW }));
type Handler = (context: Parameters<Parameters<ReturnType<typeof guards>["withPermission"]>[1]>[0]) => Promise<Response>;
const ZERO = "00000000-0000-4000-8000-000000000000";

/** The same wrapper and permission as the route file (a static test below proves the files say so). */
async function call(need: Need, handler: Handler, method: "GET" | "POST", path: string, cookie: string | null, body?: unknown): Promise<Response> {
  const route = guards().withPermission(need, handler);
  const headers: Record<string, string> = { host: "localhost", ...(cookie === null ? {} : { cookie }) };
  const init: RequestInit = { method, headers: body === undefined ? headers : { ...headers, "content-type": "application/json", origin: "http://localhost" }, body: body === undefined ? undefined : JSON.stringify(body) };
  return route(new Request(`http://localhost${path}`, init));
}
const match = (id: string, cookie: string | null, body: unknown) => call("payments:match", (c) => handleMatch(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${id}/match`, cookie, body);
const ignore = (id: string, cookie: string | null, body: unknown) => call("payments:match", (c) => handleIgnore(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${id}/ignore`, cookie, body);
const approve = (id: string, cookie: string | null, body: unknown = {}) => call("payments:approve", (c) => handleApprove(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${id}/approve`, cookie, body);
const reject = (id: string, cookie: string | null, body: unknown) => call("payments:approve", (c) => handleReject(c, { now: DEMO_NOW }), "POST", `/api/bank-rows/${id}/reject`, cookie, body);
const review = (id: string, cookie: string | null) => call("payments:match", (c) => handleReview(c, { now: DEMO_NOW }), "GET", `/api/bank-rows/${id}`, cookie);
const rows = (id: string, query: string, cookie: string | null) => call("payments:match", handleListRows, "GET", `/api/statements/${id}/rows${query}`, cookie);
const search = (q: string, cookie: string | null) => call("payments:match", (c) => handleSearchFlats(c, { now: DEMO_NOW }), "GET", `/api/flats/search?q=${encodeURIComponent(q)}`, cookie);
const imports = (cookie: string | null) => call("payments:match", handleListImports, "GET", "/api/statements", cookie);

describe("RR1 who may call what", () => {
  it("a resident is 403, staff without payments:match is 403, no session is 401, on every read and write route", async () => {
    const row = await queuedRow(fx, 100_000n);
    const attempts: [string, (cookie: string | null) => Promise<Response>][] = [
      ["list imports", imports],
      ["list rows", (c) => rows(sampleImportId, "", c)],
      ["review", (c) => review(row.id, c)],
      ["search", (c) => search("T28", c)],
      ["match", (c) => match(row.id, c, { flatCode: "T28-0101", reason: "A reason", rememberPayer: false, expectedVersion: 1 })],
      ["ignore", (c) => ignore(row.id, c, { reason: "A reason", expectedVersion: 1 })],
      ["approve", (c) => approve(row.id, c)],
      ["reject", (c) => reject(row.id, c, { reason: "A reason" })],
    ];
    for (const [name, attempt] of attempts) {
      expect((await attempt(residentCookie)).status, `${name} resident`).toBe(403);
      expect((await attempt(reportsCookie)).status, `${name} reports:view only`).toBe(403);
      expect((await attempt(null)).status, `${name} no session`).toBe(401);
    }
    expect(await fx.owner.bankRow.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: "QUEUED", version: 1 });
  });

  it("approve and reject need payments:approve: Priya (payments:match only) is 403, Rahul passes", async () => {
    const row = await queuedRow(fx, 100_000n);
    expect((await approve(row.id, priyaCookie)).status).toBe(403);
    expect((await reject(row.id, priyaCookie, { reason: "A reason" })).status).toBe(403);
    expect((await approve(row.id, rahulCookie)).status).toBe(409);
  });

  it("every route file uses the permission this test assumes", () => {
    const need = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(/export const (GET|POST) = withPermission\("([a-z:]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(need("src/app/api/statements/route.ts").sort()).toEqual(["GET payments:match", "POST payments:match"]);
    expect(need("src/app/api/statements/[id]/rows/route.ts")).toEqual(["GET payments:match"]);
    expect(need("src/app/api/bank-rows/[id]/route.ts")).toEqual(["GET payments:match"]);
    expect(need("src/app/api/bank-rows/[id]/match/route.ts")).toEqual(["POST payments:match"]);
    expect(need("src/app/api/bank-rows/[id]/ignore/route.ts")).toEqual(["POST payments:match"]);
    expect(need("src/app/api/bank-rows/[id]/approve/route.ts")).toEqual(["POST payments:approve"]);
    expect(need("src/app/api/bank-rows/[id]/reject/route.ts")).toEqual(["POST payments:approve"]);
    expect(need("src/app/api/flats/search/route.ts")).toEqual(["GET payments:match"]);
  });
});

describe("RR2 the reads", () => {
  it("lists imports, a lane page, a review and a search for staff, with money as decimal strings and no-store", async () => {
    const list = await imports(priyaCookie);
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect((await list.json()).imports.length).toBeGreaterThanOrEqual(1);

    const page = await rows(sampleImportId, "?lane=NEEDS_YOU&limit=5", priyaCookie);
    expect(page.status).toBe(200);
    const body = await page.json();
    expect(body.items).toHaveLength(5);
    expect(typeof body.items[0].amountPaise).toBe("string");
    expect(body.nextCursor).toEqual(expect.any(String));
    const next = await (await rows(sampleImportId, `?lane=NEEDS_YOU&limit=5&cursor=${body.nextCursor}`, priyaCookie)).json();
    expect(next.items.map((i: { id: string }) => i.id).filter((id: string) => body.items.some((x: { id: string }) => x.id === id))).toEqual([]);

    const detail = await review(body.items[0].id, priyaCookie);
    expect(detail.status).toBe(200);
    const reviewed = await detail.json();
    expect(typeof reviewed.creditPaise).toBe("string");
    expect(reviewed.version).toBe(1);

    const found = await search("T28", priyaCookie);
    expect(found.status).toBe(200);
    expect((await found.json()).flats.length).toBeLessThanOrEqual(10);
  });

  it("a bad id is 404, a bad lane or limit is 400, an unknown import is 404, a one-character search is an empty list", async () => {
    expect((await review("not-an-id", priyaCookie)).status).toBe(404);
    expect((await review(ZERO, priyaCookie)).status).toBe(404);
    expect((await rows(sampleImportId, "?lane=EVERYTHING", priyaCookie)).status).toBe(400);
    expect((await rows(sampleImportId, "?lane=NEEDS_YOU&limit=500", priyaCookie)).status).toBe(400);
    expect((await rows(ZERO, "", priyaCookie)).status).toBe(404);
    expect(await (await search("a", priyaCookie)).json()).toEqual({ flats: [] });
  });
});

describe("RR3 the writes: the status mapping and generic errors", () => {
  const goodBody = (flatCode: string, over: Record<string, unknown> = {}) => ({ flatCode, reason: "Phone call with the resident", rememberPayer: false, expectedVersion: 1, ...over });

  it("200 POSTED, then 409 NOT_QUEUED when repeated", async () => {
    const resident = await fx.makeResident();
    const row = await queuedRow(fx, 646_800n);
    const first = await match(row.id, priyaCookie, goodBody(resident.flatCode, { expectedAmountDuePaise: "646800" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "POSTED", flatCode: resident.flatCode, entries: [{ entryType: "LATE_FEE", amountPaise: "9800" }, { entryType: "PAYMENT", amountPaise: "646800" }], remaining: { kind: "SETTLED" } });
    const again = await match(row.id, priyaCookie, goodBody(resident.flatCode, { expectedVersion: 2 }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "NOT_QUEUED" });
  });

  it("409 STALE, 409 STATE_CHANGED, 422 NO_OPEN_BILL, 422 NEEDS_ADVANCE_HANDLING, 422 REASON_REQUIRED, 422 FLAT_NOT_FOUND, each only the code", async () => {
    const resident = await fx.makeResident();
    const paid = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 639_100n }], lateFees: [{ date: "2026-09-20", amountPaise: 2_100n }] });
    const row = await queuedRow(fx, 100_000n);
    const cases: [number, string, Promise<Response>][] = [
      [409, "STALE", match(row.id, priyaCookie, goodBody(resident.flatCode, { expectedVersion: 9 }))],
      [409, "STATE_CHANGED", match(row.id, priyaCookie, goodBody(resident.flatCode, { expectedAmountDuePaise: "1" }))],
      [422, "NO_OPEN_BILL", match(row.id, priyaCookie, goodBody(paid.flatCode))],
      [422, "NEEDS_ADVANCE_HANDLING", queuedRow(fx, 700_000n).then((big) => match(big.id, priyaCookie, goodBody(resident.flatCode)))],
      [422, "REASON_REQUIRED", match(row.id, priyaCookie, goodBody(resident.flatCode, { reason: "no" }))],
      [422, "FLAT_NOT_FOUND", match(row.id, priyaCookie, goodBody("T99-9999"))],
    ];
    for (const [status, code, promise] of cases) {
      const response = await promise;
      expect(response.status, code).toBe(status);
      expect(await response.json(), code).toEqual({ error: code });
    }
  });

  it("400 for a body that is not valid (a missing field, a wrong type, an unknown field, text that is not JSON), and 404 for a bad id", async () => {
    const row = await queuedRow(fx, 100_000n);
    for (const body of [{}, { ...goodBody("T28-0101"), expectedVersion: "1" }, { ...goodBody("T28-0101"), extra: true }, { ...goodBody("T28-0101"), expectedAmountDuePaise: "-5" }]) {
      expect((await match(row.id, priyaCookie, body)).status).toBe(400);
    }
    const notJson = await guards().withPermission("payments:match", (c) => handleMatch(c, { now: DEMO_NOW }))(
      new Request(`http://localhost/api/bank-rows/${row.id}/match`, { method: "POST", headers: { host: "localhost", cookie: priyaCookie, origin: "http://localhost" }, body: "{not json" }),
    );
    expect(notJson.status).toBe(400);
    expect((await match("not-an-id", priyaCookie, goodBody("T28-0101"))).status).toBe(404);
    expect((await match(ZERO, priyaCookie, goodBody("T28-0101"))).status).toBe(404);
  });

  it("ignore: 200 IGNORED, then 409; above the threshold 200 AWAITING_APPROVAL; reject and approve map their refusals", async () => {
    const small = await queuedRow(fx, 50_000n);
    const done = await ignore(small.id, priyaCookie, { reason: "Hall rent, not maintenance", expectedVersion: 1 });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ status: "IGNORED" });
    expect((await ignore(small.id, priyaCookie, { reason: "Hall rent, not maintenance", expectedVersion: 2 })).status).toBe(409);
    expect((await ignore(small.id, priyaCookie, { reason: "x", expectedVersion: 2 })).status).toBe(422);

    const big = await queuedRow(fx, 2_600_000n);
    const asked = await ignore(big.id, priyaCookie, { reason: "Vendor deposit refund", expectedVersion: 1 });
    expect(await asked.json()).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "1000000" });
    expect((await reject(big.id, rahulCookie, { reason: "x" })).status).toBe(422);
    const approved = await approve(big.id, rahulCookie, { note: "Checked the deposit slip" });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "APPROVED", action: "IGNORE" });
    expect((await approve(big.id, rahulCookie)).status).toBe(409);
  });

  it("an approver who asked cannot approve: 409 SELF_APPROVAL", async () => {
    const resident = await fx.makeResident({ billAmountPaise: 3_000_000n, dueOn: "2026-10-30" });
    const row = await queuedRow(fx, 2_600_000n);
    const asked = await match(row.id, rahulCookie, goodBody(resident.flatCode));
    expect(await asked.json()).toEqual({ status: "AWAITING_APPROVAL", thresholdPaise: "1000000" });
    const own = await approve(row.id, rahulCookie);
    expect(own.status).toBe(409);
    expect(await own.json()).toEqual({ error: "SELF_APPROVAL" });
  });
});
