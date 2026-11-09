import { describe, expect, it } from "vitest";
import { landsOnReport } from "@/domain/auth/staff-landing";

describe("SH8 who lands on the committee report (D236)", () => {
  it("a person whose only tool is the report lands on it", () => {
    expect(landsOnReport(["reports:view"])).toBe(true);
  });

  it.each(["complaints:manage", "payments:match", "payments:approve", "complaints:duty_manager"])("the report plus %s keeps the staff home", (other) => {
    expect(landsOnReport(["reports:view", other])).toBe(false);
  });

  it("no report permission, no permissions, and unknown words never land on the report", () => {
    expect(landsOnReport([])).toBe(false);
    expect(landsOnReport(["payments:match"])).toBe(false);
    expect(landsOnReport(["something:new"])).toBe(false);
    expect(landsOnReport(["reports:view", "something:new"])).toBe(true);
  });
});
