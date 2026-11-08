import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LaneSelector } from "@/app/(staff)/staff/reconciliation/[importId]/lane-selector";
import { RowList, emptyLaneText } from "@/app/(staff)/staff/reconciliation/[importId]/row-list";
import { RowsView } from "@/app/(staff)/staff/reconciliation/[importId]/rows-view";
import { ProportionStrip } from "@/app/(staff)/staff/reconciliation/[importId]/proportion-strip";
import { WorkspaceHeader } from "@/app/(staff)/staff/reconciliation/[importId]/workspace-header";
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

describe("WS1 the proportion strip", () => {
  const out = html(h(ProportionStrip, { laneCounts }));

  it("is decorative: hidden from assistive technology, 8px tall, with no text and no legend", () => {
    expect(out).toMatch(/^<div aria-hidden="true" class="flex h-2 w-full/);
    expect(out.replace(/<[^>]*>/g, "")).toBe("");
    expect(out).not.toMatch(/Posted automatically|Need you|Awaiting|legend/);
  });

  it("the widths are whole numbers that add up to 100", () => {
    const widths = [...out.matchAll(/style="width:(\d+)%"/g)].map((m) => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("WS2 the workspace header (D189)", () => {
  const header = { importId: IMPORT, filename: "sample-statement.csv", uploadedOn: "2026-10-27", uploadedBy: "Priya Nair" };

  it("has ONE breadcrumb line, Staff home then All imports, in a labelled nav, and nothing else links back", () => {
    const out = html(h(WorkspaceHeader, { header, counts: counts() }));
    expect(count(out, /<nav /g)).toBe(1);
    expect(out).toContain('<nav aria-label="Breadcrumb"');
    expect(out).toMatch(/<a [^>]*href="\/staff"[^>]*>Staff home<\/a><svg[\s\S]*?<\/svg><a [^>]*href="\/staff\/reconciliation"[^>]*>All imports<\/a>/);
    expect(count(out, /<a /g)).toBe(2);
  });

  it("the h1 is Bank statement matching and the secondary line holds the file, the date and who imported it", () => {
    const out = html(h(WorkspaceHeader, { header, counts: counts() }));
    expect(out).toMatch(/<h1[^>]*>Bank statement matching<\/h1>/);
    expect(out).toContain("sample-statement.csv · imported 27 Oct 2026 by Priya Nair");
  });

  it("WS2 says 'All 106 rows accounted for' with a check icon when the flag is true", () => {
    const out = html(h(WorkspaceHeader, { header, counts: counts({ accounted: true }) }));
    expect(out).toMatch(/<p class="[^"]*font-semibold"><svg[^>]*aria-hidden="true"[^>]*>.*All 106 rows accounted for/);
    expect(out).not.toContain("do not add up");
  });

  it("WS3 when the flag READ BACK is false it warns 'Do not post from this import', and never says accounted, even if the counts add up", () => {
    const addsUp = counts({ accounted: false });
    expect(addsUp.autoMatched + addsUp.needsYou + addsUp.awaitingApproval + addsUp.notMaintenance).toBe(addsUp.rowsRead);
    const out = html(h(WorkspaceHeader, { header, counts: addsUp }));
    expect(out).toContain("The counts do not add up. Do not post from this import.");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("accounted for");
  });
});

describe("WS4 the lane selector (D190)", () => {
  const out = html(h(LaneSelector, { importId: IMPORT, lane: "AWAITING_APPROVAL", laneCounts, manuallyPosted: 0 }));

  it("is a tablist of four cards in the order Needs you, Awaiting approval, Posted, Not maintenance, each a link to its lane whose name is its words and its count", () => {
    expect(out).toContain('role="tablist"');
    expect(count(out, /role="tab"/g)).toBe(4);
    const names = [...out.matchAll(/<a [^>]*role="tab"[^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]*>/g, ""));
    expect(names).toEqual(["Needs you43 rows", "Awaiting approval0 rows", "Posted25 rows", "Not maintenance38 rows"]);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=awaiting-approval"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=posted"`);
    expect(out).toContain(`href="/staff/reconciliation/${IMPORT}?lane=not-maintenance"`);
  });

  it("a lane with one row says '1 row'", () => {
    expect(html(h(LaneSelector, { importId: IMPORT, lane: "NEEDS_YOU", laneCounts: { ...laneCounts, NEEDS_YOU: 1 }, manuallyPosted: 0 }))).toContain('1</span><span class="sr-only"> row</span>');
  });

  it("each card shows the count in 24px semibold tabular figures above the label in 14px secondary ink, and a zero stays visible", () => {
    expect(out).toMatch(/<span[^>]*class="text-caption text-ink-2">Awaiting approval<\/span><span[^>]*class="tnum text-heading font-semibold">0<\/span>/);
    expect(out).toContain("flex-col-reverse");
    expect(out).toMatch(/class="tnum text-heading font-semibold">43<\/span>/);
  });

  it("only the selected card is selected and in the tab order; every card controls the panel and is at least 64px tall", () => {
    expect(count(out, /aria-selected="true"/g)).toBe(1);
    expect(count(out, /aria-selected="false"/g)).toBe(3);
    expect(count(out, /tabindex="0"/g)).toBe(1);
    expect(count(out, /tabindex="-1"/g)).toBe(3);
    expect(count(out, /aria-controls="recon-lane-panel"/g)).toBe(4);
    expect(count(out, /min-h-16/g)).toBe(4);
    expect(out).toMatch(/id="recon-tab-AWAITING_APPROVAL"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="recon-tab-AWAITING_APPROVAL"/);
  });

  it("is a 2 x 2 grid below 768px and one row from 768px", () => {
    expect(out).toContain("grid grid-cols-2 gap-2 md:grid-cols-4");
  });

  it("the selected card has a 2px ink border and the paper-2 tint; the others a 1px hairline border", () => {
    expect(out).toMatch(/<a [^>]*aria-selected="true"[^>]*class="[^"]*border-2 border-ink bg-paper-2/);
    expect(count(out, /border border-hairline/g)).toBe(3);
  });

  it("the legend words no longer exist anywhere: no 'Posted automatically' and no 'Need you'", () => {
    expect(out).not.toContain("Posted automatically");
    expect(out).not.toMatch(/Need you\b/);
  });

  it("one line about Posted, under the cards, splits automatic from by hand only when something was posted by hand", () => {
    expect(out).not.toContain("by hand");
    const split = html(h(LaneSelector, { importId: IMPORT, lane: "NEEDS_YOU", laneCounts, manuallyPosted: 3 }));
    expect(split).toContain("Posted: 22 automatic · 3 by hand");
    expect(count(split, /by hand/g)).toBe(1);
    expect(split.indexOf("by hand")).toBeGreaterThan(split.lastIndexOf("</a>"));
  });
});

describe("WS5 the rows (D191)", () => {
  const rows = [card(), card({ id: "a0000000-0000-0000-0000-000000000002", amountPaise: "1500000", bestFlat: null, confidence: "NONE", narration: `${"word ".repeat(40)}end` })];
  const render = (selectedId: string | null = null) => html(h(RowsView, { rows, caption: "Rows in Needs you", importId: IMPORT, lane: "NEEDS_YOU", selectedId, viewer, thresholdPaise: "1000000" }));
  const out = render();

  it("is a list of cards: one link for each row, and no table", () => {
    expect(out).not.toContain("<table");
    expect(count(out, /<li>/g)).toBe(2);
    expect(count(out, /<a /g)).toBe(2);
    expect(count(out, /<button/g)).toBe(0);
  });

  it("the WHOLE card is the one control: the amount, the date, the narration and the reason are inside the link, and its name says what it opens", () => {
    const link = /<a [^>]*>[\s\S]*?<\/a>/.exec(out)?.[0] ?? "";
    expect(link).toContain("₹5,660");
    expect(link).toContain("27 Oct");
    expect(link).toContain("UPI/710000000003/T21-1601 Aamir Shaikh/maintenance");
    expect(link).toContain("Best match T21-1601 · Medium");
    expect(link).toContain('<span class="sr-only">Review</span>');
    expect(link).not.toContain("aria-label");
    expect(link).toContain(`href="/staff/reconciliation/${IMPORT}?row=a0000000-0000-0000-0000-000000000001"`);
    expect(out).not.toMatch(/underline/);
  });

  it("line 1 is the amount in bold tabular figures then the date; line 2 the narration clamped to two lines; line 3 the reason", () => {
    expect(out).toContain('<span class="tnum text-body font-semibold">₹5,660</span>');
    expect(out).toMatch(/<span class="line-clamp-2 break-words text-caption">UPI\/710000000003/);
    expect(out.indexOf(">₹5,660<")).toBeLessThan(out.indexOf(">27 Oct<"));
    expect(out.indexOf(">27 Oct<")).toBeLessThan(out.indexOf(">UPI/710000000003"));
    expect(out.indexOf(">UPI/710000000003")).toBeLessThan(out.indexOf("Best match"));
  });

  it("a row with no candidate says No flat found, and a long narration is cut at a word, with an ellipsis", () => {
    expect(out).toContain(">No flat found<");
    expect(out).toMatch(/word…<\/span>/);
    expect(out).not.toContain("word word word word word word word word word word word word word word word word word word word word word word word");
  });

  it("a credit at or above the society threshold says Needs a second approver in caution ink with an icon; one below it does not; the threshold is the setting, not a number", () => {
    const needs = out.split("<li>")[2];
    const below = out.split("<li>")[1];
    expect(needs).toMatch(/text-caution"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Needs a second approver/);
    expect(below).not.toContain("second approver");
    const exact = html(h(RowsView, { rows: [card({ amountPaise: "1000000" })], caption: "c", importId: IMPORT, lane: "NEEDS_YOU", selectedId: null, viewer, thresholdPaise: "1000000" }));
    expect(exact).toContain("Needs a second approver");
    const moved = html(h(RowsView, { rows: [card({ amountPaise: "1000000" })], caption: "c", importId: IMPORT, lane: "NEEDS_YOU", selectedId: null, viewer, thresholdPaise: "1000001" }));
    expect(moved).not.toContain("second approver");
  });

  it("a chevron icon sits at the right of each card", () => {
    expect(out).toMatch(/<\/span><svg[^>]*aria-hidden="true"[\s\S]*?m9 5 7 7-7 7[\s\S]*?<\/svg><\/a>/);
  });

  it("the selected row has a 2px border and says Reviewing; the others a 1px hairline border", () => {
    const selected = render("a0000000-0000-0000-0000-000000000001");
    expect(selected).toContain('aria-current="true"');
    expect(selected).toContain('<span class="sr-only">Reviewing</span>');
    expect(selected).toMatch(/aria-current="true"[^>]*class="[^"]*border-2 border-ink/);
    expect(count(selected, /border-2 border-ink/g)).toBe(1);
  });

  it("keeps the order it is given (the server sorts by amount, biggest first)", () => {
    expect(out.indexOf("₹5,660")).toBeLessThan(out.indexOf("₹15,000"));
  });

  it("a debit says Money out", () => {
    expect(html(h(RowsView, { rows: [card({ direction: "DEBIT" })], caption: "c", importId: IMPORT, lane: "NEEDS_YOU", selectedId: null, viewer, thresholdPaise: "1000000" }))).toContain("Money out");
  });
});

describe("WS6 the lane panel", () => {
  it("is a tabpanel named by its tab, and says what an empty lane means", () => {
    const empty = html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [], initialCursor: null, selectedId: null, viewer, thresholdPaise: "1000000", laneTotal: 0 }));
    expect(empty).toContain('role="tabpanel"');
    expect(empty).toContain('aria-labelledby="recon-tab-NEEDS_YOU"');
    expect(empty).toContain("Nothing needs you. Every row is accounted for.");
    expect(new Set(LANES.map(emptyLaneText)).size).toBe(4);
  });

  it("offers Load more only when a next page exists", () => {
    expect(html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [card()], initialCursor: "abc", selectedId: null, viewer, thresholdPaise: "1000000", laneTotal: 43 }))).toContain(">Load more<");
    expect(html(h(RowList, { importId: IMPORT, lane: "NEEDS_YOU", initialRows: [card()], initialCursor: null, selectedId: null, viewer, thresholdPaise: "1000000", laneTotal: 1 }))).not.toContain("Load more");
  });
});

describe("WS7 the workspace", () => {
  const data: Workspace = { header: { importId: IMPORT, filename: "sample-statement.csv", uploadedOn: "2026-10-27", uploadedBy: "Priya Nair" }, counts: counts(), laneCounts, rows: [card()], nextCursor: null, review: null, thresholdPaise: "1000000" };
  const out = html(h(WorkspaceView, { data, lane: "NEEDS_YOU", viewer }));

  it("has one h1, who imported the file and when, a main landmark and the breadcrumb", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain(">Bank statement matching</h1>");
    expect(out).toContain("sample-statement.csv · imported 27 Oct 2026 by Priya Nair");
    expect(out).toContain("<main");
    expect(out).toMatch(/<a [^>]*href="\/staff\/reconciliation"[^>]*>All imports<\/a>/);
  });

  it("has the header, the strip, the tabs and the rows, and no accept-all or bulk action anywhere", () => {
    expect(out).toContain("All 106 rows accounted for");
    expect(out).toContain('role="tablist"');
    expect(out).toContain('role="tabpanel"');
    expect(out).not.toMatch(/accept all|approve all|post all|select all|bulk/i);
    expect(count(out, /type="checkbox"/g)).toBe(0);
  });
});
