import { describe, expect, it } from "vitest";
import { parseAutoCloseDays } from "@/server/complaints/context";

describe("AC1 the auto_close_days setting of the committee report (D211)", () => {
  it("a whole number of days from 1 to 365 is used", () => {
    expect(parseAutoCloseDays(12)).toBe(12);
    expect(parseAutoCloseDays(365)).toBe(365);
  });

  it("a missing, zero, negative, fractional, huge or non-numeric value gives the documented default of 7 days", () => {
    for (const bad of [undefined, null, 0, -3, 1.5, 366, "soon", "7", {}]) expect(parseAutoCloseDays(bad)).toBe(7);
  });
});
