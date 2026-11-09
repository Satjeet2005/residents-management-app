import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import { AccountFooter } from "@/components/staff/account-footer";
import type { StaffHomeData } from "@/server/staff/home-data";
import type { NextUpComplaint, NextUpPayment } from "@/server/staff/next-up";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }), usePathname: () => "/staff", redirect: () => {} }));

const html = renderToStaticMarkup;
const ID = "11111111-2222-3333-4444-555555555555";
const none: StaffHomeData = { complaints: null, unseenSafety: null, statements: null, approvals: null, paymentRows: null, complaintRows: null };
const statements = (over: Partial<NonNullable<StaffHomeData["statements"]>> = {}): StaffHomeData["statements"] => ({
  newest: { importId: ID, filename: "sample-statement.csv", uploadedOn: "2026-10-27", rowsRead: 106, accounted: true },
  needsPerson: 43,
  awaitingApproval: 2,
  ...over,
});
const payment = (over: Partial<NextUpPayment> = {}): NextUpPayment => ({ id: "r1", importId: ID, amountPaise: "1500000", txnDate: "2026-10-27", direction: "CREDIT", lane: "NEEDS_YOU", bestFlat: "T12-0702", confidence: "LOW", needsSecondApprover: false, ...over });
const complaint = (over: Partial<NextUpComplaint> = {}): NextUpComplaint => ({ id: "c1", title: "Water leaks in the lobby", flatCode: "T07-1203", category: "PLUMBING", urgency: "NORMAL", safety: false, responseDueAt: null, sla: "NONE", ...over });
const view = (permissions: string[], home: Partial<StaffHomeData> = {}) => html(h(StaffView, { name: "Test Person", permissions, home: { ...none, ...home }, now: 1_800_000_000_000 }));

