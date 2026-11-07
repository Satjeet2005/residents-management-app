import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ComplaintsError from "@/app/(staff)/staff/complaints/error";
import Loading from "@/app/(staff)/staff/complaints/loading";
import ComplaintLoading from "@/app/(staff)/staff/complaints/[id]/loading";
import ComplaintNotFound from "@/app/(staff)/staff/complaints/[id]/not-found";
import { BoardView } from "@/app/(staff)/staff/complaints/board-view";
import { BOARD_LANES, emptyLaneText } from "@/lib/staff-complaints/lanes";
import type { BoardPage } from "@/server/complaints/staff-page-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/complaints/actions", () => ({ loadMoreComplaints: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("SX1 loading", () => {
  it.each([
    ["the board", Loading, "Loading complaints"],
    ["one complaint", ComplaintLoading, "Loading this complaint"],
  ])("%s shows plain bars and a status line, with no heading (the page that replaces it has the only h1)", (_label, Component, text) => {
    const out = html(h(Component));
    expect(out).toContain('role="status"');
    expect(out).toContain(text);
    expect(out).toContain('aria-busy="true"');
    expect(count(out, /<h1/g)).toBe(0);
    expect(count(out, /<main/g)).toBe(1);
    expect(out).not.toMatch(/animate|shimmer|spin/);
  });
});

describe("SX2 the error boundary", () => {
  const out = html(h(ComplaintsError, { error: Object.assign(new Error("connection string postgres://secret@host/db"), { digest: "d1" }), reset: () => {} }));

  it("says what went wrong, that nothing changed, and offers Try again", () => {
    expect(out).toContain('role="alert"');
    expect(out).toContain("We could not load the complaints.");
    expect(out).toContain("Nothing was changed. You can try again.");
    expect(out).toMatch(/<button [^>]*min-h-12[^>]*>Try again<\/button>/);
    expect(count(out, /<h1/g)).toBe(1);
  });

  it("never shows the error itself", () => {
    expect(out).not.toContain("postgres://");
    expect(out).not.toContain("secret");
  });
});

describe("SX3 empty lanes", () => {
  const page = (lane: BoardPage["lane"]): BoardPage => ({ lane, counts: { NEEDS_TRIAGE: 0, SAFETY: 0, OPEN: 0, OVERDUE: 0, WAITING_RESIDENT: 0, CLOSED: 0 }, rows: [], nextCursor: null, now: Date.UTC(2026, 10, 6) });

  it.each(BOARD_LANES)("%s says there is nothing to do, draws no table and no Load more", (lane) => {
    const out = html(h(BoardView, { page: page(lane) }));
    expect(out).toContain(emptyLaneText());
    expect(out).toContain("Nothing here. Every complaint is handled.");
    expect(out).not.toContain("<table");
    expect(out).not.toContain("Load more");
  });
});

describe("SX4 a complaint that does not exist", () => {
  const out = html(h(ComplaintNotFound));

  it("has one h1, says what happened, and offers a 48px way back to the board", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("Complaint not found");
    expect(out).toContain("No complaint has this address. Go back to the board.");
    expect(out).toMatch(/<a [^>]*min-h-12[^>]*>Back to the board<\/a>/);
    expect(out).toContain('href="/staff/complaints"');
  });

  it("shows nothing of any complaint", () => {
    expect(out).not.toMatch(/T\d\d-\d{4}/);
  });
});
