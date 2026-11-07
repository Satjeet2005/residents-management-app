import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import { BoardList } from "@/app/(staff)/staff/complaints/board-list";
import { BoardRows } from "@/app/(staff)/staff/complaints/board-rows";
import { BoardView } from "@/app/(staff)/staff/complaints/board-view";
import { LaneTabs } from "@/app/(staff)/staff/complaints/lane-tabs";
import { BOARD_LANES } from "@/lib/staff-complaints/lanes";
import type { BoardRow } from "@/server/complaints/board";
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
  needsReview: false,
  assignee: { id: "u1", name: "Kavita Rao" },
  ageMinutes: 185,
  responseDueAt: NOW + 40 * minute,
  sla: "ON_TIME",
  source: "LLM",
  version: 1,
  ...over,
});
const counts = { NEEDS_TRIAGE: 4, SAFETY: 1, OPEN: 7, OVERDUE: 2, WAITING_RESIDENT: 3, CLOSED: 12 };
const page = (over: Partial<BoardPage> = {}): BoardPage => ({ lane: "NEEDS_TRIAGE", counts, rows: [row()], nextCursor: null, now: NOW, ...over });

describe("SB1 the lane tabs", () => {
  const out = html(h(LaneTabs, { lane: "OPEN", counts }));

  it("are a tablist with six tabs in the order of the task, each with its count", () => {
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Complaint lanes"');
    expect(count(out, /role="tab"/g)).toBe(6);
    const labels = ["Needs triage", "Safety", "Open", "Overdue", "Waiting for resident", "Closed"];
    const positions = labels.map((label) => out.indexOf(`>${label}<`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(words(out)).toContain("Needs triage 4 Safety 1 Open 7 Overdue 2 Waiting for resident 3 Closed 12");
  });

  it("only the chosen tab is selected and in the tab order; every tab links to its lane in the address", () => {
    expect(count(out, /aria-selected="true"/g)).toBe(1);
    expect(count(out, /tabindex="0"/g)).toBe(1);
    expect(count(out, /tabindex="-1"/g)).toBe(5);
    expect(out).toMatch(/<a[^>]*id="complaints-tab-OPEN"[^>]*aria-selected="true"/);
    for (const query of ["needs-triage", "safety", "open", "overdue", "waiting", "closed"]) expect(out).toContain(`href="/staff/complaints?lane=${query}"`);
  });

  it("each tab is at least 48px tall, with 8px between tabs, and none is filled", () => {
    expect(count(out, /min-h-12/g)).toBe(6);
    expect(out).toContain("gap-2");
    expect(out).not.toContain("bg-accent");
  });
});

describe("SB2 the list", () => {
  const rows = [
    row(),
    row({ id: "b0000000-0000-4000-8000-000000000002", title: "Gas smell in the corridor", flatCode: "T07-1203", category: null, urgency: "CRITICAL", status: "NEW", safety: true, needsReview: true, assignee: null, ageMinutes: 5, responseDueAt: NOW - 120 * minute, sla: "OVERDUE", source: "RULE" }),
  ];
  const out = html(h(BoardRows, { rows, caption: "Needs triage complaints, newest first", now: NOW }));

  it("is a real table from 768px, with a caption, column headers and one row per complaint, and stacked cards below", () => {
    expect(out).toContain('<div class="hidden md:block">');
    expect(out).toContain('<ul class="flex flex-col md:hidden">');
    expect(out).toContain("<caption");
    expect(count(out, /<th scope="col"/g)).toBe(8);
    expect(count(out, /<tr /g)).toBe(3);
    expect(count(out, /<li /g)).toBe(2);
    for (const heading of ["Complaint", "Category", "Urgency", "Status", "Assigned to", "Age", "Reply", "Classified by"]) expect(out).toContain(`>${heading}</th>`);
  });

  it("each row has the flat code, category, urgency tag, status, assignee, age and the reply clock in words", () => {
    const first = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>")).split("<tr ")[1];
    const text = words(first);
    for (const part of ["T12-0408", "Water leak under the kitchen sink", "Plumbing", "Normal", "Assigned", "Kavita Rao", "3 h 5 min", "Reply due in 40 min", "Model"]) expect(text).toContain(part);
  });

  it("a critical complaint has the urgency tag in the caution tone WITH its word, the unassigned word, the overdue words and a Needs review tag", () => {
    const second = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>")).split("<tr ")[2];
    expect(second).toMatch(/<span class="[^"]*text-caution[^"]*border-caution[^"]*"[^>]*>Critical<\/span>/);
    expect(second).toMatch(/<span class="[^"]*text-caution[^"]*"[^>]*>Needs review<\/span>/);
    const text = words(second);
    for (const part of ["T07-1203", "No category", "Unassigned", "5 min", "Reply overdue by 2 h"]) expect(text).toContain(part);
  });

  it("the cards say the same in sentences", () => {
    const cards = out.slice(out.indexOf('<ul class="flex flex-col md:hidden">'));
    expect(words(cards)).toContain("Raised 3 h 5 min ago");
    expect(words(cards)).toContain("Plumbing. Assigned. Kavita Rao.");
    expect(words(cards)).toContain("No category. New. Unassigned.");
  });

  it("the source tags read Rules, Model, Keywords and Manual", () => {
    const sources = (["RULE", "LLM", "FALLBACK", "MANUAL"] as const).map((source) => words(html(h(BoardRows, { rows: [row({ source })], caption: "c", now: NOW }))));
    expect(sources.map((text) => ["Rules", "Model", "Keywords", "Manual"].filter((w) => text.includes(` ${w} `)).length)).toEqual([1, 1, 1, 1]);
  });

  it("no cell is filled and nothing is written in capitals", () => {
    expect(out).not.toContain("bg-accent");
    expect(out).not.toMatch(/uppercase|tracking-/);
  });
});

describe("SB3 the board page", () => {
  const out = html(h(BoardView, { page: page({ nextCursor: "abc" }) }));

  it("has one main landmark, one h1 'Complaints', the tabs and the tab panel labelled by the chosen tab", () => {
    expect(out).toContain("<main");
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toMatch(/<h1[^>]*>Complaints<\/h1>/);
    expect(out).toMatch(/<div role="tabpanel" id="complaints-lane-panel" aria-labelledby="complaints-tab-NEEDS_TRIAGE"/);
  });

  it("offers Load more only when there is a next page, outlined and 48px tall", () => {
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Load more<\/button>/);
    expect(out).not.toContain("bg-accent");
    expect(html(h(BoardView, { page: page({ nextCursor: null }) }))).not.toContain("Load more");
  });

  it("an empty lane says so in words and draws no table", () => {
    const empty = html(h(BoardView, { page: page({ rows: [] }) }));
    expect(empty).toContain("Nothing here. Every complaint is handled.");
    expect(empty).not.toContain("<table");
  });

  it("BoardList on its own renders the rows it is given", () => {
    expect(words(html(h(BoardList, { lane: "OPEN", initialRows: [row()], initialCursor: null, now: NOW })))).toContain("T12-0408");
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

describe("SB5 every lane has a tab", () => {
  it.each(BOARD_LANES)("%s", (lane) => {
    expect(html(h(LaneTabs, { lane, counts }))).toContain(`id="complaints-tab-${lane}"`);
  });
});
