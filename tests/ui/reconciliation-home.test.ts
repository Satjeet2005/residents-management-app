import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReconciliationHomeView } from "@/app/(staff)/staff/reconciliation/home-view";
import { ImportsTable } from "@/app/(staff)/staff/reconciliation/imports-table";
import { UploadPanel, presentOutcome } from "@/app/(staff)/staff/reconciliation/upload-panel";
import StaffLayout from "@/app/(staff)/layout";
import type { ImportListEntry } from "@/lib/reconciliation/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const ID = "11111111-2222-3333-4444-555555555555";
const entry = (over: Partial<ImportListEntry> = {}): ImportListEntry => ({ importId: ID, filename: "sample-statement.csv", uploadedOn: "2026-10-27", rowsRead: 106, posted: 25, needsYou: 43, awaitingApproval: 0, ignored: 38, accounted: true, ...over });

describe("RH1 the staff frame", () => {
  const out = html(h(StaffLayout, null, h("main", null, "page")));

  it("has a banner with a labelled nav and one link home, and the page inside", () => {
    expect(out).toContain("<header");
    expect(out).toContain('<nav aria-label="Staff"');
    expect(out).toMatch(/<a [^>]*href="\/staff"[^>]*>Staff home<\/a>/);
    expect(out).toContain("<main>page</main>");
  });
});

describe("RH2 the upload panel", () => {
  it("has the heading, a file input for .csv with a label, no file chosen yet and Import disabled", () => {
    const out = html(h(UploadPanel, { demo: false }));
    expect(out).toContain("Upload a bank statement");
    expect(out).toMatch(/<label [^>]*for="recon-file"[^>]*>Statement file \(\.csv\)<\/label>/);
    expect(out).toMatch(/<input [^>]*id="recon-file"[^>]*type="file"|<input [^>]*type="file"[^>]*id="recon-file"/);
    expect(out).toContain('accept=".csv,text/csv"');
    expect(out).toContain("No file chosen yet.");
    expect(out).toMatch(/<button [^>]*disabled[^>]*>Import<\/button>/);
  });

  it("the sample button is there only in demo mode, and is outlined (Import is the one primary control)", () => {
    expect(html(h(UploadPanel, { demo: false }))).not.toContain("Use the sample statement");
    const demo = html(h(UploadPanel, { demo: true }));
    expect(demo).toMatch(/<button [^>]*border-control[^>]*>Use the sample statement<\/button>/);
    expect(demo.indexOf(">Import<")).toBeLessThan(demo.indexOf("Use the sample statement"));
    expect(count(demo, /bg-accent/g)).toBeLessThanOrEqual(1);
  });

  it("controls are at least 48px tall, and there is a live region for the result", () => {
    const out = html(h(UploadPanel, { demo: true }));
    expect(count(out, /min-h-12/g)).toBeGreaterThanOrEqual(3);
    expect(out).toContain('aria-live="polite"');
  });
});

describe("RH3 what the panel says about an outcome", () => {
  it("a success says the counts and offers the workspace", () => {
    const shown = presentOutcome({ kind: "IMPORTED", importId: ID, summary: { rowsRead: 106, autoMatched: 25, queued: 43, ignored: 38, alreadyImported: 0, invalidRows: 0 } }, "x.csv");
    expect(shown).toMatchObject({ kind: "status", importId: ID });
    expect(shown.text).toContain("Imported x.csv: 106 rows read");
  });

  it("an unreadable file lists the first 5 problems and the count, as an alert", () => {
    const errors = Array.from({ length: 7 }, (_x, i) => ({ rowNumber: i + 2, message: `m${i}` }));
    const shown = presentOutcome({ kind: "INVALID_CSV", errors }, "x.csv");
    expect(shown).toMatchObject({ kind: "alert", importId: null });
    expect(shown.lines).toHaveLength(6);
    expect(shown.lines.at(-1)).toBe("7 problems in all, the first 5 are shown.");
  });

  it.each([
    [{ kind: "TOO_LARGE" as const }, /too big/],
    [{ kind: "IN_PROGRESS" as const }, /Another import is running/],
    [{ kind: "NETWORK" as const }, /could not reach the server/],
    [{ kind: "UNREADABLE" as const }, /could not be read/],
    [{ kind: "TOO_BIG_HERE" as const, message: "This file is over 2,000,000 characters, so it was not sent." }, /over 2,000,000/],
  ])("%j is an alert with its own sentence and no workspace link", (outcome, pattern) => {
    const shown = presentOutcome(outcome, "x.csv");
    expect(shown.kind).toBe("alert");
    expect(shown.text).toMatch(pattern);
    expect(shown.importId).toBeNull();
  });
});

describe("RH4 the recent imports", () => {
  it("a real table with a caption, column headers and a link to each workspace, and the books check in words", () => {
    const out = html(h(ImportsTable, { imports: [entry()] }));
    expect(out).toContain("<table");
    expect(out).toContain("<caption");
    for (const heading of ["Date", "File", "Rows", "Posted", "Need you", "Ignored", "Books"]) expect(out).toContain(`>${heading}</th>`);
    expect(out).toContain(`href="/staff/reconciliation/${ID}"`);
    expect(out).toContain("27 Oct 2026");
    expect(out).toContain("All rows accounted for");
    expect(out).not.toContain("Counts do not add up");
  });

  it("counts a row awaiting approval as still needing a person, and warns in words when the books do not add up", () => {
    const out = html(h(ImportsTable, { imports: [entry({ needsYou: 40, awaitingApproval: 3, accounted: false })] }));
    expect(out).toContain("Counts do not add up");
    expect(out).toContain(">43<");
  });

  it("is a table from 768px and stacked cards below (both are in the page, one is hidden)", () => {
    const out = html(h(ImportsTable, { imports: [entry()] }));
    expect(out).toContain("hidden md:block");
    expect(out).toContain("md:hidden");
  });

  it("an empty list says so", () => {
    expect(html(h(ImportsTable, { imports: [] }))).toContain("No statement has been imported yet. Upload one above.");
  });
});

describe("RH5 the page", () => {
  const out = html(h(ReconciliationHomeView, { imports: [entry()], demo: true }));

  it("has one h1, the upload panel and the recent imports, in a main landmark", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("<main");
    expect(out).toContain(">Bank reconciliation</h1>");
    expect(out).toContain("Upload a bank statement");
    expect(out).toContain("Recent imports");
  });

  it("has at most one filled control and no accept-all or bulk action", () => {
    expect(count(out, /bg-accent/g)).toBeLessThanOrEqual(1);
    expect(out).not.toMatch(/accept all|approve all|post all|select all/i);
  });
});
