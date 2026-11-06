import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewPanel } from "@/app/(staff)/staff/reconciliation/[importId]/review-panel";
import { nextRowOf } from "@/app/(staff)/staff/reconciliation/[importId]/workspace-view";
import type { ReviewData } from "@/lib/reconciliation/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const IMPORT = "11111111-2222-3333-4444-555555555555";
const LONG = "UPI/710000000003/T21-1601 Aamir Shaikh/maintenance payment for the month of October, paid at the branch counter";

const review = (over: Partial<ReviewData> = {}): ReviewData => ({
  id: "a0000000-0000-0000-0000-000000000001",
  importId: IMPORT,
  version: 1,
  state: "QUEUED",
  txnDate: "2026-10-27",
  creditPaise: "566000",
  narration: LONG,
  rail: "UPI",
  reference: "710000000003",
  payerName: "AAMIR SHAIKH",
  upiId: "aamir.s@oksbi",
  reasons: [
    { code: "AMOUNT_PRINCIPAL_ONLY", text: "Amount equals the unpaid bill but not the late fee: ₹38 would remain" },
    { code: "CODE_FOUND", text: "Flat code T21-1601 is in the narration" },
  ],
  candidates: [
    { flatCode: "T21-1601", tower: "T21", residents: ["Aamir Shaikh"], openPositions: [{ billId: "b1", kind: "PRINCIPAL_OPEN", dueOn: "2026-09-10", amountDuePaise: "569800", principalOutstandingPaise: "566000", feePaise: "3800" }], amountRelation: "EQUALS_PRINCIPAL" },
    { flatCode: "T12-0408", tower: "T12", residents: ["Swati Joshi", "Anil Joshi"], openPositions: [{ billId: "b2", kind: "FEE_ONLY", dueOn: "2026-09-10", amountDuePaise: "9800", principalOutstandingPaise: "0", feePaise: "9800" }], amountRelation: "MORE_THAN_DUE" },
    { flatCode: "T07-1203", tower: "T07", residents: [], openPositions: [], amountRelation: "NO_OPEN_POSITION" },
  ],
  thresholdPaise: "1000000",
  ...over,
});
const panel = (data: ReviewData = review(), over: Partial<Parameters<typeof ReviewPanel>[0]> = {}) => html(h(ReviewPanel, { review: data, importId: IMPORT, lane: "NEEDS_YOU", nextRowId: null, actionsAllowed: true, ...over }));

describe("RR1 the panel frame and the bank facts", () => {
  const out = panel();

  it("is a complementary landmark named by its heading, which can take focus, with a Close button", () => {
    expect(out).toContain('<aside aria-labelledby="recon-panel-title"');
    expect(out).toMatch(/<h2 id="recon-panel-title" tabindex="-1"[^>]*>Review this payment<\/h2>/);
    expect(out).toMatch(/<button [^>]*>Close<\/button>/);
  });

  it("is a full-screen sheet below 1024px and a docked panel from 1024px", () => {
    expect(out).toContain("fixed inset-0");
    expect(out).toContain("lg:w-[28rem]");
    expect(out).toContain("lg:left-auto");
  });

  it("shows the date, the amount, the FULL narration, the rail, the reference, the payer name and the UPI id", () => {
    expect(out).toContain("27 Oct 2026");
    expect(out).toContain("₹5,660");
    expect(out).toContain(LONG);
    expect(out).toContain(">UPI<");
    expect(out).toContain("710000000003");
    expect(out).toContain("AAMIR SHAIKH");
    expect(out).toContain("aamir.s@oksbi");
  });

  it("says 'Not stated' for a fact the bank did not give", () => {
    const bare = panel(review({ reference: null, payerName: null, upiId: null, rail: null }));
    expect(count(bare, />Not stated</g)).toBe(4);
  });

  it("'Why this needs you' lists the stored reasons as sentences", () => {
    expect(out).toContain("Why this needs you");
    expect(out).toContain("Amount equals the unpaid bill but not the late fee: ₹38 would remain.");
    expect(out).toContain("Flat code T21-1601 is in the narration.");
  });

  it("has no 'Why' section when no reason is stored", () => {
    expect(panel(review({ reasons: [] }))).not.toContain("Why this needs you");
  });
});

