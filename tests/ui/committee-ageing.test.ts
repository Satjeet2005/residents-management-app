import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeingBlock } from "@/app/(staff)/staff/reports/ageing-block";
import { AgeingDetail } from "@/app/(staff)/staff/reports/ageing-detail";
import { AgeingRows } from "@/app/(staff)/staff/reports/ageing-rows";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import type { Ageing } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
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
const zero = (b: Ageing["buckets"][number]) => ({ ...b, flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n });
const money: MoneyLine = { billedPaise: 1_000_000_000n, collectedPaise: 850_000_000n, outstandingPaise: 150_000_000n, flatsBilled: 300, flatsPaidInFull: 100, flatsOutstanding: 200, fees: { postedPaidPaise: 0n, postedOwingPaise: 0n, accruingPaise: 0n } };

describe("CA1 the age list: one list instead of bars, a table and a second set of rows (D180)", () => {
  const out = html(h(AgeingBlock, { ageing, money: null, period: "2026-10-01", selected: null }));
  const text = words(out);

  it("says it is ALL open dues of ALL months, gives the total with its split and the different flats", () => {
    expect(text).toContain("All open dues, all months, as of the date above. The month chosen does not change this block.");
    expect(text).toContain("Total owed ₹55,65,000");
    expect(text).toContain("₹55,65,000 = unpaid bills ₹55,65,000 + late fees ₹0");
    expect(text).toContain("520 different flats in total");
    expect(text).toContain("A flat appears in every age group where it has a bill.");
  });

  it("lists the five groups in order, each with its amount, its bills and its share of the total; ONE list, no second set of rows", () => {
    const list = out.slice(out.indexOf("<ul"), out.indexOf("</ul>"));
    const labels = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"];
    const positions = labels.map((label) => list.indexOf(label));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(words(list)).toContain("31 to 60 days ₹25,00,000 310 bills · 45% of the total");
    expect(words(list)).toContain("Not yet due ₹65,000 10 bills · 1% of the total");
    expect(count(out.slice(0, out.indexOf("<details")), /<ul/g)).toBe(1);
  });

  it("each bar is a share of the TOTAL (comparable), drawn by a div, never inside a picture", () => {
    expect(out).not.toContain("<svg");
    expect(out).toContain("width:44.9%");
    expect(out).toContain("width:8.9%");
  });

  it("each group with bills has a 48px link named by the group to its drill-down, beside the bar", () => {
    expect(count(out, />See the flats<\/a>/g)).toBe(5);
    expect(out).toContain('href="/staff/reports/dues?period=2026-10&amp;bucket=31-60#ageing-detail"');
    expect(out).toContain('aria-label="See the flats: 31 to 60 days"');
    for (const link of out.match(/<a [^>]*>/g) ?? []) expect(link).toContain("min-h-12");
  });

  it("an empty 'Not yet due' is left out, a group with no bills has no link, and a selected group is current and bold", () => {
    const sparse: Ageing = { ...ageing, buckets: ageing.buckets.map((b) => (b.bucket === "OVER_90" || b.bucket === "NOT_YET_DUE" ? zero(b) : b)) };
    const sparseOut = html(h(AgeingBlock, { ageing: sparse, money: null, period: "2026-10-01", selected: null }));
    expect(count(sparseOut, />See the flats<\/a>/g)).toBe(3);
    expect(words(sparseOut)).not.toContain("Not yet due");
    expect(words(sparseOut)).toContain("Over 90 days ₹0 0 bills · 0% of the total");
    const chosen = html(h(AgeingBlock, { ageing, money: null, period: "2026-10-01", selected: "DAYS_31_60" }));
    expect(chosen).toMatch(/aria-current="true"[^>]*>See the flats/);
    expect(chosen).toContain('font-semibold">31 to 60 days');
  });

  it("the numbers behind the list are one tap away, in a table with the six columns and a total row", () => {
    expect(out).toContain("See the numbers behind this chart");
    expect(text).toContain("Age Bills Flats Unpaid bills Late fees Total");
    expect(text).toContain("Total owed 700 520 ₹55,65,000 ₹0 ₹55,65,000");
    expect(words(out.slice(out.indexOf("md:hidden"))).replace(/\s+/g, " ")).toContain("Total owed Bills 700 Flats 520 Unpaid bills ₹55,65,000 Late fees ₹0 Total ₹55,65,000");
  });

  it("a sentence ties the month's Still unpaid to the group that holds it, when there is a money line", () => {
    const tied: Ageing = { ...ageing, buckets: ageing.buckets.map((b) => (b.bucket === "DAYS_1_30" ? { ...b, flats: 200, bills: 200, unpaidBillsPaise: 150_000_000n, lateFeesPaise: 3_075_100n, amountDuePaise: 153_075_100n } : b)) };
    expect(words(html(h(AgeingBlock, { ageing: tied, money, period: "2026-10-01", selected: null })))).toContain("October's unpaid bills are ₹15,00,000 (Billed and collected). The 1 to 30 days group also holds late fees of ₹30,751.");
  });

  it("nothing owed says so in words and has no list and no link", () => {
    const none: Ageing = { buckets: ageing.buckets.map(zero), total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } };
    const empty = html(h(AgeingBlock, { ageing: none, money: null, period: "2026-10-01", selected: null }));
    expect(words(empty)).toContain("Nothing is owed.");
    expect(empty).not.toContain("<ul");
    expect(empty).not.toContain("See the flats");
  });

  it("shows no name, no phone number, no button and nothing filled", () => {
    expect(out).not.toMatch(/<button/);
    expect(text).not.toMatch(/\d{10}/);
  });
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

describe("CA4 the page with the ageing", () => {
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
