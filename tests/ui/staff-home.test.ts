import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import type { StaffHomeData } from "@/server/staff/home-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }), usePathname: () => "/staff", redirect: () => {} }));

const html = renderToStaticMarkup;
const ID = "11111111-2222-3333-4444-555555555555";
const none: StaffHomeData = { complaints: null, unseenSafety: null, statements: null, approvals: null };
const statements = (over: Partial<NonNullable<StaffHomeData["statements"]>> = {}): StaffHomeData["statements"] => ({
  newest: { importId: ID, filename: "sample-statement.csv", uploadedOn: "2026-10-27", rowsRead: 106, accounted: true },
  needsPerson: 43,
  awaitingApproval: 2,
  ...over,
});
const view = (permissions: string[], home: Partial<StaffHomeData> = {}) => html(h(StaffView, { name: "Test Person", permissions, home: { ...none, ...home } }));

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

  it("the Complaints card says the counts, or that nothing needs you, and has one filled link", () => {
    const busy = view(["complaints:manage"], { complaints: { needsAction: 7, overdue: 2 } });
    expect(busy).toContain("7 need action, 2 overdue");
    expect(busy).toMatch(/<a [^>]*bg-accent[^>]*href="\/staff\/complaints"[^>]*>Open complaints<\/a>|<a [^>]*href="\/staff\/complaints"[^>]*bg-accent[^>]*>Open complaints<\/a>/);
    expect(view(["complaints:manage"], { complaints: { needsAction: 0, overdue: 0 } })).toContain("Nothing needs you right now.");
    const failed = view(["complaints:manage"], { complaints: null });
    expect(failed).toContain("Open complaints");
    expect(failed).not.toMatch(/need action|Nothing needs you/);
  });

  it("the matching card: last statement, totals over all imports, the accounted line with an icon, and the two links", () => {
    const out = view(["payments:match"], { statements: statements() });
    expect(out).toContain("Last statement: 27 Oct 2026, 106 rows (sample-statement.csv)");
    expect(out).toContain("43 need a person, 2 waiting for approval");
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

  it("the Committee card is static text and a link", () => {
    const out = view(["reports:view"]);
    expect(out).toContain("Collections, what is owed, complaints and bank matching, month by month.");
    expect(out).toContain(">Open the report<");
  });

  it("exactly one filled control, even with three tools (the later cards are outlined)", () => {
    const out = view(["complaints:manage", "payments:match", "reports:view"], { statements: statements() });
    expect((out.match(/bg-accent/g) ?? []).length).toBe(1);
    expect(out).toContain("md:grid-cols-2");
  });

  it("a single card is limited to a readable width", () => {
    expect(view(["reports:view"])).toContain("max-w-xl");
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

describe("SH4 the committee report loader does not run on the staff home", () => {
  it("the page, the view and the loader import nothing from the report", () => {
    for (const file of ["src/app/(staff)/staff/page.tsx", "src/app/(staff)/staff/staff-view.tsx", "src/server/staff/home-data.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/server\/reports|loadCommitteeReport|reports\/report-data/);
    }
  });
});
