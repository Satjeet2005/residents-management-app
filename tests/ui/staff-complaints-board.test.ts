import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import { BoardList } from "@/app/(staff)/staff/complaints/board-list";
import { BoardRows } from "@/app/(staff)/staff/complaints/board-rows";
import { BoardView } from "@/app/(staff)/staff/complaints/board-view";
import { FilterChips } from "@/app/(staff)/staff/complaints/filter-chips";
import { FiltersMenu } from "@/app/(staff)/staff/complaints/filters-menu";
import { ViewList } from "@/app/(staff)/staff/complaints/view-list";
import { ViewsMenu } from "@/app/(staff)/staff/complaints/views-menu";
import { BOARD_VIEWS } from "@/domain/complaints/board-views";
import { NO_FILTERS } from "@/lib/staff-complaints/board-query";
import type { BoardRow } from "@/server/complaints/board-views";
import type { BoardPage } from "@/server/complaints/staff-page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
// The server action is only called on a click; rendering needs the module to exist.
vi.mock("@/app/(staff)/staff/complaints/actions", () => ({ loadMoreComplaints: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const NOW = Date.UTC(2026, 10, 6, 6, 30);
const minute = 60_000;

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  id: "b0000000-0000-4000-8000-000000000001",
  title: "Water leak under the kitchen sink",
  flatCode: "T12-0408",
  category: "PLUMBING",
  urgency: "NORMAL",
  status: "ASSIGNED",
  safety: false,
  acknowledged: false,
  needsReview: false,
  assignee: { id: "u1", name: "Kavita Rao" },
  ageMinutes: 185,
  responseDueAt: NOW + 40 * minute,
  sla: "ON_TIME",
  source: "LLM",
  version: 1,
  ...over,
});
const counts = { needs_action: 9, mine: 5, safety: 1, triage: 4, open: 7, overdue: 2, waiting: 3, closed: 12 };
const page = (over: Partial<BoardPage> = {}): BoardPage => ({ view: "needs_action", filters: NO_FILTERS, counts, unacknowledgedSafety: 0, total: 1, rows: [row()], nextCursor: null, now: NOW, ...over });

describe("SB1 the views list (the content of the sheet and the sidebar)", () => {
  const out = html(h(ViewList, { view: "open", counts, filters: NO_FILTERS }));

  it("is a nav with eight links in the order of the sheet, each with its count and ONE plain sentence", () => {
    expect(out).toContain('aria-label="Complaint views"');
    expect(count(out, /<a /g)).toBe(8);
    const labels = ["Needs action", "Mine", "Safety", "Needs triage", "Open", "Overdue", "Waiting for resident", "Closed"];
    const positions = labels.map((label) => out.indexOf(`${label}<span`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(words(out)).toContain("Needs action 9");
    expect(words(out)).toContain("Closed 12");
    expect(count(out, /<span class="text-caption text-ink-2">/g)).toBe(8);
  });

  it("only the chosen view is the current page; every link keeps the filters and names its view in the address", () => {
    expect(count(out, /aria-current="page"/g)).toBe(1);
    expect(out).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/staff\/complaints\?view=open"|<a[^>]*href="\/staff\/complaints\?view=open"[^>]*aria-current="page"/);
    for (const view of BOARD_VIEWS) expect(out).toContain(`href="/staff/complaints?view=${view}"`);
    const filtered = html(h(ViewList, { view: "open", counts, filters: { ...NO_FILTERS, assignee: "me", category: "LIFT" } }));
    expect(filtered).toContain('href="/staff/complaints?view=mine&amp;category=LIFT&amp;assignee=me"');
  });

  it("each link is at least 48px tall with 8px between them, and none is filled", () => {
    expect(count(out, /min-h-12/g)).toBe(8);
    expect(out).toContain("gap-2");
    expect(out).not.toContain("bg-accent");
  });
});

describe("SB1b the View button and the Filters button", () => {
  it("the View button is outlined, 48px, and names the current view with its count", () => {
    const out = html(h(ViewsMenu, { view: "needs_action", counts, filters: NO_FILTERS }));
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*aria-haspopup="dialog"[^>]*>View: Needs action <span class="tnum">9<\/span><\/button>/);
    expect(out).not.toContain("bg-accent");
    expect(out).toContain("Choose a view");
  });

  it("the Filters sheet has the four filters, Apply (the only filled control) and Reset (disabled with no filter on)", () => {
    const out = html(h(FiltersMenu, { view: "open", filters: NO_FILTERS }));
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Filters<\/button>/);
    for (const name of ["category", "assignee", "urgency", "q"]) expect(out).toContain(`name="${name}"`);
    for (const label of ["Category", "Assigned to", "Urgency", "Flat code"]) expect(words(out)).toContain(label);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*>Apply<\/button>/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Reset<\/button>/);
    expect(count(out, /bg-accent/g)).toBe(1);
  });

  it("Reset is available when a filter is on, and the fields show the filter", () => {
    const out = html(h(FiltersMenu, { view: "open", filters: { category: "LIFT", assignee: "me", urgency: "HIGH", q: "T12" } }));
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Reset<\/button>/);
    expect(out).toContain('value="T12"');
  });
});

