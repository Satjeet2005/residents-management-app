import { describe, expect, it } from "vitest";
import { computeLateFee } from "@/domain/billing/late-fee";
import { defaultMatchSettings } from "@/domain/matching/context";
import { planPayment } from "@/domain/matching/plan";
import { bill, flat } from "./builders";

const settings = defaultMatchSettings;
const SEPT = bill("sep", 637000n, "2026-09-10");

describe("planPayment", () => {
  it("a late fee charge then one payment of principal plus fee, both on the row's date", () => {
    expect(planPayment(flat("T12-0408", { bills: [SEPT] }), 646800n, "2026-10-27", settings)).toEqual({
      entries: [
        { entryType: "LATE_FEE", amountPaise: 9800n, effectiveDate: "2026-10-27", billKey: "sep" },
        { entryType: "PAYMENT", amountPaise: 646800n, effectiveDate: "2026-10-27", billKey: "sep" },
      ],
    });
  });

  it("no late fee entry when the fee is zero", () => {
    const plan = planPayment(flat("T12-0408", { bills: [SEPT] }), 637000n, "2026-09-10", settings);
    expect(plan.entries).toEqual([{ entryType: "PAYMENT", amountPaise: 637000n, effectiveDate: "2026-09-10", billKey: "sep" }]);
  });

  it("a part-paid bill: the fee is on what was left, the payment is what is left plus the fee", () => {
    const part = bill("oct", 1066000n, "2026-10-09", [{ date: "2026-10-12", amountPaise: 500000n }]);
    const plan = planPayment(flat("T21-1601", { bills: [part] }), 569800n, "2026-10-27", settings);
    expect(plan.entries.map((e) => [e.entryType, e.amountPaise])).toEqual([["LATE_FEE", 3800n], ["PAYMENT", 569800n]]);
  });

  it("settles the oldest bill whatever the order of the list", () => {
    const newer = bill("oct", 637000n, "2026-10-10");
    const plan = planPayment(flat("T12-0408", { bills: [newer, SEPT] }), 646800n, "2026-10-27", settings);
    expect(new Set(plan.entries.map((e) => e.billKey))).toEqual(new Set(["sep"]));
  });

  it("the fee equals computeLateFee and there is exactly one payment", () => {
    const plan = planPayment(flat("T12-0408", { bills: [SEPT] }), 646800n, "2026-10-27", settings);
    const fee = computeLateFee({ billAmountPaise: 637000n, dueOn: "2026-09-10", asOf: "2026-10-27", payments: [], holds: [], policy: settings.lateFeePolicy }).feePaise;
    expect(plan.entries.filter((e) => e.entryType === "LATE_FEE").map((e) => e.amountPaise)).toEqual([fee]);
    expect(plan.entries.filter((e) => e.entryType === "PAYMENT")).toHaveLength(1);
  });

  it("throws when the credit is not the amount due", () => {
    const f = flat("T12-0408", { bills: [SEPT] });
    for (const credit of [637000n, 646799n, 646801n, 1274000n]) {
      expect(() => planPayment(f, credit, "2026-10-27", settings)).toThrow(RangeError);
    }
  });

  it("throws when there is no open bill, or payments already cover it", () => {
    expect(() => planPayment(flat("T07-1203"), 100n, "2026-10-27", settings)).toThrow(/no open bill/);
    const covered = bill("sep", 637000n, "2026-09-10", [{ date: "2026-10-01", amountPaise: 637000n }]);
    expect(() => planPayment(flat("T07-1203", { bills: [covered] }), 100n, "2026-10-27", settings)).toThrow(RangeError);
  });
});
