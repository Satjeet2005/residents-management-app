import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { accountingReport, processStatement, type ProcessedStatement } from "@/domain/matching/processor";
import type { FlatContext } from "@/domain/matching/types";
import { createPrng } from "@/domain/seed/prng";
import { flatContextsFromDataset, demoDataset } from "./context";
import { bill, flat } from "./builders";
import { deepFreeze, inputFor, randomRows, sampleFlats, samplePools } from "./processor-generators";
import { inputOf } from "./processor-helpers";

let demoFlats: FlatContext[];
let pools: ReturnType<typeof samplePools>;
beforeAll(() => {
  demoFlats = flatContextsFromDataset(demoDataset());
  pools = samplePools(demoFlats);
});

/** `count` random statements of 40 rows over 60 flats of the demo society. Each case has its own seed, so chunks are independent. */
function statements(count: number, seed: number, first = 0, duplicates = true) {
  return Array.from({ length: count }, (_, k) => {
    const i = first + k;
    const rng = createPrng(seed + i);
    const flats = sampleFlats(rng.fork("flats"), pools, 60);
    return { flats, rows: randomRows(rng.fork("rows"), flats, 40, { duplicates, referenceBase: i * 100 }) };
  });
}

/** Chunks of 25 cases, so no single test is long even on 2 busy CPUs. */
const CHUNK = 25;
const CHUNKS = (cases: number): number[] => Array.from({ length: cases / CHUNK }, (_, c) => c * CHUNK);

describe("Y1 conservation", () => {
  it.each(CHUNKS(200))("200 random statements, cases from %i (25 each): every row has one state and the statement is accounted for", (first) => {
    let autos = 0;
    for (const { flats, rows } of statements(CHUNK, 20261106, first)) {
      const result = processStatement(inputFor(rows, flats));
      expect(result.rows).toHaveLength(rows.length);
      expect(result.accounted).toBe(true);
      expect(accountingReport(result)).toEqual([]);
      const { summary } = result;
      expect(summary.autoMatched + summary.queued + summary.ignored + summary.alreadyImported).toBe(rows.length);
      autos += summary.autoMatched;
    }
    expect(autos).toBeGreaterThan(10);
  });

  it("a result with a state changed in a copy is not accounted for", () => {
    const [{ flats, rows }] = statements(1, 5);
    const result = processStatement(inputFor(rows, flats));
    for (const index of [0, 5, 10, 20]) {
      const copy: ProcessedStatement = structuredClone(result);
      copy.rows[index].state = copy.rows[index].state === "QUEUED" ? "IGNORED" : "QUEUED";
      expect(accountingReport(copy).length).toBeGreaterThan(0);
    }
  });
});

describe("Y2 idempotence", () => {
  it("processing a file twice: the second run is all ALREADY_IMPORTED, with no entries", () => {
    for (const { flats, rows } of statements(30, 77)) {
      const first = processStatement(inputFor(rows, flats));
      const keys = new Set(first.rows.map((r) => r.dedupeKey));
      const second = processStatement(inputFor(rows, flats, { alreadyImportedKeys: keys }));
      expect(second.rows.every((r) => r.state === "ALREADY_IMPORTED" && r.decision === null)).toBe(true);
      expect(second.entriesToPost).toEqual([]);
      expect(second.accounted).toBe(true);
      expect(second.summary).toEqual({
        ...first.summary,
        autoMatched: 0,
        queued: 0,
        ignored: 0,
        alreadyImported: first.summary.validRows,
        autoMatchedTotalPaise: 0n,
      });
    }
  });

  it("overlapping files: rows 51 to 100 of B equal rows 1 to 50 of A, and those 50 are ALREADY_IMPORTED", () => {
    const rng = createPrng(2026);
    const flats = sampleFlats(rng.fork("f"), pools, 60);
    const a = randomRows(rng.fork("a"), flats, 100, { referenceBase: 0 });
    const fresh = randomRows(rng.fork("b"), flats, 50, { referenceBase: 5000 });
    const b = [...fresh, ...a.slice(0, 50).map((r, i) => ({ ...r, rowNumber: 51 + i }))];
    const resultA = processStatement(inputFor(a, flats));
    const resultB = processStatement(inputFor(b, flats, { alreadyImportedKeys: new Set(resultA.rows.map((r) => r.dedupeKey)) }));
    const state = new Map(resultB.rows.map((r) => [r.rowNumber, r.state]));
    for (let n = 51; n <= 100; n++) expect(state.get(n)).toBe("ALREADY_IMPORTED");
    for (let n = 1; n <= 50; n++) expect(state.get(n)).not.toBe("ALREADY_IMPORTED");
    expect(resultB.summary.alreadyImported).toBe(50);
    expect(resultB.accounted).toBe(true);
  });
});

