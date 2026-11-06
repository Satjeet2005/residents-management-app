import { describe, expect, it } from "vitest";
import { MONTHS_LONG, MONTHS_SHORT, formatDay, formatClockIst, formatDayYear, formatTimeIst, monthName } from "@/lib/format-date";

describe("HM3 format-date (no Intl)", () => {
  it.each([["2026-10-27", "27 Oct"], ["2026-01-01", "1 Jan"], ["2026-09-10", "10 Sep"], ["2028-02-29", "29 Feb"], ["2026-12-31", "31 Dec"]])("formatDay %s is %s", (date, text) => {
    expect(formatDay(date)).toBe(text);
  });

  it.each([["2026-10-27", "27 Oct 2026"], ["2027-03-05", "5 Mar 2027"]])("formatDayYear %s is %s", (date, text) => {
    expect(formatDayYear(date)).toBe(text);
  });

  it("monthName gives the long month", () => {
    expect(monthName("2026-09-10")).toBe("September");
    expect(monthName("2026-05-01")).toBe("May");
  });

  it("has twelve months in each list, and the short names start the long ones", () => {
    expect(MONTHS_SHORT).toHaveLength(12);
    expect(MONTHS_LONG).toHaveLength(12);
    MONTHS_LONG.forEach((name, i) => expect(name.startsWith(MONTHS_SHORT[i])).toBe(true));
  });

  it("rejects a date that is not real", () => {
    expect(() => formatDay("2026-02-30")).toThrow(RangeError);
    expect(() => formatDay("nonsense")).toThrow(RangeError);
  });

  // 2026-10-26 is the day before; the instants are written in UTC and the India time is UTC + 5:30.
  it.each([
    [Date.UTC(2026, 9, 27, 11, 30), "5 pm"],
    [Date.UTC(2026, 9, 27, 12, 0), "5:30 pm"],
    [Date.UTC(2026, 9, 27, 6, 30), "12 pm"],
    [Date.UTC(2026, 9, 26, 18, 30), "12 am"],
    [Date.UTC(2026, 9, 26, 18, 35), "12:05 am"],
    [Date.UTC(2026, 9, 27, 3, 30), "9 am"],
    [Date.UTC(2026, 9, 27, 18, 29), "11:59 pm"],
    [Date.UTC(2026, 9, 27, 7, 15), "12:45 pm"],
  ])("formatTimeIst %i is %s", (instant, text) => {
    expect(formatTimeIst(instant)).toBe(text);
  });

  it("uses India time, not the machine's: the same instant is the same text", () => {
    expect(formatTimeIst(Date.UTC(2026, 9, 27, 11, 30))).toBe("5 pm");
  });

  it("rejects a non-finite instant", () => {
    expect(() => formatTimeIst(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatClockIst: the time with minutes always, in India time", () => {
  it.each([
    [Date.UTC(2026, 9, 27, 5, 30), "11:00 am"],
    [Date.UTC(2026, 9, 27, 11, 0), "4:30 pm"],
    [Date.UTC(2026, 9, 26, 18, 30), "12:00 am"],
    [Date.UTC(2026, 9, 27, 6, 30), "12:00 pm"],
    [Date.UTC(2026, 9, 27, 18, 29), "11:59 pm"],
  ])("%i is %s", (instant, text) => {
    expect(formatClockIst(instant)).toBe(text);
  });

  it("rejects a non-finite instant", () => {
    expect(() => formatClockIst(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
