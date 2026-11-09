import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { businessNow, isBusinessClockFrozen, isDemoMode, realNow } from "@/server/clock";
import { istDateOf } from "@/domain/time/calendar";
import { formatTimeIst } from "@/lib/format-date";

const REAL = Date.UTC(2026, 10, 6, 4, 0, 0);
const DEMO = { DEMO_MODE: "true" } as const;

describe("D97 businessNow", () => {
  it("is the real time when DEMO_AS_OF is unset or empty", () => {
    expect(businessNow({}, REAL)).toBe(REAL);
    expect(businessNow({ ...DEMO, DEMO_AS_OF: "" }, REAL)).toBe(REAL);
    expect(businessNow({ ...DEMO, DEMO_AS_OF: "   " }, REAL)).toBe(REAL);
  });

  it("is 12:00 India time on the date when DEMO_AS_OF is set", () => {
    const now = businessNow({ ...DEMO, DEMO_AS_OF: "2026-10-27" }, REAL);
    expect(now).toBe(Date.UTC(2026, 9, 27, 6, 30, 0));
    expect(istDateOf(now)).toBe("2026-10-27");
    expect(formatTimeIst(now)).toBe("12 pm");
  });

  it("does not depend on the real time once frozen", () => {
    expect(businessNow({ ...DEMO, DEMO_AS_OF: "2026-10-27" }, 0)).toBe(businessNow({ ...DEMO, DEMO_AS_OF: "2026-10-27" }, REAL * 2));
  });

  it("works on a leap day and tolerates spaces around the value", () => {
    expect(istDateOf(businessNow({ ...DEMO, DEMO_AS_OF: " 2028-02-29 " }, REAL))).toBe("2028-02-29");
  });

  it.each(["2026-13-01", "2026-02-30", "27-10-2026", "2026/10/27", "yesterday", "2026-1-1", "20261027"])("a bad value %j throws instead of falling back", (value) => {
    expect(() => businessNow({ ...DEMO, DEMO_AS_OF: value }, REAL)).toThrow(RangeError);
  });

  it("D228 the override exists only in demo mode: with DEMO_MODE not exactly 'true' the real clock is used, whatever DEMO_AS_OF says", () => {
    for (const mode of [undefined, "false", "", "TRUE", "1", " true"]) {
      expect(businessNow({ DEMO_MODE: mode, DEMO_AS_OF: "2026-10-27" }, REAL)).toBe(REAL);
      expect(isBusinessClockFrozen({ DEMO_MODE: mode, DEMO_AS_OF: "2026-10-27" })).toBe(false);
    }
    expect(businessNow({ DEMO_AS_OF: "2026-10-27" }, REAL)).toBe(REAL);
  });

  it("D228 with demo mode off even a bad DEMO_AS_OF is ignored, it does not throw", () => {
    expect(businessNow({ DEMO_MODE: "false", DEMO_AS_OF: "yesterday" }, REAL)).toBe(REAL);
  });

  it("isBusinessClockFrozen reports whether the override is set", () => {
    expect(isBusinessClockFrozen({})).toBe(false);
    expect(isBusinessClockFrozen({ ...DEMO, DEMO_AS_OF: "" })).toBe(false);
    expect(isBusinessClockFrozen({ ...DEMO, DEMO_AS_OF: "2026-10-27" })).toBe(true);
  });
});

describe("D97 isDemoMode", () => {
  it.each([["true", true], ["false", false], ["TRUE", false], ["1", false], ["", false], [undefined, false], [" true", false]])("DEMO_MODE %j is %s", (value, expected) => {
    expect(isDemoMode({ DEMO_MODE: value })).toBe(expected);
  });
});

describe("realNow", () => {
  it("is the real clock: it moves with Date.now() and ignores DEMO_AS_OF", () => {
    vi.stubEnv("DEMO_AS_OF", "2026-10-27");
    const before = Date.now();
    const value = realNow();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
    vi.unstubAllEnvs();
  });
});

describe("D228 the real clock is used everywhere in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with DEMO_MODE=false and DEMO_AS_OF set, businessNow() read from the process environment is the real time", () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("DEMO_AS_OF", "2026-10-27");
    const before = Date.now();
    const value = businessNow();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  it("with demo mode on and DEMO_AS_OF set, businessNow() read from the process environment is noon on that date", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2026-10-27");
    expect(businessNow()).toBe(Date.UTC(2026, 9, 27, 6, 30, 0));
  });

  it("no source file reads the DEMO_AS_OF variable (as a property read) except the clock and the readiness report (the seed has its own constant of that name), so no screen can bypass the demo-mode rule", () => {
    const root = join(process.cwd(), "src");
    const readers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && /\.DEMO_AS_OF\b|\[["']DEMO_AS_OF["']\]/.test(readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) readers.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    expect(readers.filter((file) => !file.startsWith("domain/seed/")).sort()).toEqual(["server/clock.ts", "server/health/readiness.ts"]);
  });
});
