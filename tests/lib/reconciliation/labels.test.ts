import { describe, expect, it } from "vitest";
import { confidenceLabel, entryLabel, ignoreKindLabel, postedByLabel, railLabel, reasonSentence, relationLabel, requestActionLabel, shortNarration, thresholdNotice } from "@/lib/reconciliation/labels";

describe("RB1 labels", () => {
  it("the confidence words are High, Medium, Low and No match (a missing one is No match)", () => {
    expect(["HIGH", "MEDIUM", "LOW", "NONE", null].map(confidenceLabel)).toEqual(["High", "Medium", "Low", "No match", "No match"]);
  });

  it("the relation says it in words, with the difference worked out from the credit and the amount due", () => {
    expect(relationLabel("EQUALS_DUE", 569_800n, 569_800n)).toBe("Equals the amount due");
    expect(relationLabel("LESS_THAN_DUE", 565_800n, 569_800n)).toBe("₹40 less than the amount due");
    expect(relationLabel("EQUALS_PRINCIPAL", 566_000n, 569_800n)).toBe("Equals the unpaid bill, ₹38 of late fee would still be due");
    expect(relationLabel("MORE_THAN_DUE", 700_000n, 569_800n)).toBe("More than the amount due");
    expect(relationLabel("NO_OPEN_POSITION", 1_000n, null)).toBe("This flat has no open bill");
  });

  it("a ₹38 shortfall reads '₹38 less than the amount due'", () => {
    expect(relationLabel("LESS_THAN_DUE", 646_800n - 3_800n, 646_800n)).toBe("₹38 less than the amount due");
  });

  it("a reason is one sentence with a full stop", () => {
    expect(reasonSentence({ text: "No flat found. May not be a maintenance payment." })).toBe("No flat found. May not be a maintenance payment.");
    expect(reasonSentence({ text: "Needs a second approver when posted " })).toBe("Needs a second approver when posted.");
  });

  it("a narration over 60 characters is cut with an ellipsis, a short one is not", () => {
    const long = "UPI/720000000001/MEERA QURESHI/meera.q@demo/T01-0205/maintenance for the month of October";
    expect(Array.from(shortNarration(long)).length).toBeLessThanOrEqual(61);
    expect(shortNarration(long).endsWith("…")).toBe(true);
    expect(shortNarration(long)).toBe(`${long.slice(0, 60).trimEnd()}…`);
    expect(shortNarration("CASH DEPOSIT")).toBe("CASH DEPOSIT");
    expect(shortNarration("x".repeat(60))).toBe("x".repeat(60));
  });

  it("an ignore kind, a rail and who posted are in words", () => {
    expect(["DEBIT", "INTEREST", "BANK_CHARGE", "NOT_MAINTENANCE", null].map(ignoreKindLabel)).toEqual(["Money going out", "Bank interest", "Bank charge", "Not a maintenance payment", "Not a maintenance payment"]);
    expect(["UPI", "CHEQUE_DEPOSIT", "CASH_DEPOSIT", "UNKNOWN", null].map(railLabel)).toEqual(["UPI", "Cheque deposit", "Cash deposit", "Not stated", "Not stated"]);
    expect(postedByLabel({ kind: "AUTO" })).toBe("Automatic");
    expect(postedByLabel({ kind: "MANUAL", name: "Priya Nair" })).toBe("Manual by Priya Nair");
  });

  it("an entry is its type and amount, and a request is its action", () => {
    expect(entryLabel({ entryType: "LATE_FEE", amountPaise: "3800" })).toBe("Late fee ₹38");
    expect(entryLabel({ entryType: "PAYMENT", amountPaise: "566000" })).toBe("Payment ₹5,660");
    expect(requestActionLabel("MATCH", "T21-1601")).toBe("Match to T21-1601");
    expect(requestActionLabel("IGNORE", null)).toBe("Not a maintenance payment");
  });

  it("D116 the threshold notice names the amount it is given, not a fixed one", () => {
    expect(thresholdNotice(1_000_000n)).toContain("₹10,000");
    expect(thresholdNotice(2_500_000n)).toContain("₹25,000");
    expect(thresholdNotice(1_000_000n)).toContain("This needs a second approver. It will wait in Awaiting approval.");
    expect(thresholdNotice(1_000_000n)).not.toContain("₹25,000");
  });
});
