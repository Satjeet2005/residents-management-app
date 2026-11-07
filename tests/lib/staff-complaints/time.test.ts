import { describe, expect, it } from "vitest";
import { ageWords, durationWords, slaWords, whenWords } from "@/lib/staff-complaints/time";

describe("SC4 minutes to words", () => {
  it.each([
    [0, "less than 1 min"],
    [0.9, "less than 1 min"],
    [-5, "less than 1 min"],
    [1, "1 min"],
    [40, "40 min"],
    [59, "59 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [120, "2 h"],
    [125.9, "2 h 5 min"],
    [1439, "23 h 59 min"],
    [1440, "1 d"],
    [1440 + 120, "1 d 2 h"],
    [3 * 1440 + 59, "3 d"],
    [10 * 1440, "10 d"],
  ])("%s minutes is %s", (minutes, words) => {
    expect(durationWords(minutes)).toBe(words);
  });

  it("an age reads the same way", () => {
    expect(ageWords(185)).toBe("3 h 5 min");
  });
});

describe("SC5 the reply clock in words", () => {
  const now = Date.UTC(2026, 10, 6, 6, 30);
  const minute = 60_000;
  it("due in the future: 'Reply due in 40 min'", () => {
    expect(slaWords({ sla: "ON_TIME", responseDueAt: now + 40 * minute, now })).toBe("Reply due in 40 min");
  });

  it("past due: 'Reply overdue by 2 h'", () => {
    expect(slaWords({ sla: "OVERDUE", responseDueAt: now - 2 * 60 * minute, now })).toBe("Reply overdue by 2 h");
    expect(slaWords({ sla: "OVERDUE", responseDueAt: now - 30 * 1000, now })).toBe("Reply overdue by less than 1 min");
  });

  it("answered in time, closed, and no due time", () => {
    expect(slaWords({ sla: "MET", responseDueAt: now - minute, now })).toBe("Replied in time");
    expect(slaWords({ sla: "LATE", responseDueAt: now - minute, now })).toBe("Replied late");
    expect(slaWords({ sla: "NONE", responseDueAt: now - minute, now })).toBe("No reply clock");
    expect(slaWords({ sla: "ON_TIME", responseDueAt: null, now })).toBe("No reply clock");
  });
});

describe("SC5b an instant in India time", () => {
  it("is the date and the clock time with minutes, in India time", () => {
    expect(whenWords(Date.UTC(2026, 10, 6, 6, 30))).toBe("6 Nov, 12:00 pm");
    expect(whenWords(Date.UTC(2026, 10, 6, 18, 31))).toBe("7 Nov, 12:01 am");
  });
});