describe("SB1c the active filters", () => {
  it("are removable chips, each a 48px link to the same board without that filter", () => {
    const out = html(h(FilterChips, { view: "open", filters: { category: "LIFT", assignee: "me", urgency: "HIGH", q: "T12-04" } }));
    expect(count(out, /<a /g)).toBe(4);
    expect(words(out)).toContain("Category: Lift");
    expect(words(out)).toContain("Assigned to: Me");
    expect(words(out)).toContain("Urgency: High");
    expect(words(out)).toContain("Flat: T12-04");
    expect(out).toContain('aria-label="Remove filter Category: Lift"');
    expect(out).toContain('href="/staff/complaints?view=open&amp;assignee=me&amp;urgency=HIGH&amp;q=T12-04"');
    expect(count(out, /min-h-12/g)).toBe(4);
  });

  it("are absent when no filter is on", () => {
    expect(html(h(FilterChips, { view: "open", filters: NO_FILTERS }))).toBe("");
  });
});

describe("SB2 the compact rows", () => {
  const rows = [
    row(),
    row({ id: "b0000000-0000-4000-8000-000000000002", title: "Gas smell in the corridor", flatCode: "T07-1203", category: null, urgency: "CRITICAL", status: "NEW", safety: true, needsReview: true, assignee: null, ageMinutes: 5, responseDueAt: NOW - 152 * minute, sla: "OVERDUE" }),
  ];
  const out = html(h(BoardRows, { rows, caption: "Needs action complaints", now: NOW }));
  const cards = out.slice(out.indexOf('<ul class="flex flex-col gap-2 md:hidden">'));

  it("is a real table from 768px, with a caption and the eight columns, and one tappable card per complaint below", () => {
    expect(out).toContain('<div class="hidden md:block">');
    expect(out).toContain("<caption");
    expect(count(out, /<th scope="col"/g)).toBe(8);
    expect(count(out, /<tr /g)).toBe(3);
    expect(count(cards, /<li>/g)).toBe(2);
    for (const heading of ["Flat", "Complaint", "Category", "Urgency", "Status", "Assigned to", "Reply", "Age"]) expect(out).toContain(`>${heading}</th>`);
  });

  it("a card is ONE link with four lines at most: flat chip, a one-line title, Category · Status · Assignee, and a notice only when notable", () => {
    const first = words(cards.split("<li>")[1]);
    expect(first).toContain("T12-0408 Water leak under the kitchen sink Plumbing · Assigned · Kavita Rao Reply due in 40 min");
    expect(first).not.toContain("Normal");
    const quietHtml = html(h(BoardRows, { rows: [row({ responseDueAt: NOW + 600 * minute })], caption: "c", now: NOW }));
    expect(words(quietHtml.slice(quietHtml.indexOf('<ul class="flex flex-col gap-2 md:hidden">')))).not.toContain("Reply");
    expect(cards.split("<li>")[1]).toMatch(/<span class="truncate text-body font-semibold text-accent">Water leak under the kitchen sink<\/span>/);
    expect(count(cards, /<a /g)).toBe(2);
  });

  it("a critical safety complaint has the urgency chip, the Safety chip and the overdue line with the caution mark", () => {
    const second = cards.split("<li>")[2];
    expect(words(second)).toContain("T07-1203 Critical Safety Gas smell in the corridor No category · New · Unassigned Reply overdue 2 h 32 min");
    expect(second).toMatch(/<span class="[^"]*text-caution[^"]*"><svg[^>]*aria-hidden="true"/);
    expect(second).toMatch(/text-caution[^"]*border-caution[^"]*"[^>]*>Critical<\/span>/);
  });

  it("the classification source tags are not on the row", () => {
    for (const source of ["RULE", "LLM", "FALLBACK", "MANUAL"] as const) {
      const text = words(html(h(BoardRows, { rows: [row({ source, needsReview: true })], caption: "c", now: NOW })));
      for (const gone of ["Model", "Rules", "Keywords", "Manual", "Needs review", "Classified by"]) expect(text).not.toContain(gone);
    }
  });

  it("the table says the full reply words and the age", () => {
    const body = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>"));
    expect(words(body.split("<tr ")[1])).toContain("T12-0408 Water leak under the kitchen sink Plumbing Normal Assigned Kavita Rao Reply due in 40 min 3 h 5 min");
    expect(words(body.split("<tr ")[2])).toContain("Reply overdue by 2 h 32 min");
  });

  it("every target is at least 48px tall, the cards are 8px apart, no cell is filled and nothing is written in capitals", () => {
    expect(cards).toContain("gap-2");
    expect(count(cards, /min-h-12/g)).toBe(2);
    expect(out).toMatch(/<a [^>]*min-h-12[^>]*>Water leak under the kitchen sink<\/a>/);
    expect(out).not.toContain("bg-accent");
    expect(out).not.toMatch(/uppercase|tracking-/);
  });
});

describe("SB3 the board page", () => {
  it("has one main landmark, one h1 'Complaints', the views as a sidebar from 1024px, and the View and Filters buttons", () => {
    const out = html(h(BoardView, { page: page(), demo: false }));
    expect(out).toContain("<main");
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toMatch(/<h1[^>]*>Complaints<\/h1>/);
    expect(out).toContain('<aside class="hidden w-80 shrink-0 lg:block">');
    expect(out).toContain('<div class="lg:hidden">');
    expect(words(out)).toContain("View: Needs action 9");
    expect(out).toMatch(/<button[^>]*>Filters<\/button>/);
  });

  it("shows the alert strip only when a safety complaint waits for the duty manager, as a link to the Safety view", () => {
    const none = html(h(BoardView, { page: page({ unacknowledgedSafety: 0 }), demo: false }));
    expect(none).not.toContain("waiting for the duty manager");
    const two = html(h(BoardView, { page: page({ unacknowledgedSafety: 2 }), demo: false }));
    expect(two).toMatch(/<a [^>]*href="\/staff\/complaints\?view=safety"[^>]*>(<svg.*?<\/svg>)2 safety complaints waiting for the duty manager\.<\/a>/);
    expect(words(html(h(BoardView, { page: page({ unacknowledgedSafety: 1 }), demo: false })))).toContain("1 safety complaint waiting for the duty manager.");
  });

  it("shows the demo note only in demo mode", () => {
    expect(words(html(h(BoardView, { page: page(), demo: true })))).toContain("Demo data is dated 27 October, so replies can look overdue.");
    expect(words(html(h(BoardView, { page: page(), demo: false })))).not.toContain("Demo data");
  });

  it("offers Show 15 more and Showing 15 of n only when there is more; outlined, 48px", () => {
    const rows15 = Array.from({ length: 15 }, (_, i) => row({ id: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
    const out = html(h(BoardView, { page: page({ rows: rows15, total: 40, nextCursor: "abc" }), demo: false }));
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Show 15 more<\/button>/);
    expect(words(out)).toContain("Showing 15 of 40");
    expect(html(h(BoardView, { page: page({ nextCursor: null }), demo: false }))).not.toContain("Show 15 more");
    expect(words(html(h(BoardView, { page: page({ rows: rows15.slice(0, 2), total: 17, nextCursor: "abc" }), demo: false }))).replace(/\s+/g, " ")).toContain("Show 15 more");
  });

  it("an empty view says so in words and draws no table; with a filter on it says that nothing matches", () => {
    const empty = html(h(BoardView, { page: page({ rows: [], total: 0 }), demo: false }));
    expect(empty).toContain("Nothing here. Every complaint is handled.");
    expect(empty).not.toContain("<table");
    const filtered = html(h(BoardView, { page: page({ rows: [], total: 0, filters: { ...NO_FILTERS, assignee: "me" } }), demo: false }));
    expect(filtered).toContain("No complaint matches these filters.");
  });

  it("no control on the page is filled", () => {
    expect(html(h(BoardView, { page: page({ unacknowledgedSafety: 2, nextCursor: "x" }), demo: true }))).not.toContain("bg-accent border-2 border-accent");
  });

  it("BoardList on its own renders the rows it is given", () => {
    expect(words(html(h(BoardList, { view: "open", filters: NO_FILTERS, initialRows: [row()], initialCursor: null, total: 1, now: NOW })))).toContain("T12-0408");
  });
});

describe("SB4 the staff landing tool", () => {
  const manager = ["complaints:manage"];

  it("a person with complaints:manage sees the Complaints tool, a link to the board, with no number when no safety complaint is open", () => {
    const out = html(h(StaffView, { name: "Kavita Rao", permissions: manager }));
    expect(out).toMatch(/<a [^>]*href="\/staff\/complaints"[^>]*>Complaints<\/a>/);
    expect(words(out)).not.toContain("open safety complaint");
  });

  it("says how many safety complaints are open when above zero, in words", () => {
    expect(words(html(h(StaffView, { name: "K", permissions: manager, openSafety: 1 })))).toContain("1 open safety complaint");
    expect(words(html(h(StaffView, { name: "K", permissions: manager, openSafety: 3 })))).toContain("3 open safety complaints");
  });

  it("a person without complaints:manage sees no Complaints tool, and never the safety number", () => {
    const out = html(h(StaffView, { name: "Priya Nair", permissions: ["payments:match"], openSafety: 4 }));
    expect(out).not.toContain("/staff/complaints");
    expect(out).not.toContain("safety complaint");
    expect(out).toContain("Bank reconciliation");
  });

  it("the two tools are listed together for a person who holds both permissions, reconciliation first", () => {
    const out = html(h(StaffView, { name: "N", permissions: ["payments:match", "complaints:manage"] }));
    expect(out.indexOf("Bank reconciliation")).toBeLessThan(out.indexOf(">Complaints<"));
  });
});
