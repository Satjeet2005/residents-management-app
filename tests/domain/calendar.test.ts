import { describe, expect, it } from "vitest";
import {
  addDays,
  dayStartInstant,
  diffDays,
  isValidDate,
  istDateOf,
  parseDate,
} from "@/domain/time/calendar";

describe("isValidDate", () => {
  it.each(["2026-10-28", "2028-02-29", "2000-02-29", "2026-12-31", "2026-01-01", "1000-01-01", "9999-12-31"])(
    "accepts %s",
    (value) => {
      expect(isValidDate(value)).toBe(true);
    },
  );

  it.each([
    "2026-02-30",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
    "0999-12-31",
    "2026-1-1",
    "26-01-01",
    "2026/01/01",
    "20260101",
    "2026-01-01T00:00:00",
    " 2026-01-01",
    "2026-01-01 ",
    "",
    "abcd-ef-gh",
    "２０２６-01-01",
  ])("rejects %j", (value) => {
    expect(isValidDate(value)).toBe(false);
  });
});

describe("parseDate", () => {
  it("splits a valid date", () => {
    expect(parseDate("2026-10-28")).toEqual({ year: 2026, month: 10, day: 28 });
  });

  it("throws RangeError for an invalid date", () => {
    expect(() => parseDate("2026-02-30")).toThrow(RangeError);
    expect(() => parseDate("2026-02-30")).toThrow("not a valid calendar date");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-04-30", 1, "2026-05-01"],
    ["2026-03-31", 1, "2026-04-01"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2028-02-28", 2, "2028-03-01"],
    ["2028-02-29", 1, "2028-03-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-10-10", 0, "2026-10-10"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-03-01", -1, "2028-02-29"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2026-01-01", 365, "2027-01-01"],
    ["2028-01-01", 366, "2029-01-01"],
    ["2026-10-27", 31, "2026-11-27"],
  ])("addDays(%s, %i) = %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("rejects an invalid date, a fractional or non-finite count, and results outside 1000-9999", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("2026-02-01", 1.5)).toThrow(RangeError);
    expect(() => addDays("2026-02-01", Number.NaN)).toThrow(RangeError);
    expect(() => addDays("9999-12-31", 1)).toThrow(RangeError);
    expect(() => addDays("1000-01-01", -1)).toThrow(RangeError);
  });
});

describe("diffDays", () => {
  it.each([
    ["2026-10-27", "2026-10-28", 1],
    ["2026-10-28", "2026-10-27", -1],
    ["2026-10-28", "2026-10-28", 0],
    ["2026-09-10", "2026-10-27", 47],
    ["2026-10-27", "2026-09-10", -47],
    ["2028-02-28", "2028-03-02", 3],
    ["2026-02-28", "2026-03-02", 2],
    ["2026-12-30", "2027-01-02", 3],
    ["2026-01-01", "2027-01-01", 365],
    ["2028-01-01", "2029-01-01", 366],
    ["2026-01-31", "2026-03-01", 29],
  ])("diffDays(%s, %s) = %i", (from, to, expected) => {
    expect(diffDays(from, to)).toBe(expected);
  });

  it("is the inverse of addDays", () => {
    for (const [date, days] of [["2026-10-28", 100], ["2028-02-29", -400], ["2026-12-31", 1]] as const) {
      expect(diffDays(date, addDays(date, days))).toBe(days);
    }
  });

  it("throws RangeError for an invalid date", () => {
    expect(() => diffDays("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => diffDays("2026-03-01", "nope")).toThrow(RangeError);
  });
});

describe("dayStartInstant: 00:00 India Standard Time (UTC+05:30)", () => {
  it("2026-10-28 starts at 2026-10-27T18:30:00Z", () => {
    expect(dayStartInstant("2026-10-28")).toBe(Date.parse("2026-10-27T18:30:00Z"));
  });

  it("2026-01-01 starts at 2025-12-31T18:30:00Z", () => {
    expect(dayStartInstant("2026-01-01")).toBe(Date.parse("2025-12-31T18:30:00Z"));
  });

  it("consecutive days are exactly 24 hours apart (no daylight saving)", () => {
    expect(dayStartInstant("2026-10-29") - dayStartInstant("2026-10-28")).toBe(86_400_000);
    expect(dayStartInstant("2026-03-09") - dayStartInstant("2026-03-08")).toBe(86_400_000);
    expect(dayStartInstant("2026-11-02") - dayStartInstant("2026-11-01")).toBe(86_400_000);
  });
});

describe("istDateOf", () => {
  it.each(["2026-10-28", "2026-01-01", "2028-02-29", "2026-12-31"])(
    "round trips around midnight for %s",
    (date) => {
      const start = dayStartInstant(date);
      expect(istDateOf(start)).toBe(date);
      expect(istDateOf(start + 1)).toBe(date);
      expect(istDateOf(start - 1)).toBe(addDays(date, -1));
      expect(istDateOf(dayStartInstant(addDays(date, 1)) - 1)).toBe(date);
      expect(istDateOf(dayStartInstant(addDays(date, 1)))).toBe(addDays(date, 1));
    },
  );

  it("converts known instants", () => {
    expect(istDateOf(Date.parse("2026-10-27T18:29:59.999Z"))).toBe("2026-10-27");
    expect(istDateOf(Date.parse("2026-10-27T18:30:00Z"))).toBe("2026-10-28");
    expect(istDateOf(Date.parse("2026-10-27T23:59:00+05:30"))).toBe("2026-10-27");
  });

  it("throws RangeError for a non-finite instant", () => {
    expect(() => istDateOf(Number.NaN)).toThrow(RangeError);
    expect(() => istDateOf(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
