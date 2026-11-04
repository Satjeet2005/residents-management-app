import { describe, expect, it } from "vitest";
import { checkConfirmed, checkDemoMode, checkEmpty, describeTarget } from "@/server/seed/guards";

describe("G1 seed guards", () => {
  it("G1 DEMO_MODE must be exactly the text true", () => {
    expect(checkDemoMode("true").ok).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) expect(checkDemoMode(value).ok, String(value)).toBe(false);
  });

  it("G1 the database must have no flats, and the refusal points at db:reset-demo", () => {
    expect(checkEmpty(0).ok).toBe(true);
    const refused = checkEmpty(2400);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("not empty");
      expect(refused.reason).toContain("npm run db:reset-demo");
    }
  });

  it("G1 --yes must be present as its own argument", () => {
    expect(checkConfirmed(["--yes"]).ok).toBe(true);
    expect(checkConfirmed(["--reset", "--yes"]).ok).toBe(true);
    for (const args of [[], ["--reset"], ["yes"], ["--yes-please"], ["-y"]]) expect(checkConfirmed(args).ok, args.join(" ")).toBe(false);
  });

  it("G1 the printed target is the host and database name only, never the user, password or URL", () => {
    const text = describeTarget("postgresql://someuser:s3cretpass@db.example.test:5436/township?sslmode=require");
    expect(text).toBe("host db.example.test:5436, database township");
    expect(text).not.toMatch(/someuser|s3cretpass|postgresql|sslmode/);
  });
});
