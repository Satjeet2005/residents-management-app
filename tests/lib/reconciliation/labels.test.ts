import { describe, expect, it } from "vitest";
import { confidenceLabel, entryLabel, ignoreKindLabel, payerNoticeText, postedByLabel, railLabel, reasonSentence, relationLabel, requestActionLabel, narrationPreview, reasonLine, thresholdNotice } from "@/lib/reconciliation/labels";

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

  it("a narration over 90 characters is cut at the last space, never inside a word, with an ellipsis; a short one is not", () => {
    const long = "UPI/720000000001/MEERA QURESHI/meera.q@demo/T01-0205/maintenance for the month of October and the advance for the next one";
    const cut = narrationPreview(long);
    expect(cut.endsWith("…")).toBe(true);
    expect(Array.from(cut).length).toBeLessThanOrEqual(91);
    const kept = cut.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
    expect(narrationPreview("CASH DEPOSIT")).toBe("CASH DEPOSIT");
    expect(narrationPreview("x".repeat(90))).toBe("x".repeat(90));
  });

  it("an unbroken first word longer than the limit is cut at the limit", () => {
    expect(narrationPreview("x".repeat(200))).toBe(`${"x".repeat(90)}…`);
  });

  it("the reason line says No flat found, or the best flat with the confidence in words", () => {
    expect(reasonLine({ bestFlat: null, confidence: null })).toBe("No flat found");
    expect(reasonLine({ bestFlat: "T12-0702", confidence: "LOW" })).toBe("Best match T12-0702 · Low");
    expect(reasonLine({ bestFlat: "T21-1601", confidence: "HIGH" })).toBe("Best match T21-1601 · High");
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

  it("the payer notice says whether the UPI id was remembered, was already known, or belongs to another flat", () => {
    expect(payerNoticeText("ADDED")).toBe("The payer's UPI id is now remembered for this flat.");
    expect(payerNoticeText("ALREADY_KNOWN")).toContain("already remembered");
    expect(payerNoticeText("VPA_ON_OTHER_FLAT")).toContain("belongs to another flat");
  });

  it("D116 the threshold notice names the amount it is given, not a fixed one", () => {
    expect(thresholdNotice(1_000_000n)).toContain("₹10,000");
    expect(thresholdNotice(2_500_000n)).toContain("₹25,000");
    expect(thresholdNotice(1_000_000n)).toContain("This needs a second approver. It will wait in Awaiting approval.");
    expect(thresholdNotice(1_000_000n)).not.toContain("₹25,000");
  });
});
