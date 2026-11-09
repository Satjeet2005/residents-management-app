import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeingDetail } from "@/app/(staff)/staff/reports/ageing-detail";
import { AgeingRows } from "@/app/(staff)/staff/reports/ageing-rows";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import type { Ageing } from "@/domain/reports/age";
import type { AgeingPage, AgeingRowView } from "@/server/reports/ageing-page";
import { emptyReport } from "./committee-fixtures";
import type { CommitteeReport } from "@/server/reports/report-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
// The server action is only called on a click; rendering needs the module to exist.
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const ageing: Ageing = {
  buckets: [
    { bucket: "NOT_YET_DUE", flats: 10, bills: 10, unpaidBillsPaise: 6_500_000n, lateFeesPaise: 0n, amountDuePaise: 6_500_000n },
    { bucket: "DAYS_1_30", flats: 200, bills: 200, unpaidBillsPaise: 150_000_000n, lateFeesPaise: 0n, amountDuePaise: 150_000_000n },
    { bucket: "DAYS_31_60", flats: 300, bills: 310, unpaidBillsPaise: 250_000_000n, lateFeesPaise: 0n, amountDuePaise: 250_000_000n },
    { bucket: "DAYS_61_90", flats: 100, bills: 120, unpaidBillsPaise: 100_000_000n, lateFeesPaise: 0n, amountDuePaise: 100_000_000n },
    { bucket: "OVER_90", flats: 50, bills: 60, unpaidBillsPaise: 50_000_000n, lateFeesPaise: 0n, amountDuePaise: 50_000_000n },
  ],
  total: { flats: 520, bills: 700, unpaidBillsPaise: 556_500_000n, lateFeesPaise: 0n, amountDuePaise: 556_500_000n },
};
const row = (over: Partial<AgeingRowView> = {}): AgeingRowView => ({ flatCode: "T12-0408", bills: 1, oldestDaysPastDue: 47, amountDuePaise: "646800", ...over });
const page = (over: Partial<AgeingPage> = {}): AgeingPage => ({
  bucket: "DAYS_31_60",
  sort: "LARGEST",
  flats: 120,
  amountDuePaise: "250000000",
  rows: [row(), row({ flatCode: "T07-1203", bills: 2, oldestDaysPastDue: 40, amountDuePaise: "1066000" })],
  nextCursor: "abc",
  ...over,
});

describe("CA2 the drill-down rows: per FLAT", () => {
  const out = html(h(AgeingRows, { rows: page().rows, caption: "Flats that owe in 31 to 60 days, largest first" }));

  it("is a real table from 768px with a caption, scope on every header, and the flat as the row header", () => {
    expect(out).toContain('<div class="hidden md:block">');
    expect(out).toContain('<caption class="sr-only">Flats that owe in 31 to 60 days, largest first</caption>');
    expect(count(out, /<th scope="col"/g)).toBe(4);
    expect(count(out, /<th scope="row"/g)).toBe(2);
    for (const heading of ["Flat", "Bills", "Days overdue (oldest bill)", "Total owed in this group"]) expect(out).toContain(`>${heading}</th>`);
  });

  it("each row has the flat code, its bills, the days overdue of its oldest bill and its total", () => {
    const first = out.slice(out.indexOf("<tbody>")).split("<tr ")[1];
    const text = words(first);
    for (const part of ["T12-0408", "47", "₹6,468"]) expect(text).toContain(part);
    expect(words(out.slice(out.indexOf("<tbody>")).split("<tr ")[2])).toContain("T07-1203 2 40 ₹10,660");
  });

  it("numbers are right-aligned in tabular figures", () => {
    expect(out).toMatch(/<th scope="col" class="py-2 pr-4 text-right font-semibold">Days overdue \(oldest bill\)<\/th>/);
    expect(out).toMatch(/<td class="tnum py-2 pr-4 text-right">47<\/td>/);
    expect(out).toMatch(/<td class="py-2 text-right"><span class="tnum text-body">₹6,468<\/span><\/td>/);
  });

  it("stacked cards below 768px give the bills only when a flat has more than one", () => {
    const cards = out.slice(out.indexOf('<ul class="flex list-none flex-col p-0 md:hidden">'));
    expect(words(cards)).toContain("T12-0408 ₹6,468 47 days overdue");
    expect(words(cards)).toContain("T07-1203 ₹10,660 2 bills 40 days overdue");
  });

  it("a flat not yet due says so instead of a number of days", () => {
    const notDue = html(h(AgeingRows, { rows: [row({ oldestDaysPastDue: -3 })], caption: "c" }));
    expect(notDue).toMatch(/<td class="tnum py-2 pr-4 text-right">Not yet due<\/td>/);
  });

  it("every table row has exactly four cells: there is no cell for a name", () => {
    const body = out.slice(out.indexOf("<tbody>"), out.indexOf("</tbody>"));
    const tableRows = body.split("<tr ").slice(1);
    expect(tableRows).toHaveLength(2);
    for (const r of tableRows) {
      expect(count(r, /<th /g)).toBe(1);
      expect(count(r, /<td /g)).toBe(3);
    }
  });

  it("carries no name and no phone number: the row type has none", () => {
    expect(Object.keys(row()).sort()).toEqual(["amountDuePaise", "bills", "flatCode", "oldestDaysPastDue"]);
    expect(words(out)).not.toMatch(/\d{10}/);
  });
});

