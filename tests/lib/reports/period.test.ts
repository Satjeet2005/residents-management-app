import { describe, expect, it } from "vitest";
import { choosePeriod, monthStart, periodFromQuery, periodOptions, periodQuery, reportHref } from "@/lib/reports/period";

describe("RC1 the period", () => {
  it("reads ?period=YYYY-MM as the first day of a real month, and nothing else", () => {
    expect(periodFromQuery("2026-10")).toBe("2026-10-01");
    expect(periodFromQuery(["2026-01", "2026-02"])).toBe("2026-01-01");
    for (const bad of [undefined, "", "2026", "2026-13", "2026-00", "2026-10-01", "26-10", "october", "2026-1", " 2026-10", "2026-10 ", "<script>"]) expect(periodFromQuery(bad), String(bad)).toBeNull();
  });

  it("round-trips through the address", () => {
    expect(periodQuery("2026-10-01")).toBe("2026-10");
    expect(reportHref({ period: "2026-10-01" })).toBe("/staff/reports/dues?period=2026-10");
    expect(reportHref({ period: "2026-09-01", bucket: "31-60" })).toBe("/staff/reports/dues?period=2026-09&bucket=31-60#ageing-detail");
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
