import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalControls } from "@/app/(staff)/staff/reconciliation/[importId]/approval-controls";
import { AwaitingDetails, IgnoredDetails, PostedDetails } from "@/app/(staff)/staff/reconciliation/[importId]/lane-details";
import { RowsView } from "@/app/(staff)/staff/reconciliation/[importId]/rows-view";
import type { Viewer } from "@/lib/reconciliation/permission-view";
import type { RowCard } from "@/lib/reconciliation/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const IMPORT = "11111111-2222-3333-4444-555555555555";
const base: RowCard = { id: "a0000000-0000-0000-0000-000000000001", rowNumber: 3, txnDate: "2026-10-27", amountPaise: "3000000", direction: "CREDIT", narration: "NEFT/N710000000007/T15-0902 Rohit Deshmukh/maintenance", state: "AWAITING_APPROVAL", version: 2, confidence: "LOW", bestFlat: null, request: null, posted: null, ignored: null };
const awaiting: RowCard = { ...base, request: { requestedById: "priya", requestedBy: "Priya Nair", action: "MATCH", flatCode: "T15-0902", reason: "The code and the name agree", requestedOn: "2026-10-27" } };

const priya: Viewer = { id: "priya", role: "STAFF", active: true, permissions: ["payments:match"] };
const rahul: Viewer = { id: "rahul", role: "STAFF", active: true, permissions: ["payments:match", "payments:approve"] };
const priyaWhoApproves: Viewer = { ...priya, permissions: ["payments:match", "payments:approve"] };
const meera: Viewer = { id: "meera", role: "STAFF", active: true, permissions: ["reports:view"] };

describe("LN1 the Awaiting approval lane", () => {
  it("shows who asked, what (match to the flat), the reason and when", () => {
    const out = html(h(AwaitingDetails, { row: awaiting, viewer: rahul }));
    expect(out).toContain("Match to T15-0902");
    expect(out).toContain("Asked by Priya Nair on 27 Oct");
    expect(out).toContain("Reason: The code and the name agree");
  });

  it("an ignore request says so", () => {
    const out = html(h(AwaitingDetails, { row: { ...awaiting, request: { ...awaiting.request!, action: "IGNORE", flatCode: null } }, viewer: rahul }));
    expect(out).toContain("Not a maintenance payment");
  });

  it("LN2 a person with payments:approve who did NOT ask sees Approve and Reject, and not 'Waiting for another approver'", () => {
    const out = html(h(AwaitingDetails, { row: awaiting, viewer: rahul }));
    expect(out).toContain(">Approve<");
    expect(out).toContain(">Reject<");
    expect(out).not.toContain("Waiting for another approver");
  });

  it("LN3 the requester sees 'Waiting for another approver' and no buttons, even with payments:approve", () => {
    for (const who of [priya, priyaWhoApproves]) {
      const out = html(h(AwaitingDetails, { row: awaiting, viewer: who }));
      expect(out).toContain("Waiting for another approver");
      expect(out).not.toContain("<button");
      expect(out).not.toContain(">Approve<");
      expect(out).not.toContain(">Reject<");
    }
  });

  it("everyone else (no payments:approve) also sees 'Waiting for another approver' and no buttons", () => {
    for (const who of [{ ...priya, id: "kavita" }, meera]) {
      const out = html(h(AwaitingDetails, { row: awaiting, viewer: who }));
      expect(out).toContain("Waiting for another approver");
      expect(out).not.toContain("<button");
    }
  });

  it("a row with no readable request draws nothing", () => {
    expect(html(h(AwaitingDetails, { row: base, viewer: rahul }))).toBe("");
  });
});

describe("LN4 the approval controls", () => {
  const out = html(h(ApprovalControls, { rowId: base.id }));

  it("start as two outlined 48px buttons, Approve and Reject, with no filled control and nothing decided by one tap", () => {
    expect(out).toMatch(/<button [^>]*border-control[^>]*>Approve<\/button>/);
    expect(out).toMatch(/<button [^>]*border-control[^>]*>Reject<\/button>/);
    expect(count(out, /min-h-12/g)).toBe(2);
    expect(out).not.toContain("bg-accent");
    expect(out).not.toContain("<textarea");
  });
});

describe("LN5 the Posted lane is read only", () => {
  const auto: RowCard = { ...base, state: "AUTO_MATCHED", amountPaise: "646800", posted: { flatCode: "T12-0408", by: { kind: "AUTO" }, entries: [{ entryType: "LATE_FEE", amountPaise: "9800" }, { entryType: "PAYMENT", amountPaise: "646800" }] } };
  const manual: RowCard = { ...auto, state: "MANUALLY_MATCHED", posted: { flatCode: "T21-1601", by: { kind: "MANUAL", name: "Priya Nair", approvedBy: null }, entries: [{ entryType: "PAYMENT", amountPaise: "566000" }] } };

  it("shows the flat, 'Automatic', and the entries posted", () => {
    const out = html(h(PostedDetails, { row: auto }));
    expect(out).toContain("Flat T12-0408");
    expect(out).toContain(">Automatic<");
    expect(out).toContain("Late fee ₹98");
    expect(out).toContain("Payment ₹6,468");
  });

  it("a manual post says 'Manual by <name>', and an approved one says who approved", () => {
    expect(html(h(PostedDetails, { row: manual }))).toContain("Manual by Priya Nair");
    const approved = { ...manual, posted: { ...manual.posted!, by: { kind: "MANUAL" as const, name: "Priya Nair", approvedBy: "Rahul Menon" } } };
    expect(html(h(PostedDetails, { row: approved }))).toContain("Manual by Priya Nair, approved by Rahul Menon");
  });

  it("the lane has no buttons, no link and no undo", () => {
    const out = html(h(RowsView, { rows: [auto, manual], caption: "Rows in Posted", importId: IMPORT, lane: "MATCHED", selectedId: null, viewer: rahul }));
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<a ");
    expect(out).not.toMatch(/undo|reverse|delete/i);
    expect(out).toContain(">Details</th>");
  });
});

describe("LN6 the Not maintenance lane is read only", () => {
  it("shows the kind the matcher found, or the reason a person gave", () => {
    expect(html(h(IgnoredDetails, { row: { ...base, state: "IGNORED", ignored: { ignoreKind: "BANK_CHARGE", reason: null } } }))).toContain("Bank charge");
    const manual = html(h(IgnoredDetails, { row: { ...base, state: "IGNORED", ignored: { ignoreKind: null, reason: "Hall rent, not maintenance" } } }));
    expect(manual).toContain("Not a maintenance payment");
    expect(manual).toContain("Reason: Hall rent, not maintenance");
  });

  it("the lane has no buttons or links", () => {
    const ignored: RowCard = { ...base, state: "IGNORED", ignored: { ignoreKind: "DEBIT", reason: null } };
    const out = html(h(RowsView, { rows: [ignored], caption: "Rows in Not maintenance", importId: IMPORT, lane: "NOT_MAINTENANCE", selectedId: null, viewer: rahul }));
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<a ");
    expect(out).toContain("Money going out");
  });
});

describe("LN7 the Awaiting approval lane as a table", () => {
  it("has the details column, and a row selection link only in Needs you", () => {
    const out = html(h(RowsView, { rows: [awaiting], caption: "Rows in Awaiting approval", importId: IMPORT, lane: "AWAITING_APPROVAL", selectedId: null, viewer: priya }));
    expect(out).toContain(">Details</th>");
    expect(out).not.toContain("<a ");
    expect(out).toContain("Waiting for another approver");
  });
});
