import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReportError from "@/app/(staff)/staff/reports/error";
import Loading from "@/app/(staff)/staff/reports/loading";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("CS1 loading", () => {
  const out = html(h(Loading));

  it("shows plain bars and a status line, with no heading (the page that replaces it has the only h1) and one main landmark", () => {
    expect(out).toContain('role="status"');
    expect(out).toContain("Loading the committee report");
    expect(out).toContain('aria-busy="true"');
    expect(count(out, /<h1/g)).toBe(0);
    expect(count(out, /<main/g)).toBe(1);
  });

  it("has nothing that moves", () => {
    expect(out).not.toMatch(/animate|shimmer|spin/);
  });
});

describe("CS2 the error boundary", () => {
  const out = html(h(ReportError, { error: Object.assign(new Error("connection string postgres://secret@host/db"), { digest: "d1" }), reset: () => {} }));

  it("says what went wrong, that nothing changed, and offers Try again, 48px tall", () => {
    expect(out).toContain('role="alert"');
    expect(words(out)).toContain("We could not load the report.");
    expect(words(out)).toContain("Nothing was changed: the report only reads. You can try again.");
    expect(out).toMatch(/<button [^>]*min-h-12[^>]*>Try again<\/button>/);
    expect(count(out, /<h1/g)).toBe(1);
    expect(count(out, /<main/g)).toBe(1);
  });

  it("never shows the error itself", () => {
    expect(out).not.toContain("postgres://");
    expect(out).not.toContain("secret");
  });
});

describe("CS3 the empty month", () => {
  it("says 'No bills for this month' in words, still shows what is owed (all months), and the selector to choose another month", () => {
    const out = html(h(ReportView, { report: emptyReport({ period: "2026-03-01", periods: ["2026-10-01"] }) }));
    expect(words(out)).toContain("No bills for this month");
    expect(words(out)).toContain("Choose another month above.");
    expect(out).toContain('id="report-period"');
    expect(words(out)).toContain("October 2026 March 2026");
    expect(out).toContain("committee-ageing");
  });
});