describe("RR2 the candidates", () => {
  const out = panel();

  it("are radio options in one group, nothing chosen in advance", () => {
    expect(count(out, /type="radio"/g)).toBe(3);
    expect(count(out, /type="radio"[^>]*checked/g)).toBe(0);
    const names = new Set([...out.matchAll(/<input [^>]*type="radio"[^>]*name="([^"]+)"|<input [^>]*name="([^"]+)"[^>]*type="radio"/g)].map((m) => m[1] ?? m[2]));
    expect(names.size).toBe(1);
  });

  it("each shows the flat code, the residents, and its open positions with kind, due date and amount due", () => {
    expect(out).toContain(">T21-1601<");
    expect(out).toContain("Residents: Aamir Shaikh");
    expect(out).toContain("Residents: Swati Joshi, Anil Joshi");
    expect(out).toContain("No current resident");
    expect(out).toContain("Bill due 10 Sep");
    expect(out).toContain("Late fee only, from the bill due 10 Sep");
    expect(out).toContain("₹5,698");
    expect(out).toContain("₹98");
  });

  it("says in words how the amount compares with the amount due", () => {
    expect(out).toContain("Equals the unpaid bill, ₹38 of late fee would still be due");
    expect(out).toContain("More than the amount due");
    expect(out).toContain("This flat has no open bill");
    expect(panel(review({ candidates: [{ ...review().candidates[0], amountRelation: "EQUALS_DUE" }] }))).toContain("Equals the amount due");
    expect(panel(review({ creditPaise: "565800", candidates: [{ ...review().candidates[0], amountRelation: "LESS_THAN_DUE" }] }))).toContain("₹40 less than the amount due");
  });

  it("every option is a label at least 48px tall", () => {
    expect(count(out, /<label class="flex min-h-12 cursor-pointer items-start/g)).toBe(3);
  });

  it("a row with no candidate says to search", () => {
    expect(panel(review({ candidates: [] }))).toContain("The matcher found no flat for this payment. Search for the flat below.");
  });
});

describe("RR3 choosing another flat", () => {
  const out = panel();

  it("has a labelled search field and says it needs 2 characters", () => {
    expect(out).toContain("Choose another flat");
    expect(out).toMatch(/<input [^>]*type="search"/);
    expect(out).toContain("at least 2 characters");
    expect(out).toMatch(/<label [^>]*for="[^"]+"[^>]*>Choose another flat<\/label>/);
  });

  it("announces results in a polite live region", () => {
    expect(out).toMatch(/aria-live="polite"/);
  });
});

describe("RR4 the reason, the payer and the threshold", () => {
  it("the reason is a required, labelled field with a counter of characters", () => {
    const out = panel();
    expect(out).toMatch(/<label [^>]*for="[^"]+"[^>]*>Reason \(required\)<\/label>/);
    expect(out).toContain("<textarea");
    expect(out).toContain("0 of 500 characters");
    expect(out).toContain("At least 5 characters");
  });

  it("'Remember this payer's UPI id for this flat' is there only when a UPI id exists", () => {
    expect(panel()).toContain("Remember this payer&#x27;s UPI id for this flat");
    expect(panel()).toMatch(/type="checkbox"/);
    const none = panel(review({ upiId: null }));
    expect(none).not.toContain("Remember this payer");
    expect(none).not.toMatch(/type="checkbox"/);
  });

  it("D116 a credit at or above the threshold shows the notice, naming the amount from the setting", () => {
    const big = panel(review({ creditPaise: "1066000" }));
    expect(big).toContain("This needs a second approver. It will wait in Awaiting approval.");
    expect(big).toContain("Credits of ₹10,000 or more need a second approver.");
    const atTheLine = panel(review({ creditPaise: "1000000" }));
    expect(atTheLine).toContain("second approver");
    expect(panel(review({ creditPaise: "1066000", thresholdPaise: "2500000" }))).not.toContain("second approver");
    expect(panel(review({ creditPaise: "3000000", thresholdPaise: "2500000" }))).toContain("₹25,000 or more");
  });

  it("below the threshold there is no such notice", () => {
    expect(panel()).not.toContain("second approver");
  });
});

describe("RR5 the actions", () => {
  const out = panel();

  it("RR5a the primary action is disabled until a flat and a valid reason (here: neither yet), and dashed, not just grey", () => {
    expect(out).toMatch(/<button [^>]*disabled=""[^>]*border-dashed[^>]*>Post<\/button>|<button [^>]*border-dashed[^>]*disabled=""[^>]*>Post<\/button>/);
    expect(out).not.toContain("bg-accent");
  });

  it("'Not a maintenance payment' is the outlined action and is available", () => {
    expect(out).toMatch(/<button [^>]*border-control[^>]*>Not a maintenance payment<\/button>/);
    expect(out).not.toMatch(/<button [^>]*disabled[^>]*>Not a maintenance payment<\/button>/);
  });

  it("there is no accept-all and no bulk action anywhere in the panel", () => {
    expect(out).not.toMatch(/accept all|approve all|post all|select all|bulk/i);
    expect(count(out, /type="checkbox"/g)).toBeLessThanOrEqual(1);
  });

  it("a row that is not waiting for a person shows the facts and no actions", () => {
    const done = panel(review({ state: "MANUALLY_MATCHED" }));
    expect(done).toContain("This row is not waiting for you any more.");
    expect(done).not.toContain(">Post<");
    expect(done).not.toContain("Not a maintenance payment");
    expect(done).toContain(LONG);
  });

  it("an import whose counts do not add up gets the facts and no action buttons, with the reason", () => {
    const off = panel(review(), { actionsAllowed: false });
    expect(off).toContain("Actions are switched off for this import because its counts do not add up.");
    expect(off).toContain('role="alert"');
    expect(off).not.toContain(">Post<");
    expect(off).not.toContain("Not a maintenance payment");
    expect(off).not.toContain("<textarea");
  });
});

describe("RR6 the next row", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("is the one after, else the one before, else none", () => {
    expect(nextRowOf(rows, "a")).toBe("b");
    expect(nextRowOf(rows, "b")).toBe("c");
    expect(nextRowOf(rows, "c")).toBe("b");
    expect(nextRowOf([{ id: "a" }], "a")).toBeNull();
    expect(nextRowOf(rows, "zzz")).toBeNull();
    expect(nextRowOf(rows, null)).toBeNull();
  });
});
