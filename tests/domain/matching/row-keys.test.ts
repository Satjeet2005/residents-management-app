import { describe, expect, it } from "vitest";
import { computeRowKeys } from "@/domain/matching/dedupe";
import { downgradeRows, processStatement } from "@/domain/matching/processor";
import { FIXED_REASONS } from "@/domain/matching/reasons";
import { bill, flat } from "./builders";
import { inputOf, readCsv } from "./processor-helpers";

const T12 = flat("T12-0408", { residents: ["Swati Joshi"], bills: [bill("b1", 637_000n, "2026-09-10")] });
const LINES = [
  "2026-10-27,UPI/301234567890/T12-0408 Swati Joshi/maintenance,6468.00,",
  "2026-10-26,BY CASH DEPOSIT,500.00,",
  "2026-10-26,BY CASH DEPOSIT,500.00,",
  "2026-10-26,BY CASH DEPOSIT,500.00,",
  "2026-10-27,UPI/301234567890/T12-0408 Swati Joshi/maintenance,6468.00,",
  "2026-10-25,CHQ DEP 123456 SOMEONE,1000.00,",
];

describe("SI4 computeRowKeys (the key of every row, the processor's occurrence rule)", () => {
  const { rows } = readCsv(LINES);
  const keys = computeRowKeys(rows);

  it("gives every row a key, by row number", () => {
    expect([...keys.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("equals the dedupe key the processor assigns to each row", () => {
    const processed = processStatement(inputOf([T12], LINES));
    for (const row of processed.rows) expect(keys.get(row.rowNumber), `row ${row.rowNumber}`).toBe(row.dedupeKey);
  });

  it("three identical cash rows get three different keys, numbered by occurrence", () => {
    const cash = [2, 3, 4].map((n) => keys.get(n) as string);
    expect(new Set(cash).size).toBe(3);
    expect(cash.map((k) => k.split("|").at(-1))).toEqual(["1", "2", "3"]);
  });

  it("the same UPI payment twice in a file has the same key both times (a reference identifies it)", () => {
    expect(keys.get(1)).toBe(keys.get(5));
    expect(keys.get(1)).toMatch(/^ref\|UPI\|301234567890\|/);
  });

  it("does not depend on the order the rows arrive in, only on the date and the row number it was given", () => {
    const reversed = readCsv([...LINES].reverse()).rows;
    const byContent = (map: Map<number, string>, source: typeof rows) => source.map((r) => `${r.txnDate}|${r.narrationRaw}|${map.get(r.rowNumber)}`).sort();
    // identical rows may swap occurrence numbers, so compare the sets of keys
    expect([...computeRowKeys(reversed).values()].sort()).toEqual([...keys.values()].sort());
    expect(byContent(keys, rows)).toHaveLength(6);
  });

  it("an empty statement has no keys, and the rows are not changed", () => {
    expect(computeRowKeys([]).size).toBe(0);
    const copy = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    computeRowKeys(rows);
    expect(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(copy);
  });
});

describe("SI2 downgradeRows (an AUTO row that could not be posted after all becomes QUEUED, and the books still add up)", () => {
  const processed = processStatement(inputOf([T12], ["2026-10-27,UPI/301234567890/T12-0408 Swati Joshi/maintenance,6468.00,", "2026-10-26,BY CASH DEPOSIT,500.00,", "2026-10-26,INT PD 12.00,12.00,"]));
  const autoRow = processed.rows.find((r) => r.state === "AUTO_MATCHED");

  it("the starting point has one AUTO_MATCHED row", () => {
    expect(autoRow).toBeDefined();
    expect(processed.summary.autoMatched).toBe(1);
    expect(processed.entriesToPost.length).toBe(2);
  });

  it("moves it to QUEUED with the reason added, no plan and no entries, and recomputes the summary and accounted", () => {
    const result = downgradeRows(processed, new Set([autoRow!.rowNumber]), FIXED_REASONS.stateChanged);
    const row = result.rows.find((r) => r.rowNumber === autoRow!.rowNumber)!;
    expect(row.state).toBe("QUEUED");
    expect(row.decision?.kind).toBe("QUEUE");
    expect(row.decision?.plan).toBeNull();
    expect(row.decision?.reasons.at(-1)?.code).toBe("STATE_CHANGED");
    expect(result.entriesToPost).toEqual([]);
    expect(result.summary).toMatchObject({ autoMatched: 0, queued: processed.summary.queued + 1, autoMatchedTotalPaise: 0n });
    expect(result.summary.creditTotalPaise).toBe(processed.summary.creditTotalPaise);
    expect(result.accounted).toBe(true);
  });

  it("leaves rows that are not AUTO_MATCHED, and numbers that name no row, alone", () => {
    const others = processed.rows.filter((r) => r.state !== "AUTO_MATCHED").map((r) => r.rowNumber);
    const result = downgradeRows(processed, new Set([...others, 99]), FIXED_REASONS.stateChanged);
    expect(result).toEqual(processed);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(processed, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    downgradeRows(processed, new Set([autoRow!.rowNumber]), FIXED_REASONS.stateChanged);
    expect(JSON.stringify(processed, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(before);
  });
});
