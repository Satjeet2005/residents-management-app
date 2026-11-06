import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LaneTabs } from "@/app/(staff)/staff/reconciliation/[importId]/lane-tabs";
import { RowList, emptyLaneText } from "@/app/(staff)/staff/reconciliation/[importId]/row-list";
import { RowsView } from "@/app/(staff)/staff/reconciliation/[importId]/rows-view";
import { SummaryBar } from "@/app/(staff)/staff/reconciliation/[importId]/summary-bar";
import { WorkspaceView } from "@/app/(staff)/staff/reconciliation/[importId]/workspace-view";
import { LANES, type RowCard, type SummaryCounts } from "@/lib/reconciliation/types";
import type { Workspace } from "@/server/statements/ui-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
// The server action is only called on a click; rendering needs the module to exist.
vi.mock("@/app/(staff)/staff/reconciliation/[importId]/actions", () => ({ loadMoreRows: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const IMPORT = "11111111-2222-3333-4444-555555555555";
const viewer = { id: "priya", role: "STAFF" as const, active: true, permissions: ["payments:match"] };

const counts = (over: Partial<SummaryCounts> = {}): SummaryCounts => ({ rowsRead: 106, autoMatched: 25, manuallyMatched: 0, needsYou: 43, awaitingApproval: 0, notMaintenance: 38, alreadyImported: 0, invalidRows: 0, accounted: true, ...over });
const laneCounts = { NEEDS_YOU: 43, AWAITING_APPROVAL: 0, MATCHED: 25, NOT_MAINTENANCE: 38 };
const card = (over: Partial<RowCard> = {}): RowCard => ({
  id: "a0000000-0000-0000-0000-000000000001",
  rowNumber: 3,
  txnDate: "2026-10-27",
  amountPaise: "566000",
  direction: "CREDIT",
  narration: "UPI/710000000003/T21-1601 Aamir Shaikh/maintenance",
  state: "QUEUED",
  version: 1,
  confidence: "MEDIUM",
  bestFlat: "T21-1601",
  request: null,
  posted: null,
  ignored: null,
  ...over,
});

describe("WS1 the summary bar", () => {
  it("names Posted automatically, Need you, Awaiting approval and Not maintenance with their numbers, in words", () => {
    const out = html(h(SummaryBar, { counts: counts() }));
    for (const [label, n] of [["Posted automatically", 25], ["Need you", 43], ["Awaiting approval", 0], ["Not maintenance", 38]] as const) {
      expect(out).toMatch(new RegExp(`<span>${label}</span><span class="tnum font-semibold">${n}</span>`));
    }
    expect(out).not.toContain("Already imported");
  });

  it("shows Already imported only above zero", () => {
    expect(html(h(SummaryBar, { counts: counts({ alreadyImported: 106, rowsRead: 106 }) }))).toContain("Already imported");
  });

  it("the bar is decorative (aria-hidden) and the widths are whole numbers that add up to 100", () => {
    const out = html(h(SummaryBar, { counts: counts() }));
    expect(out).toMatch(/<div aria-hidden="true" class="flex h-4 w-full/);
    const widths = [...out.matchAll(/style="width:(\d+)%"/g)].map((m) => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("WS2 says 'All 106 rows accounted for' with a check icon when the flag is true", () => {
    const out = html(h(SummaryBar, { counts: counts({ accounted: true }) }));
    expect(out).toContain("All 106 rows accounted for");
    expect(out).toMatch(/<p class="[^"]*font-semibold"><svg[^>]*aria-hidden="true"[^>]*>.*All 106 rows accounted for/);
    expect(out).not.toContain("do not add up");
  });

  it("WS3 when the flag READ BACK is false it warns 'Do not post from this import', and never says accounted, even if the counts add up", () => {
    const addsUp = counts({ accounted: false });
    expect(addsUp.autoMatched + addsUp.needsYou + addsUp.awaitingApproval + addsUp.notMaintenance).toBe(addsUp.rowsRead);
    const out = html(h(SummaryBar, { counts: addsUp }));
    expect(out).toContain("The counts do not add up. Do not post from this import.");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("accounted for");
  });

  it("has the double rule under the totals", () => {
    expect(html(h(SummaryBar, { counts: counts() }))).toContain("h-[7px] border-y-2 border-ink");
  });
});

describe("WS4 the lane tabs", () => {
  const out = html(h(LaneTabs, { importId: IMPORT, lane: "AWAITING_APPROVAL", laneCounts }));

  it("is a tablist with four tabs, named in words with their counts, each a link to its lane", () => {
    expect(out).toContain('role="tablist"');
    expect(count(out, /role="tab"/g)).toBe(4);
    for (const [label, n] of [["Needs you", 43], ["Awaiting approval", 0], ["Posted", 25], ["Not maintenance", 38]] as const) expect(out).toMatch(new RegExp(`${label}<span class="tnum">${n}</span>`));
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=awaiting-approval"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=posted"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=not-maintenance"`);
  });

  it("only the selected tab is selected and in the tab order; every tab controls the panel and is at least 48px", () => {
    expect(count(out, /aria-selected="true"/g)).toBe(1);
    expect(count(out, /aria-selected="false"/g)).toBe(3);
    expect(count(out, /tabindex="0"/g)).toBe(1);
    expect(count(out, /tabindex="-1"/g)).toBe(3);
    expect(count(out, /aria-controls="recon-lane-panel"/g)).toBe(4);
    expect(count(out, /min-h-12/g)).toBe(4);
    expect(out).toMatch(/id="recon-tab-AWAITING_APPROVAL"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="recon-tab-AWAITING_APPROVAL"/);
  });

  it("the selection is not told by colour alone: the selected tab is bold with a thick border", () => {
    expect(out).toMatch(/<a [^>]*aria-selected="true"[^>]*class="[^"]*border-ink[^"]*font-semibold/);
  });
});

describe("WS5 the rows", () => {
  const rows = [card(), card({ id: "a0000000-0000-0000-0000-000000000002", amountPaise: "100000", bestFlat: null, confidence: "NONE", narration: "x".repeat(80) })];
  const out = html(h(RowsView, { rows, caption: "Rows in Needs you", importId: IMPORT, lane: "NEEDS_YOU", selectedId: null, viewer }));

  it("is a real table with headers from 768px and stacked cards below", () => {
    expect(out).toContain('<div class="hidden md:block">');
    expect(out).toContain("<table");
    expect(out).toContain("<caption");
    for (const heading of ["Date", "Amount", "Narration", "Best match"]) expect(out).toContain(`>${heading}</th>`);
    expect(out).toContain('<ul class="flex flex-col md:hidden">');
  });

  it("shows the date, the amount in rupees with tabular figures, the best flat chip and the confidence tag in words", () => {
    expect(out).toContain("27 Oct");
    expect(out).toContain('<span class="tnum text-body font-semibold">₹5,660</span>');
    expect(out).toContain(">T21-1601<");
    expect(out).toContain(">Medium<");
    expect(out).toContain(">No flat found<");
    expect(out).toContain(">No match<");
  });

  it("cuts a long narration to 60 characters with an ellipsis", () => {
    expect(out).toContain(`${"x".repeat(60)}…`);
    expect(out).not.toContain("x".repeat(61));
    expect(out).toContain("UPI/710000000003/T21-1601 Aamir Shaikh/maintenance");
  });

  it("keeps the order it is given (the server sorts by amount, biggest first)", () => {
    expect(out.indexOf("₹5,660")).toBeLessThan(out.indexOf("₹1,000"));
  });

  it("a debit says Money out", () => {
    expect(html(h(RowsView, { rows: [card({ direction: "DEBIT" })], caption: "c", importId: IMPORT, lane: "NEEDS_YOU", selectedId: null, viewer }))).toContain("Money out");
  });
});

describe("WS6 the lane panel", () => {
  it("is a tabpanel named by its tab, and says what an empty lane means", () => {
    const empty = html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [], initialCursor: null, selectedId: null, viewer }));
    expect(empty).toContain('role="tabpanel"');
    expect(empty).toContain('aria-labelledby="recon-tab-NEEDS_YOU"');
    expect(empty).toContain("Nothing needs you. Every row is accounted for.");
    expect(new Set(LANES.map(emptyLaneText)).size).toBe(4);
  });

  it("offers Load more only when a next page exists", () => {
    expect(html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [card()], initialCursor: "abc", selectedId: null, viewer }))).toContain(">Load more<");
    expect(html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [card()], initialCursor: null, selectedId: null, viewer }))).not.toContain("Load more");
  });
});

describe("WS7 the workspace", () => {
  const data: Workspace = { header: { importId: IMPORT, filename: "sample-statement.csv", uploadedOn: "2026-10-27", uploadedBy: "Priya Nair" }, counts: counts(), laneCounts, rows: [card()], nextCursor: null, review: null };
  const out = html(h(WorkspaceView, { data, lane: "NEEDS_YOU", viewer }));

  it("has one h1 (the file name), who uploaded it and when, a main landmark and a link back", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain(">sample-statement.csv</h1>");
    expect(out).toContain("Imported 27 Oct 2026 by Priya Nair");
    expect(out).toContain("<main");
    expect(out).toMatch(/<a [^>]*href="\/staff\/reconciliation"[^>]*>All imports<\/a>/);
  });

  it("has the summary, the tabs and the rows, and no accept-all or bulk action anywhere", () => {
    expect(out).toContain("All 106 rows accounted for");
    expect(out).toContain('role="tablist"');
    expect(out).toContain('role="tabpanel"');
    expect(out).not.toMatch(/accept all|approve all|post all|select all|bulk/i);
    expect(count(out, /type="checkbox"/g)).toBe(0);
  });
});
