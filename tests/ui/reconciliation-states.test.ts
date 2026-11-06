import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReconciliationError from "@/app/(staff)/staff/reconciliation/error";
import Loading from "@/app/(staff)/staff/reconciliation/loading";
import WorkspaceLoading from "@/app/(staff)/staff/reconciliation/[importId]/loading";
import ImportNotFound from "@/app/(staff)/staff/reconciliation/[importId]/not-found";
import { emptyLaneText } from "@/app/(staff)/staff/reconciliation/[importId]/row-list";
import { ImportsTable } from "@/app/(staff)/staff/reconciliation/imports-table";
import { LANES } from "@/lib/reconciliation/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reconciliation/[importId]/actions", () => ({ loadMoreRows: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("ST1 loading", () => {
  it.each([
    ["the start page", Loading, "Loading bank reconciliation"],
    ["the workspace", WorkspaceLoading, "Loading this import"],
  ])("%s shows plain bars and a status line, with no heading (the page that replaces it has the only h1)", (_label, Component, text) => {
    const out = html(h(Component));
    expect(out).toContain('role="status"');
    expect(out).toContain(text);
    expect(out).toContain('aria-busy="true"');
    expect(count(out, /<h1/g)).toBe(0);
    expect(out).not.toMatch(/animate|shimmer|spin/);
  });
});

describe("ST2 the error boundary", () => {
  const out = html(h(ReconciliationError, { error: Object.assign(new Error("connection string postgres://secret@host/db"), { digest: "d1" }), reset: () => {} }));

  it("says what went wrong, that nothing changed, and offers Try again", () => {
    expect(out).toContain('role="alert"');
    expect(out).toContain("We could not load this page.");
    expect(out).toContain("Nothing was changed. You can try again.");
    expect(out).toMatch(/<button [^>]*>Try again<\/button>/);
    expect(count(out, /<h1/g)).toBe(1);
  });

  it("never shows the error itself", () => {
    expect(out).not.toContain("postgres://");
    expect(out).not.toContain("secret");
  });
});

describe("ST3 empty states", () => {
  it("each lane says what an empty lane means; Needs you says every row is accounted for", () => {
    expect(emptyLaneText("NEEDS_YOU")).toBe("Nothing needs you. Every row is accounted for.");
    expect(new Set(LANES.map(emptyLaneText)).size).toBe(4);
  });

  it("no imports yet says to upload one", () => {
    expect(html(h(ImportsTable, { imports: [] }))).toContain("No statement has been imported yet. Upload one above.");
  });
});

describe("ST4 an import that does not exist", () => {
  const out = html(h(ImportNotFound));
  it("has one h1, says what happened and links back", () => {
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("Import not found");
    expect(out).toMatch(/<a [^>]*href="\/staff\/reconciliation"[^>]*>All imports<\/a>/);
  });
});
