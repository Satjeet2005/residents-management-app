import { describe, expect, it } from "vitest";
import { parseStatementCsv } from "@/domain/matching/csv";
import { rowDedupeKey } from "@/domain/matching/dedupe";
import { parseNarration } from "@/domain/matching/narration";

const keysOf = (csv: string): string[] => {
  const seen = new Map<string, number>();
  return parseStatementCsv(`date,narration,credit,debit,balance\n${csv}`).rows.map((row) => {
    const parsed = parseNarration(row.narrationRaw);
    const base = rowDedupeKey(row, parsed, 1);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return rowDedupeKey(row, parsed, occurrence);
  });
};

describe("P4 dedupe keys", () => {
  it("overlapping statements give the same keys for the same rows", () => {
    const first = keysOf("2026-10-05,UPI/402200118877/aamir.s@oksbi/maint,6370,,100000\n2026-10-06,CASH DEP T12-0408,5000,,105000\n2026-10-07,SMS CHARGES,,29.5,104970.5\n");
    const second = keysOf("2026-10-06,CASH DEP T12-0408,5000,,105000\n2026-10-07,SMS CHARGES,,29.5,104970.5\n2026-10-08,NEFT-N30112345-SHARMA R-T12 408,6370,,111340\n");
    expect(second.slice(0, 2)).toEqual(first.slice(1, 3));
    expect(new Set([...first, ...second]).size).toBe(4);
  });

  it("two identical cash deposits in one file get different keys", () => {
    const keys = keysOf("2026-10-06,CASH DEP T12-0408,5000,,105000\n2026-10-06,CASH DEP T12-0408,5000,,105000\n");
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0].endsWith("|1")).toBe(true);
    expect(keys[1].endsWith("|2")).toBe(true);
  });

  it("the same reference with a different narration spelling gives the same key", () => {
    const a = keysOf("2026-10-05,UPI/402200118877/aamir.s@oksbi/maint,6370,,\n");
    const b = keysOf("2026-10-05,UPI-402200118877-AAMIR SHAIKH-T21 1601,6370,,99\n");
    expect(a).toEqual(b);
    expect(a[0]).toBe("ref|UPI|402200118877|637000|0");
  });

  it("a reference row ignores the occurrence", () => {
    const [row] = parseStatementCsv("date,narration,credit\n2026-10-05,UPI/402200118877/x,1\n").rows;
    const parsed = parseNarration(row.narrationRaw);
    expect(rowDedupeKey(row, parsed, 1)).toBe(rowDedupeKey(row, parsed, 2));
  });

  it("different amounts, dates, balances or cheque rails give different keys", () => {
    const keys = keysOf(
      [
        "2026-10-05,CHQ DEP 004512,5000,,",
        "2026-10-05,CHQ DEP 004512,6000,,",
        "2026-10-05,CHQ RET 004512,,5000,",
        "2026-10-06,CASH DEP,5000,,100",
        "2026-10-06,CASH DEP,5000,,101",
        "2026-10-07,CASH DEP,5000,,100",
        "2026-10-07,CASH DEP,,5000,100",
      ].join("\n") + "\n",
    );
    expect(new Set(keys).size).toBe(7);
  });

  it("has a readable shape and uses nobal when there is no balance", () => {
    expect(keysOf("2026-10-06,Cash  dep T12-0408,50,,\n")).toEqual(["row|2026-10-06|5000|0|CASH DEP T12 0408|nobal|1"]);
  });

  it("stays under 200 characters and cuts the narration after 80", () => {
    const [key] = keysOf(`2026-10-06,${"WORD ".repeat(300)},9999999999999,,9999999999999\n`);
    expect(key.length).toBeLessThan(200);
    expect(key).toContain(`|${"WORD ".repeat(16)}|`);
  });

  it("is a pure function of its inputs", () => {
    const [row] = parseStatementCsv("date,narration,credit\n2026-10-05,CASH DEP,1\n").rows;
    const parsed = parseNarration(row.narrationRaw);
    expect(rowDedupeKey(row, parsed, 1)).toBe(rowDedupeKey({ ...row }, { ...parsed }, 1));
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects occurrence %s", (occurrence) => {
    const [row] = parseStatementCsv("date,narration,credit\n2026-10-05,CASH DEP,1\n").rows;
    expect(() => rowDedupeKey(row, parseNarration("CASH DEP"), occurrence)).toThrow(RangeError);
  });
});