describe("SH3 the staff home view (D186 to D188)", () => {
  it("the h1 is the role title and the next line says who is signed in; there is no 'Hello' and no link to itself", () => {
    const out = view(["complaints:manage", "complaints:duty_manager"]);
    expect(out).toMatch(/<h1[^>]*>Duty manager<\/h1>/);
    expect(out).toContain("Signed in as Test Person");
    expect(out).not.toContain("Hello");
    expect(out).not.toContain("Staff home");
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
  });

  it("the safety strip shows only for the duty manager with a count above zero, singular and plural, linking to the safety view", () => {
    const one = view(["complaints:manage", "complaints:duty_manager"], { unseenSafety: 1 });
    expect(one).toContain("1 safety complaint is open and not yet seen by the duty manager.");
    expect(one).toContain('href="/staff/complaints?view=safety"');
    expect(view(["complaints:manage", "complaints:duty_manager"], { unseenSafety: 3 })).toContain("3 safety complaints are open and not yet seen by the duty manager.");
    expect(view(["complaints:manage", "complaints:duty_manager"], { unseenSafety: 0 })).not.toContain("not yet seen");
    expect(view(["complaints:manage", "complaints:duty_manager"], { unseenSafety: null })).not.toContain("not yet seen");
    expect(view(["complaints:manage"], { unseenSafety: 5 })).not.toContain("not yet seen");
  });

  it("the approvals strip shows only for an approver with a count above zero, and links to the awaiting lane of that import", () => {
    const out = view(["payments:match", "payments:approve"], { statements: statements(), approvals: { waiting: 2, importId: ID } });
    expect(out).toContain("2 requests are waiting for your approval.");
    expect(out).toContain(`href="/staff/reconciliation/${ID}?lane=awaiting-approval"`);
    expect(view(["payments:match", "payments:approve"], { approvals: { waiting: 1, importId: ID } })).toContain("1 request is waiting for your approval.");
    expect(view(["payments:match", "payments:approve"], { approvals: { waiting: 0, importId: null } })).not.toContain("waiting for your approval");
    expect(view(["payments:match"], { approvals: { waiting: 4, importId: ID } })).not.toContain("waiting for your approval");
  });

  it("a strip has an icon and words, never colour alone", () => {
    const out = view(["complaints:manage", "complaints:duty_manager"], { unseenSafety: 2 });
    expect(out).toMatch(/<a [^>]*border-caution[^>]*><svg[^>]*aria-hidden="true"/);
  });

  it("the Complaints section says the counts, or that nothing needs you (with its rows loaded and empty), and has one filled link", () => {
    const busy = view(["complaints:manage"], { complaints: { needsAction: 7, overdue: 2 } });
    expect(busy).toContain("7 need action · 2 overdue");
    expect(busy).toMatch(/<a [^>]*bg-accent[^>]*href="\/staff\/complaints"[^>]*>Open complaints<\/a>|<a [^>]*href="\/staff\/complaints"[^>]*bg-accent[^>]*>Open complaints<\/a>/);
    expect(view(["complaints:manage"], { complaints: { needsAction: 0, overdue: 0 }, complaintRows: [] })).toContain("Nothing needs you right now.");
    const failed = view(["complaints:manage"], { complaints: null });
    expect(failed).toContain("Open complaints");
    expect(failed).not.toMatch(/need action|Nothing needs you/);
  });

  it("the matching card: last statement, totals over all imports, the accounted line with an icon, and the two links", () => {
    const out = view(["payments:match"], { statements: statements() });
    expect(out).toContain("Last statement: 27 Oct 2026");
    expect(out).not.toContain("sample-statement.csv");
    expect(out).toContain("43 need a person · 2 waiting for approval");
    expect(out).toContain("All 106 rows accounted for");
    expect(out).toContain(`href="/staff/reconciliation/${ID}"`);
    expect(out).toContain(">Open reconciliation<");
    expect(out).toContain(">Upload a new statement<");
    expect(out).toContain('href="/staff/reconciliation"');
    expect(view(["payments:match"], { statements: statements({ newest: { importId: ID, filename: "a.csv", uploadedOn: "2026-10-27", rowsRead: 5, accounted: false } }) })).not.toContain("accounted for");
  });

  it("with no statement ever imported it says so and the filled link is Upload a bank statement", () => {
    const out = view(["payments:match"], { statements: { newest: null, needsPerson: 0, awaitingApproval: 0 } });
    expect(out).toContain("No statement has been imported yet.");
    expect(out).toContain(">Upload a bank statement<");
    expect(out).not.toContain("Upload a new statement");
  });

  it("a person who has the report AND another tool gets a report section with only a link (no static text)", () => {
    const out = view(["reports:view", "complaints:manage"]);
    expect(out).toContain(">Open the report<");
    expect(out).not.toContain("month by month");
  });

  it("each tool section has exactly one filled control and its own heading", () => {
    const out = view(["complaints:manage", "payments:match", "reports:view"], { statements: statements() });
    expect((out.match(/<section/g) ?? []).length).toBe(4);
    expect((out.match(/bg-accent/g) ?? []).length).toBe(3);
  });

  it("the permissions are a closed details with a 48px summary, in words; Sign out is small (not full width) and outlined", () => {
    const out = view(["payments:match", "payments:approve"]);
    expect(out).toMatch(/<details><summary[^>]*min-h-12[^>]*>/);
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toContain("Match bank payments");
    expect(out).toContain("Approve large payments");
    expect(out).toMatch(/items-start[^"]*"><button[^>]*border-control[^>]*>Sign out<\/button>/);
  });

  it("a person with no tools sees one calm sentence and still has Sign out", () => {
    const out = view([]);
    expect(out).toContain("You do not have access to any tools yet. Ask the society office.");
    expect(out).toContain(">Sign out<");
    expect(out).toMatch(/<h1[^>]*>Staff<\/h1>/);
  });

  it("no resident name, phone or narration is part of the data the view takes", () => {
    const out = view(["payments:match", "complaints:manage", "reports:view"], { statements: statements(), complaints: { needsAction: 1, overdue: 1 } });
    expect(out).not.toMatch(/\b\d{10}\b|UPI\//);
  });
});

describe("SH6 the Next up rows (D237)", () => {
  it("a payment row is one link to the review of that row, with the amount and date, one reason line and no narration", () => {
    const out = view(["payments:match"], { statements: statements(), paymentRows: [payment()] });
    expect(out).toContain(`href="/staff/reconciliation/${ID}?row=r1"`);
    expect(out).toContain("₹15,000");
    expect(out).toContain("27 Oct");
    expect(out).toContain("Best match T12-0702 · Low");
    expect(out).toMatch(/<a [^>]*min-h-14[^>]*href=|<a [^>]*href=[^>]*min-h-14/);
    expect(out.split('aria-label="Next up"')[1].split("</ul>")[0].match(/<li>/g)).toHaveLength(1);
  });

  it("a row with no flat says so; a credit at or above the threshold adds the second approver; money out says so", () => {
    const out = view(["payments:match"], { statements: statements(), paymentRows: [payment({ bestFlat: null, confidence: null, needsSecondApprover: true, id: "r2" }), payment({ direction: "DEBIT", id: "r3" })] });
    expect(out).toContain("No flat found");
    expect(out).toContain("Needs a second approver");
    expect(out).toContain("Money out");
  });

  it("an approval row links to the awaiting lane of its import", () => {
    const out = view(["payments:match", "payments:approve"], { statements: statements(), paymentRows: [payment({ lane: "AWAITING_APPROVAL" })] });
    expect(out).toContain(`href="/staff/reconciliation/${ID}?lane=awaiting-approval&amp;row=r1"`);
  });

  it("See all appears only above three, with the count, and goes to the lane of the first row", () => {
    const rows = [payment({ id: "a" }), payment({ id: "b" }), payment({ id: "c" })];
    expect(view(["payments:match"], { statements: statements({ needsPerson: 3 }), paymentRows: rows })).not.toContain("See all");
    const more = view(["payments:match"], { statements: statements({ needsPerson: 43 }), paymentRows: rows });
    expect(more).toContain("See all 43 rows that need a person");
    expect(more).toContain(`href="/staff/reconciliation/${ID}"`);
    const approvals = view(["payments:match", "payments:approve"], { statements: statements(), approvals: { waiting: 5, importId: ID }, paymentRows: [payment({ lane: "AWAITING_APPROVAL" })] });
    expect(approvals).toContain("See all 5 rows waiting for approval");
    expect(view(["complaints:manage"], { complaints: { needsAction: 9, overdue: 0 }, complaintRows: [complaint()] })).toContain("See all 9 complaints that need action");
    expect(view(["complaints:manage"], { complaints: { needsAction: 3, overdue: 0 }, complaintRows: [complaint()] })).not.toContain("See all");
  });

  it("a complaint row is one link to the complaint: flat, category, a one-line excerpt, the safety tag and the overdue notice", () => {
    const out = view(["complaints:manage"], { complaints: { needsAction: 1, overdue: 1 }, complaintRows: [complaint({ id: "c9", safety: true, responseDueAt: 1_800_000_000_000 - 3_600_000, sla: "OVERDUE" })] });
    expect(out).toContain('href="/staff/complaints/c9"');
    expect(out).toContain("T07-1203");
    expect(out).toContain("Plumbing");
    expect(out).toContain("Water leaks in the lobby");
    expect(out).toMatch(/class="truncate [^"]*">Water leaks in the lobby/);
    expect(out).toContain("Safety");
    expect(out).toContain("Reply overdue 1 h");
  });

  it("no rows: one calm line, and the filled link stays; a failed read shows no list and no calm line", () => {
    const calm = view(["payments:match"], { statements: statements({ needsPerson: 0, awaitingApproval: 0 }), paymentRows: [] });
    expect(calm).toContain("Nothing needs you right now.");
    expect(calm).toContain("Last statement: 27 Oct 2026");
    const failed = view(["payments:match"], { statements: statements(), paymentRows: null });
    expect(failed).not.toContain("Nothing needs you");
    expect(failed).not.toContain("Next up");
    expect(failed).toContain(">Open reconciliation<");
  });

  it("the page tells every Next up row apart by a list name and no row shows a phone or an UPI narration", () => {
    const out = view(["payments:match"], { statements: statements(), paymentRows: [payment()] });
    expect(out).toContain('aria-label="Next up"');
    expect(out).not.toMatch(/UPI\/|\b\d{10}\b/);
  });
});

describe("SH7 the account footer and the committee landing (D236, D238)", () => {
  it("the footer says the role and the name, has a closed list and a small Sign out", () => {
    const out = html(h(AccountFooter, { name: "Meera Kapoor", permissions: ["reports:view"], identity: true }));
    expect(out).toContain("Committee · Signed in as Meera Kapoor");
    expect(out).toMatch(/<details><summary[^>]*min-h-12/);
    expect(out).toContain("View reports");
    expect(out).toContain(">Sign out<");
  });
});

describe("SH4 the committee report loader does not run on the staff home", () => {
  it("the page, the view and the loader import nothing from the report", () => {
    for (const file of ["src/app/(staff)/staff/page.tsx", "src/app/(staff)/staff/staff-view.tsx", "src/server/staff/home-data.ts", "src/server/staff/next-up.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/server\/reports|loadCommitteeReport|reports\/report-data/);
    }
  });
});