describe("CA3 the drill-down section", () => {
  const out = html(h(AgeingDetail, { page: page(), period: "2026-10-01" }));

  it("has a heading with the flats and the amount of the group, and the hint that there are no names", () => {
    expect(out).toContain('id="ageing-detail"');
    expect(words(out)).toContain("120 flats owe ₹25.0 lakh (31 to 60 days)");
    expect(out).toMatch(/<h2 id="committee-drill" tabindex="-1"/);
    expect(words(out)).toContain("Flat codes only: no names and no phone numbers.");
    expect(words(html(h(AgeingDetail, { page: page({ flats: 1 }), period: "2026-10-01" })))).toContain("1 flat owes ₹25.0 lakh (31 to 60 days)");
  });

  it("offers a way back to the age groups at the TOP and at the bottom, 48px, to the list", () => {
    const links = out.match(/<a [^>]*>← Back to age groups<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toContain("min-h-12");
    expect(out).toContain('href="/staff/reports/dues?period=2026-10#owed"');
    expect(out.indexOf("Back to age groups")).toBeLessThan(out.indexOf('id="committee-drill"'));
    expect(out.lastIndexOf("Back to age groups")).toBeGreaterThan(out.indexOf("</table>"));
  });

  it("offers Largest first (the default, current) and Oldest first as links that keep the group", () => {
    expect(out).toContain('aria-current="true"');
    expect(out).toMatch(/<a aria-current="true"[^>]*href="\/staff\/reports\/dues\?period=2026-10&amp;bucket=31-60&amp;sort=largest#ageing-detail">Largest first<\/a>/);
    expect(out).toContain('href="/staff/reports/dues?period=2026-10&amp;bucket=31-60&amp;sort=oldest#ageing-detail"');
    const oldest = html(h(AgeingDetail, { page: page({ sort: "OLDEST" }), period: "2026-10-01" }));
    expect(oldest).toMatch(/<a aria-current="true"[^>]*>Oldest first<\/a>/);
    expect(oldest).not.toMatch(/<a aria-current="true"[^>]*>Largest first/);
    expect(words(oldest)).toContain("Flats that owe in 31 to 60 days, oldest first");
  });

  it("says how many are shown of how many, and offers Show 25 more only when there is a next page: outlined, 48px", () => {
    expect(words(out)).toContain("Showing 2 of 120");
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Show 25 more<\/button>/);
    expect(out).not.toContain("bg-accent");
    expect(html(h(AgeingDetail, { page: page({ nextCursor: null }), period: "2026-10-01" }))).not.toContain("Show 25 more");
  });

  it("an empty group says so in words and draws no table", () => {
    const empty = html(h(AgeingDetail, { page: page({ rows: [], flats: 0, nextCursor: null }), period: "2026-10-01" }));
    expect(words(empty)).toContain("No flat owes anything in this age group.");
    expect(empty).not.toContain("<table");
  });
});

describe("CA4 the Dues page with the drill-down", () => {
  const report = (drilldown: AgeingPage | null): CommitteeReport => emptyReport({ ageing, drilldown });

  it("the Dues page always has the owed list, with the drill-down after it only when a group is chosen", () => {
    const without = html(h(SectionPage, { slug: "dues", report: report(null) }));
    expect(without).toContain('<section id="owed"');
    expect(without).not.toContain('id="ageing-detail"');
    const withDrill = html(h(SectionPage, { slug: "dues", report: report(page()) }));
    expect(withDrill.indexOf('<section id="owed"')).toBeLessThan(withDrill.indexOf('id="ageing-detail"'));
    expect(count(withDrill, /<h1/g)).toBe(1);
  });

  it("at most one filled control: none", () => {
    const out = html(h(SectionPage, { slug: "dues", report: report(page()) }));
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});
