import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Loading from "@/app/(staff)/staff/reports/loading";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import { emptyReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }), saveSections: async () => ({ ok: true, data: "SAVED" }) }));

const html = renderToStaticMarkup;
const out = html(h(ReportView, { report: emptyReport() }));

describe("LY1 the layout at phone, tablet and laptop widths", () => {
  it("cards: one column below 768px, two by two from 768px, four in a row from 1280px", () => {
    const cards = /<ul class="([^"]*)"><li data-block="" data-figure="cardCollected" class="[^"]*"><div class="[^"]*"><h2[^>]*>Money collected for October/.exec(out)?.[1] ?? "";
    expect(cards).toContain("grid");
    expect(cards).not.toMatch(/(^| )grid-cols-/);
    expect(cards).toContain("md:grid-cols-2");
    expect(cards).toContain("xl:grid-cols-4");
  });

  it("the overview has Look closer as ONE list of four rows (not cards), each a link at least 56px tall", () => {
    const list = /<ul class="[^"]*">(<li class="border-b[\s\S]*?)<\/ul>/.exec(out)?.[1] ?? "";
    expect(list.match(/<li /g)).toHaveLength(4);
    expect(list.match(/<a [^>]*min-h-14/g)).toHaveLength(4);
  });

  it("a section page has the list of the other pages only from 1024px, and marks the current page", () => {
    const page = html(h(SectionPage, { slug: "dues", report: emptyReport() }));
    expect(page).toMatch(/<nav aria-label="Report pages" class="hidden lg:block/);
    expect(page.match(/aria-current="page"/g)).toHaveLength(1);
    expect(page).toMatch(/aria-current="page"[^>]*>Dues<\/a>/);
  });

  it("charts: the phone bars show below 768px and the laptop columns from 768px, each full width, never side by side", () => {
    const money = { billedPaise: 1_000_000n, collectedPaise: 800_000n, outstandingPaise: 200_000n, flatsBilled: 1, flatsPaidInFull: 0, flatsOutstanding: 1, fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n } };
    const withMoney = html(h(SectionPage, { slug: "collections", report: emptyReport({ money }) }));
    expect(withMoney).toContain('<div data-figure="within20" class="md:hidden"><figure');
    expect(withMoney).toContain('<div data-figure-form="within20" class="hidden md:block"><figure');
    expect(withMoney).not.toMatch(/(md|lg|xl):(flex|grid-cols)[^"]*"><figure/);
  });

  it("the page has a 16px gutter and no horizontal overflow class", () => {
    expect(out).toMatch(/<main class="[^"]*\bp-4\b/);
    expect(out).not.toMatch(/overflow-x-scroll|w-\[\d{4,}px\]|min-w-\[\d{3,}px\]/);
  });

  it("each section summary is a 48px target", () => {
    for (const summary of out.match(/<summary[^>]*>/g) ?? []) expect(summary).toContain("min-h-12");
  });

  it("text sizes use the design tokens only: body 16px and captions 14px, none smaller", () => {
    expect(out).not.toMatch(/text-\[\d+px\]|text-xs|text-sm/);
  });
});

describe("LY2 the loading state has the same shape", () => {
  const loading = html(h(Loading));

  it("shows four card placeholders and five section placeholders in the same grids", () => {
    expect(loading).toContain("md:grid-cols-2 xl:grid-cols-4");
    expect(loading).toContain("xl:grid-cols-2");
    expect((loading.match(/aria-busy="true"/g) ?? []).length).toBe(9);
  });
});