describe("Y3 identical cash deposits", () => {
  const flats = [flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10")] })];
  const lines = ["2026-10-05,CASH DEP,5000,,100000", "2026-10-05,CASH DEP,5000,,100000"];

  it("both are processed, with different keys, and a re-import skips both", () => {
    const first = processStatement(inputOf(flats, lines));
    expect(first.rows.map((r) => r.state)).toEqual(["QUEUED", "QUEUED"]);
    expect(new Set(first.rows.map((r) => r.dedupeKey)).size).toBe(2);
    const again = processStatement(inputOf(flats, lines, new Set(first.rows.map((r) => r.dedupeKey))));
    expect(again.rows.map((r) => r.state)).toEqual(["ALREADY_IMPORTED", "ALREADY_IMPORTED"]);
  });
});

describe("Y4 state", () => {
  const T12 = (n: number) => `2026-10-27,UPI/40220011887${n}/T12 408/maint,6468,,`;

  it("two rows that each pay the same flat's oldest bill exactly: the first is AUTO_MATCHED, the second QUEUED", () => {
    const result = processStatement(inputOf([flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10")] })], [T12(1), T12(2)]));
    expect(result.rows.map((r) => r.state)).toEqual(["AUTO_MATCHED", "QUEUED"]);
    expect(result.entriesToPost.filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
  });

  const billOf = (): Map<string, FlatContext["openBills"][number]> => new Map(demoFlats.flatMap((f) => f.openBills.map((b) => [b.billKey, b] as const)));

  it.each(CHUNKS(300))("300 random statements, cases from %i (25 each): a bill is never auto-posted twice, and never for more than was unpaid on that date", (first) => {
    const bills = billOf();
    // What was unpaid on the day of the entry: the bill less payments dated on or before that day (a later payment is not counted: see C7).
    const unpaidOn = (billKey: string, date: string): bigint => {
      const b = bills.get(billKey) as FlatContext["openBills"][number];
      return b.amountPaise - b.paymentsOnBill.filter((p) => p.date <= date).reduce((sum, p) => sum + p.amountPaise, 0n);
    };
    let seen = 0;
    for (const { flats, rows } of statements(CHUNK, 4242, first)) {
      const result = processStatement(inputFor(rows, flats));
      const paid = new Map<string, { payments: number; principal: bigint; date: string }>();
      for (const e of result.entriesToPost) {
        const so = paid.get(e.billKey) ?? { payments: 0, principal: 0n, date: e.effectiveDate };
        if (e.entryType === "PAYMENT") {
          so.payments += 1;
          so.principal += e.amountPaise;
        } else so.principal -= e.amountPaise;
        paid.set(e.billKey, so);
      }
      for (const [billKey, so] of paid) {
        seen++;
        expect(so.payments).toBe(1);
        expect(so.principal).toBeLessThanOrEqual(unpaidOn(billKey, so.date));
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("two files in a row (the first's bills paid) do not double pay when the second is given the paid state", () => {
    const flats = [flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10")] })];
    const first = processStatement(inputOf(flats, [T12(1)]));
    expect(first.rows[0].state).toBe("AUTO_MATCHED");
    // The database layer gives the second run the flats as they are after the first posted.
    const afterPosting = [flat("T12-0408", { bills: [bill("sep", 637000n, "2026-09-10", [{ date: "2026-10-27", amountPaise: 646800n }])] })];
    expect(processStatement(inputOf(afterPosting, [T12(2)])).rows[0].state).toBe("QUEUED");
  });
});

describe("Y5 no input mutation", () => {
  it("a deeply frozen input is processed without a change or an error", () => {
    const [{ flats, rows }] = statements(1, 9);
    const keys = new Set<string>(["x"]);
    const input = deepFreeze(inputFor(rows, flats, { alreadyImportedKeys: keys, csvErrors: [{ rowNumber: 3, column: "credit", message: "row 3: credit is not a number" }] }));
    const before = structuredClone(input);
    const result = processStatement(input);
    expect(result.summary.autoMatched).toBeGreaterThan(0);
    expect(input).toEqual(before);
    expect([...keys]).toEqual(["x"]);
  });
});

describe("Y6 determinism", () => {
  it("the same input gives deeply equal output, and so does the same rows in reverse order", () => {
    for (const { flats, rows } of statements(20, 31)) {
      const input = inputFor(rows, flats);
      const once = processStatement(input);
      expect(processStatement(input)).toEqual(once);
      expect(processStatement({ ...input, rows: [...rows].reverse() })).toEqual(once);
    }
  });
});

describe("Y7 invalid rows", () => {
  const flats = [flat("T12-0408")];

  it("are counted in rowsRead and invalidRows, once per row, and never dropped", () => {
    const csvErrors = [
      { rowNumber: 2, column: "credit", message: "row 2: credit is not a number" },
      { rowNumber: 2, column: "date", message: "row 2: date is not a date" },
      { rowNumber: 7, column: "date", message: "row 7: date is not a date" },
    ];
    const result = processStatement(inputFor([], flats, { csvErrors }));
    expect(result.summary).toMatchObject({ rowsRead: 2, validRows: 0, invalidRows: 2 });
    expect(result.csvErrors).toEqual(csvErrors);
  });

  it("a statement of only invalid rows is accounted for, with no entries", () => {
    const result = processStatement(inputFor([], flats, { csvErrors: [{ rowNumber: 1, column: "date", message: "row 1: date is not a date" }] }));
    expect(result).toMatchObject({ accounted: true, entriesToPost: [], rows: [] });
  });

  it("valid and invalid rows together add up", () => {
    const [{ flats: sample, rows }] = statements(1, 3);
    const csvErrors = [3, 9, 15].map((rowNumber) => ({ rowNumber, column: "credit", message: `row ${rowNumber}: credit is not a number` }));
    const result = processStatement(inputFor(rows, sample, { csvErrors }));
    expect(result.summary.rowsRead).toBe(rows.length + 3);
    expect(result.accounted).toBe(true);
  });
});

describe("Y8 posting reconciliation", () => {
  it.each(CHUNKS(100))("over 100 statements, cases from %i (25 each): the payments equal the auto-matched total, each row reconciles, and keys are unique", (first) => {
    for (const { flats, rows } of statements(CHUNK, 808, first)) {
      const result = processStatement(inputFor(rows, flats));
      const payments = result.entriesToPost.filter((e) => e.entryType === "PAYMENT");
      expect(payments.reduce((sum, e) => sum + e.amountPaise, 0n)).toBe(result.summary.autoMatchedTotalPaise);
      for (const r of result.rows.filter((x) => x.state === "AUTO_MATCHED")) {
        const entries = result.entriesToPost.filter((e) => e.rowNumber === r.rowNumber);
        expect(entries.filter((e) => e.entryType === "PAYMENT").map((e) => e.amountPaise)).toEqual([r.creditPaise]);
        expect(new Set(entries.map((e) => e.billKey)).size).toBe(1);
      }
      expect(new Set(result.entriesToPost.map((e) => e.idempotencyKey)).size).toBe(result.entriesToPost.length);
      expect(result.entriesToPost.every((e) => e.idempotencyKey.startsWith("bank:") && e.idempotencyKey.endsWith(`:${e.entryType}`))).toBe(true);
    }
  });
});

// Y9: measured 0.9 s for 5,000 rows alone and 5.4 s under 5x load; the 20 s budget is more than 3 times the slowest.
describe("Y9 speed", () => {
  it("a 5,000-row statement against the 2,400-flat demo society is processed in under 20 s", () => {
    const rows = randomRows(createPrng(99), demoFlats, 5000, { duplicates: true });
    const input = inputFor(rows, demoFlats);
    const start = performance.now();
    const result = processStatement(input);
    const elapsed = performance.now() - start;
    expect(result.accounted).toBe(true);
    expect(result.rows).toHaveLength(5000);
    expect(elapsed).toBeLessThan(20_000);
  });
});

describe("Y10 purity", () => {
  it("processor.ts imports only relative paths inside src/domain and uses no clock, randomness or Node built-ins", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/domain/matching/processor.ts"), "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) expect(match[1].startsWith("./") || match[1].startsWith("../")).toBe(true);
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(|\bIntl\b|node:/);
  });
});
