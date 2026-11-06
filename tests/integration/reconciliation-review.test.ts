import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_NOW } from "@/domain/seed/types";
import { importStatement } from "@/server/statements/import";
import { getSampleStatement } from "@/server/statements/sample-statement";
import { LANES, getRowReview, listImports, listRows, searchFlats } from "@/server/statements/review";
import { type PaymentsFixture, type Resident, createPaymentsFixture } from "./payments-fixture";
import { csv, upiRow } from "./statements-helpers";

/**
 * MP6 (review and search privacy), the lanes and the keyset pages: all run through the APP role. The sample statement is imported once
 * into the seeded database; the small statements use a flat of their own.
 */
let fx: PaymentsFixture;
let staffId: string;
let sampleImportId: string;
beforeAll(async () => {
  fx = await createPaymentsFixture();
  staffId = (await fx.userByPhone("5000000001")).id;
  const result = await importStatement({ db: fx.app, user: { id: staffId }, filename: "sample.csv", csvText: getSampleStatement(), now: DEMO_NOW });
  if (result.status !== "IMPORTED") throw new Error(result.status);
  sampleImportId = result.importId;
}, 180_000);
afterAll(async () => {
  await fx?.close();
}, 60_000);

const importOne = async (...lines: string[]) => {
  const result = await importStatement({ db: fx.app, user: { id: staffId }, filename: "one.csv", csvText: csv(...lines), now: DEMO_NOW });
  if (result.status !== "IMPORTED") throw new Error(result.status);
  const rows = await fx.owner.bankRow.findMany({ where: { importId: result.importId }, orderBy: { rowNumber: "asc" } });
  return { importId: result.importId, rows };
};
const review = async (rowId: string) => {
  const result = await getRowReview({ db: fx.app, rowId, now: DEMO_NOW });
  if (result === null) throw new Error("no row");
  return result;
};

describe("RV1 the review of one row", () => {
  it("a short payment: the row, the stored decision with plain-English reasons, and the candidate flat with its residents and open position", async () => {
    const resident: Resident = await fx.makeResident();
    const { rows } = await importOne(upiRow(resident, 100_000n));
    const r = await review(rows[0].id);
    expect(r).toMatchObject({ state: "QUEUED", version: 1, txnDate: "2026-10-27", creditPaise: "100000", debitPaise: "0" });
    expect(r.narrationRaw).toContain(resident.flatCode);
    expect(r.decision?.reasons.length).toBeGreaterThan(0);
    for (const reason of r.decision?.reasons ?? []) expect(reason.text.length).toBeGreaterThan(10);
    const candidate = r.candidates.find((c) => c.flatCode === resident.flatCode);
    const flat = await fx.owner.flat.findUniqueOrThrow({ where: { code: resident.flatCode } });
    expect(candidate).toMatchObject({ tower: flat.tower, residents: [resident.name], amountRelation: "LESS_THAN_DUE" });
    expect(candidate?.openPositions).toEqual([{ billId: resident.billId, kind: "PRINCIPAL_OPEN", dueOn: "2026-09-10", principalOutstandingPaise: "637000", feePaise: "9800", amountDuePaise: "646800" }]);
    expect(r.candidates.length).toBeLessThanOrEqual(5);
  });

  it("a flat whose principal is paid shows its FEE_ONLY position, which the matcher does not see", async () => {
    const resident = await fx.makeResident({ payments: [{ date: "2026-10-27", amountPaise: 637_000n }], lateFees: [{ date: "2026-10-27", amountPaise: 9_800n }] });
    const { rows } = await importOne(upiRow(resident, 9_800n));
    const r = await review(rows[0].id);
    expect(r.state).toBe("QUEUED");
    expect(r.decision?.reasons.map((x) => x.code)).toContain("NO_OPEN_BILL");
    const candidate = r.candidates.find((c) => c.flatCode === resident.flatCode);
    expect(candidate?.openPositions).toEqual([{ billId: resident.billId, kind: "FEE_ONLY", dueOn: "2026-09-10", principalOutstandingPaise: "0", feePaise: "9800", amountDuePaise: "9800" }]);
    expect(candidate?.amountRelation).toBe("EQUALS_DUE");
  });

  it("positions are as of the row's date: a row dated before the due date sees no fee", async () => {
    const resident = await fx.makeResident();
    const { rows } = await importOne(upiRow(resident, 100_000n, "2026-09-05"));
    const candidate = (await review(rows[0].id)).candidates.find((c) => c.flatCode === resident.flatCode);
    expect(candidate?.openPositions[0]).toMatchObject({ feePaise: "0", amountDuePaise: "637000" });
  });

  it("only this row's candidates are returned: the answer names no flat that is not among the stored candidates", async () => {
    const resident = await fx.makeResident();
    const { rows } = await importOne(upiRow(resident, 100_000n));
    const r = await review(rows[0].id);
    const stored = (rows[0].parsed as { decision: { candidates: { flatCode: string }[] } }).decision.candidates.map((c) => c.flatCode);
    expect(r.candidates.map((c) => c.flatCode).sort()).toEqual([...stored].sort());
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/phone|\b[0-9]{10}\b/);
  });

  it("a debit row, an ignored row and an unknown id", async () => {
    const rows = await fx.owner.bankRow.findMany({ where: { importId: sampleImportId, state: "IGNORED", debitPaise: { gt: 0n } }, take: 1 });
    const r = await review(rows[0].id);
    expect(r).toMatchObject({ state: "IGNORED", creditPaise: "0" });
    expect(r.debitPaise).not.toBe("0");
    expect(await getRowReview({ db: fx.app, rowId: "00000000-0000-4000-8000-000000000000", now: DEMO_NOW })).toBeNull();
    expect(await getRowReview({ db: fx.app, rowId: "not-an-id", now: DEMO_NOW })).toBeNull();
  });
});

