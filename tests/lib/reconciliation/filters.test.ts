import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, activeFilters, amountLabel, effectiveFilters, narrowsRows, parseFilters, reasonApplies } from "@/lib/reconciliation/filters";
import { workspaceHref } from "@/lib/reconciliation/lanes";

describe("RF1 parseFilters allowlists every word (D192)", () => {
  it("an empty query is the defaults: largest first, any amount, any reason", () => {
    expect(parseFilters({})).toEqual({ sort: "largest", amount: "any", reason: "any" });
  });

  it("reads the allowed words", () => {
    expect(parseFilters({ sort: "oldest", amount: "high", reason: "several" })).toEqual({ sort: "oldest", amount: "high", reason: "several" });
    expect(parseFilters({ amount: "low", reason: "noflat" })).toMatchObject({ amount: "low", reason: "noflat" });
    expect(parseFilters({ reason: "differs" }).reason).toBe("differs");
    expect(parseFilters({ reason: "low" }).reason).toBe("low");
  });

  it.each(["", "OLDEST", "oldest ", "old", "'; DROP TABLE bank_rows; --", "__proto__", "constructor", "1", "0", "-1", "null", "undefined", "%00", "<script>", "largest,oldest"])("the hostile or unknown value %j is the default", (value) => {
    expect(parseFilters({ sort: value, amount: value, reason: value })).toEqual(DEFAULT_FILTERS);
  });

  it("a repeated key takes the first value, and an array of hostile values is the default", () => {
    expect(parseFilters({ sort: ["oldest", "largest"] }).sort).toBe("oldest");
    expect(parseFilters({ sort: ["bogus", "oldest"] }).sort).toBe("largest");
    expect(parseFilters({ amount: [] }).amount).toBe("any");
  });
});

describe("RF2 what applies where", () => {
  it("the reason filter applies to Needs you and Awaiting approval only", () => {
    expect(reasonApplies("NEEDS_YOU")).toBe(true);
    expect(reasonApplies("AWAITING_APPROVAL")).toBe(true);
    expect(reasonApplies("MATCHED")).toBe(false);
    expect(reasonApplies("NOT_MAINTENANCE")).toBe(false);
    expect(effectiveFilters({ sort: "oldest", amount: "high", reason: "noflat" }, "MATCHED")).toEqual({ sort: "oldest", amount: "high", reason: "any" });
  });

  it("the threshold in the words comes from the number given, never a fixed one", () => {
    expect(amountLabel("high", 1_000_000n)).toBe("₹10,000 or more (needs a second approver)");
    expect(amountLabel("low", 1_000_000n)).toBe("Under ₹10,000");
    expect(amountLabel("high", 2_500_000n)).toBe("₹25,000 or more (needs a second approver)");
    expect(amountLabel("any", 1n)).toBe("Any amount");
  });

  it("chips are the choices that differ from the default; a sort alone reorders and does not narrow", () => {
    expect(activeFilters(DEFAULT_FILTERS, "NEEDS_YOU", 1_000_000n)).toEqual([]);
    expect(activeFilters({ sort: "oldest", amount: "low", reason: "noflat" }, "NEEDS_YOU", 1_000_000n).map((c) => c.name)).toEqual(["Oldest first", "Under ₹10,000", "No flat found"]);
    expect(activeFilters({ sort: "oldest", amount: "low", reason: "noflat" }, "MATCHED", 1_000_000n).map((c) => c.key)).toEqual(["sort", "amount"]);
    expect(narrowsRows({ sort: "oldest", amount: "any", reason: "any" }, "NEEDS_YOU")).toBe(false);
    expect(narrowsRows({ sort: "largest", amount: "high", reason: "any" }, "NEEDS_YOU")).toBe(true);
    expect(narrowsRows({ sort: "largest", amount: "any", reason: "low" }, "MATCHED")).toBe(false);
  });
});

describe("RF3 the address carries the filters", () => {
  const IMPORT = "11111111-2222-3333-4444-555555555555";
  it("leaves out whatever is the default, so the plain address stays plain", () => {
    expect(workspaceHref({ importId: IMPORT, lane: "NEEDS_YOU" })).toBe(`/staff/reconciliation/${IMPORT}`);
    expect(workspaceHref({ importId: IMPORT, lane: "NEEDS_YOU", filters: DEFAULT_FILTERS })).toBe(`/staff/reconciliation/${IMPORT}`);
  });

  it("writes lane, sort, amount, reason and row, in that order, when they are not the default", () => {
    expect(workspaceHref({ importId: IMPORT, lane: "AWAITING_APPROVAL", filters: { sort: "oldest", amount: "high", reason: "low" }, row: "a0000000-0000-0000-0000-000000000001" })).toBe(
      `/staff/reconciliation/${IMPORT}?lane=awaiting-approval&sort=oldest&amount=high&reason=low&row=a0000000-0000-0000-0000-000000000001`,
    );
  });
});
