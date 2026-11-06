import { describe, expect, it } from "vitest";
import { businessNow, isBusinessClockFrozen, isDemoMode } from "@/server/clock";
import { istDateOf } from "@/domain/time/calendar";
import { formatTimeIst } from "@/lib/format-date";

const REAL = Date.UTC(2026, 10, 6, 4, 0, 0);

describe("D97 businessNow", () => {
  it("is the real time when DEMO_AS_OF is unset or empty", () => {
    expect(businessNow({}, REAL)).toBe(REAL);
    expect(businessNow({ DEMO_AS_OF: "" }, REAL)).toBe(REAL);
    expect(businessNow({ DEMO_AS_OF: "   " }, REAL)).toBe(REAL);
  });

  it("is 12:00 India time on the date when DEMO_AS_OF is set", () => {
    const now = businessNow({ DEMO_AS_OF: "2026-10-27" }, REAL);
    expect(now).toBe(Date.UTC(2026, 9, 27, 6, 30, 0));
    expect(istDateOf(now)).toBe("2026-10-27");
    expect(formatTimeIst(now)).toBe("12 pm");
  });

  it("does not depend on the real time once frozen", () => {
    expect(businessNow({ DEMO_AS_OF: "2026-10-27" }, 0)).toBe(businessNow({ DEMO_AS_OF: "2026-10-27" }, REAL * 2));
  });

  it("works on a leap day and tolerates spaces around the value", () => {
    expect(istDateOf(businessNow({ DEMO_AS_OF: " 2028-02-29 " }, REAL))).toBe("2028-02-29");
  });

  it.each(["2026-13-01", "2026-02-30", "27-10-2026", "2026/10/27", "yesterday", "2026-1-1", "20261027"])("a bad value %j throws instead of falling back", (value) => {
    expect(() => businessNow({ DEMO_AS_OF: value }, REAL)).toThrow(RangeError);
  });

  it("isBusinessClockFrozen reports whether the override is set", () => {
    expect(isBusinessClockFrozen({})).toBe(false);
    expect(isBusinessClockFrozen({ DEMO_AS_OF: "" })).toBe(false);
    expect(isBusinessClockFrozen({ DEMO_AS_OF: "2026-10-27" })).toBe(true);
  });
});

describe("D97 isDemoMode", () => {
  it.each([["true", true], ["false", false], ["TRUE", false], ["1", false], ["", false], [undefined, false], [" true", false]])("DEMO_MODE %j is %s", (value, expected) => {
    expect(isDemoMode({ DEMO_MODE: value })).toBe(expected);
  });
});
