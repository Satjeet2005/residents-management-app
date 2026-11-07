import { describe, expect, it } from "vitest";
import { AGEING_PAGE_SIZE, decodeCursor, encodeCursor, pageAfter } from "@/lib/reports/cursor";
import { choosePeriod, monthStart, periodFromQuery, periodOptions, periodQuery, reportHref } from "@/lib/reports/period";

describe("RC1 the period", () => {
  it("reads ?period=YYYY-MM as the first day of a real month, and nothing else", () => {
    expect(periodFromQuery("2026-10")).toBe("2026-10-01");
    expect(periodFromQuery(["2026-01", "2026-02"])).toBe("2026-01-01");
    for (const bad of [undefined, "", "2026", "2026-13", "2026-00", "2026-10-01", "26-10", "october", "2026-1", " 2026-10", "2026-10 ", "<script>"]) expect(periodFromQuery(bad), String(bad)).toBeNull();
  });

  it("round-trips through the address", () => {
    expect(periodQuery("2026-10-01")).toBe("2026-10");
    expect(reportHref({ period: "2026-10-01" })).toBe("/staff/reports?period=2026-10");
    expect(reportHref({ period: "2026-09-01", bucket: "31-60" })).toBe("/staff/reports?period=2026-09&bucket=31-60#ageing-detail");
    expect(monthStart("2026-10-27")).toBe("2026-10-01");
  });

  it("offers the distinct months that have bills, none after the business month, newest first", () => {
    const billed = ["2026-06-01", "2026-07-01", "2026-10-01", "2026-10-01", "2026-12-01", "2026-09-01"];
    expect(periodOptions(billed, "2026-10-27")).toEqual(["2026-10-01", "2026-09-01", "2026-07-01", "2026-06-01"]);
    expect(periodOptions(billed, "2026-10-01")).toEqual(["2026-10-01", "2026-09-01", "2026-07-01", "2026-06-01"]);
    expect(periodOptions(billed, "2026-09-30")).toEqual(["2026-09-01", "2026-07-01", "2026-06-01"]);
    expect(periodOptions([], "2026-10-27")).toEqual([]);
  });

  it("opens on the month of the business date when it has bills", () => {
    expect(choosePeriod({ requested: null, options: ["2026-10-01", "2026-09-01"], asOf: "2026-10-27" })).toBe("2026-10-01");
  });

  it("opens on the newest billed month when the business month has no bills yet, and on the business month when there are none at all", () => {
    expect(choosePeriod({ requested: null, options: ["2026-10-01", "2026-09-01"], asOf: "2026-11-07" })).toBe("2026-10-01");
    expect(choosePeriod({ requested: null, options: [], asOf: "2026-11-07" })).toBe("2026-11-01");
  });

  it("a month in the address wins, even one without bills (the page says so), but a future month is ignored", () => {
    expect(choosePeriod({ requested: "2026-07-01", options: ["2026-10-01", "2026-07-01"], asOf: "2026-10-27" })).toBe("2026-07-01");
    expect(choosePeriod({ requested: "2026-03-01", options: ["2026-10-01"], asOf: "2026-10-27" })).toBe("2026-03-01");
    expect(choosePeriod({ requested: "2026-11-01", options: ["2026-10-01"], asOf: "2026-10-27" })).toBe("2026-10-01");
    expect(choosePeriod({ requested: "2027-01-01", options: [], asOf: "2026-10-27" })).toBe("2026-10-01");
  });
});

describe("RC2 the drill-down paging", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ daysPastDue: 100 - Math.floor(i / 4), flatCode: `T01-${String(i % 4).padStart(4, "0")}`, billId: `bill-${String(i).padStart(3, "0")}` }));

  it("a cursor round-trips and a bad one is refused", () => {
    expect(decodeCursor(encodeCursor(rows[7]))).toEqual({ d: rows[7].daysPastDue, f: rows[7].flatCode, b: rows[7].billId });
    for (const bad of ["", "abc", "e30", Buffer.from("[]").toString("base64url"), Buffer.from('{"d":"x","f":"a","b":"c"}').toString("base64url"), "x".repeat(400)]) expect(decodeCursor(bad), bad.slice(0, 12)).toBeNull();
  });

  it("pages of 25 follow each other with no repeat and no gap, to the end", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result: ReturnType<typeof pageAfter<(typeof rows)[number]>> = pageAfter(rows, cursor === null ? null : decodeCursor(cursor));
      seen.push(...result.rows.map((r) => r.billId));
      if (result.nextCursor === null) break;
      expect(result.rows).toHaveLength(AGEING_PAGE_SIZE);
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(rows.map((r) => r.billId));
  });

  it("a short list has one page and no cursor; an empty list has none", () => {
    expect(pageAfter(rows.slice(0, 25), null).nextCursor).toBeNull();
    expect(pageAfter(rows.slice(0, 26), null).nextCursor).not.toBeNull();
    expect(pageAfter([], null)).toEqual({ rows: [], nextCursor: null });
  });
});