describe("RV2 the lanes and the pages", () => {
  it("the four lane counts add up to the rows of the import, and match the stored states", async () => {
    const page = await listRows({ db: fx.app, importId: sampleImportId, lane: "NEEDS_YOU" });
    const total = LANES.reduce((sum, lane) => sum + (page?.laneCounts[lane] ?? 0), 0);
    expect(total).toBe(page?.summary?.summary.rowsRead);
    const states = await fx.owner.bankRow.groupBy({ by: ["state"], where: { importId: sampleImportId }, _count: { _all: true } });
    const n = (state: string) => states.find((s) => s.state === state)?._count._all ?? 0;
    expect(page?.laneCounts).toEqual({ NEEDS_YOU: n("QUEUED"), AWAITING_APPROVAL: n("AWAITING_APPROVAL"), MATCHED: n("AUTO_MATCHED") + n("MANUALLY_MATCHED"), NOT_MAINTENANCE: n("IGNORED") });
    expect(page?.summary?.accounted).toBe(true);
  });

  it("keyset pages of NEEDS_YOU: biggest amount first then id, no row twice, none missed, a page of at most 50", async () => {
    const seen: { id: string; amount: bigint }[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listRows({ db: fx.app, importId: sampleImportId, lane: "NEEDS_YOU", cursor, limit: 30 });
      if (page === null) throw new Error("no import");
      expect(page.items.length).toBeLessThanOrEqual(30);
      seen.push(...page.items.map((i) => ({ id: i.id, amount: BigInt(i.amountPaise) })));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor !== undefined && pages < 20);
    const queued = await fx.owner.bankRow.count({ where: { importId: sampleImportId, state: "QUEUED" } });
    expect(seen).toHaveLength(queued);
    expect(new Set(seen.map((s) => s.id)).size).toBe(queued);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i - 1].amount > seen[i].amount || (seen[i - 1].amount === seen[i].amount && seen[i - 1].id < seen[i].id)).toBe(true);
    }
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it("limit is capped at 50, a bad cursor is the first page, and each lane holds only its states", async () => {
    const big = await listRows({ db: fx.app, importId: sampleImportId, lane: "NEEDS_YOU", limit: 500 });
    expect(big?.items.length).toBeLessThanOrEqual(50);
    const first = await listRows({ db: fx.app, importId: sampleImportId, lane: "NEEDS_YOU", limit: 5 });
    const bad = await listRows({ db: fx.app, importId: sampleImportId, lane: "NEEDS_YOU", limit: 5, cursor: "%%%not-a-cursor" });
    expect(bad?.items.map((i) => i.id)).toEqual(first?.items.map((i) => i.id));
    const expected: Record<string, string[]> = { NEEDS_YOU: ["QUEUED"], AWAITING_APPROVAL: ["AWAITING_APPROVAL"], MATCHED: ["AUTO_MATCHED", "MANUALLY_MATCHED"], NOT_MAINTENANCE: ["IGNORED"] };
    for (const lane of LANES) {
      const page = await listRows({ db: fx.app, importId: sampleImportId, lane, limit: 50 });
      for (const item of page?.items ?? []) expect(expected[lane]).toContain(item.state);
    }
    expect(await listRows({ db: fx.app, importId: "00000000-0000-4000-8000-000000000000", lane: "NEEDS_YOU" })).toBeNull();
  });

  it("listImports gives the latest imports, newest first, at most 10", async () => {
    const list = await listImports({ db: fx.app });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(10);
    expect(list.map((i) => i.uploadedAt)).toEqual([...list.map((i) => i.uploadedAt)].sort().reverse());
  });
});

describe("RV3 searching flats", () => {
  it("a flat code prefix, in any case and with the separators the code reader accepts", async () => {
    const resident = await fx.makeResident();
    const code = resident.flatCode; // T28-xxxx
    for (const q of [code.slice(0, 6).toLowerCase(), code.replace("-", " ").slice(0, 7), code.replace("-", "/"), code.replace("-", "")]) {
      const hits = await searchFlats({ db: fx.app, q, now: DEMO_NOW });
      expect(hits.map((h) => h.flatCode), q).toContain(code);
      expect(hits.length).toBeLessThanOrEqual(10);
    }
    const hit = (await searchFlats({ db: fx.app, q: code, now: DEMO_NOW })).find((h) => h.flatCode === code);
    const flat = await fx.owner.flat.findUniqueOrThrow({ where: { code } });
    expect(hit).toEqual({ flatCode: code, tower: flat.tower, residents: [resident.name], openPositions: 1 });
  });

  it("a resident name token, and the number of open positions of a flat that has paid", async () => {
    const paid = await fx.makeResident({ payments: [{ date: "2026-09-20", amountPaise: 639_100n }], lateFees: [{ date: "2026-09-20", amountPaise: 2_100n }] });
    const token = paid.name.split(" ")[1].toLowerCase();
    const hit = (await searchFlats({ db: fx.app, q: token, now: DEMO_NOW })).find((h) => h.flatCode === paid.flatCode);
    expect(hit).toMatchObject({ residents: [paid.name], openPositions: 0 });
  });

  it("fewer than 2 characters, a blank, wildcards and a very long text find nothing, and never more than 10 flats come back", async () => {
    for (const q of ["", " ", "t", "%", "_", "a".repeat(200)]) expect(await searchFlats({ db: fx.app, q, now: DEMO_NOW }), q).toEqual([]);
    expect((await searchFlats({ db: fx.app, q: "T1", now: DEMO_NOW })).length).toBeLessThanOrEqual(10);
    expect((await searchFlats({ db: fx.app, q: "%%", now: DEMO_NOW })).length).toBe(0);
  });

  it("a hit holds only the flat code, tower, residents' names and a count: no phone, no ids", async () => {
    const hits = await searchFlats({ db: fx.app, q: "T28", now: DEMO_NOW });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(Object.keys(hit).sort()).toEqual(["flatCode", "openPositions", "residents", "tower"]);
  });
});
