import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeingBlock } from "@/app/(staff)/staff/reports/ageing-block";
import { AgeingDetail } from "@/app/(staff)/staff/reports/ageing-detail";
import { AgeingRows } from "@/app/(staff)/staff/reports/ageing-rows";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
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
    { bucket: "NOT_YET_DUE", flats: 10, bills: 10, amountDuePaise: 6_500_000n },
    { bucket: "DAYS_1_30", flats: 200, bills: 200, amountDuePaise: 150_000_000n },
    { bucket: "DAYS_31_60", flats: 300, bills: 310, amountDuePaise: 250_000_000n },
    { bucket: "DAYS_61_90", flats: 100, bills: 120, amountDuePaise: 100_000_000n },
    { bucket: "OVER_90", flats: 50, bills: 60, amountDuePaise: 50_000_000n },
  ],
  total: { flats: 520, bills: 700, amountDuePaise: 556_500_000n },
};
const row = (over: Partial<AgeingRowView> = {}): AgeingRowView => ({ billId: "b1", flatCode: "T12-0408", period: "2026-09-01", daysPastDue: 47, amountDuePaise: "646800", ...over });
const page = (over: Partial<AgeingPage> = {}): AgeingPage => ({ bucket: "DAYS_31_60", rows: [row(), row({ billId: "b2", flatCode: "T07-1203", daysPastDue: 40, amountDuePaise: "1066000" })], nextCursor: "abc", ...over });

describe("CA1 the ageing block", () => {
  const out = html(h(AgeingBlock, { ageing, period: "2026-10-01", selected: null }));
  const text = words(out);

  it("says it is ALL open dues of ALL months, shows the total due and the five buckets in order with flats, bills and amount due", () => {
    expect(text).toContain("What is owed");
    expect(text).toContain("All open dues, all months, as of the date above.");
    expect(text).toContain("Total due 520 flats, 700 bills ₹55,65,000");
    const positions = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"].map((label) => text.indexOf(label, text.indexOf("Total due")));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(text).toContain("Not yet due 10 flats, 10 bills ₹65,000");
    expect(text).toContain("31 to 60 days 300 flats, 310 bills ₹25,00,000");
    expect(text).toContain("Over 90 days 50 flats, 60 bills ₹5,00,000");
  });

  it("draws a segmented bar of plain elements whose widths add up to 100, hidden from assistive technology (the list carries the numbers)", () => {
    const bar = /<div aria-hidden="true" class="flex h-4 w-full[^"]*">([\s\S]*?)<\/div><div aria-hidden="true" class="h-\[7px\]/.exec(out)?.[1] ?? "";
    const widths = [...bar.matchAll(/width:(\d+)%/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out).not.toMatch(/<svg|<canvas|<img/);
  });

  it("each bucket with bills has a 48px link to its drill-down, named by the bucket", () => {
    expect(count(out, />See the flats<\/a>/g)).toBe(5);
    expect(out).toContain('href="/staff/reports?period=2026-10&amp;bucket=31-60#ageing-detail"');
    expect(out).toContain('aria-label="See the flats: 31 to 60 days"');
    for (const link of out.match(/<a [^>]*>/g) ?? []) expect(link).toContain("min-h-12");
  });

  it("a bucket with no bills has no link, and a selected bucket is marked as current and bold", () => {
    const sparse: Ageing = { ...ageing, buckets: ageing.buckets.map((b) => (b.bucket === "OVER_90" ? { ...b, flats: 0, bills: 0, amountDuePaise: 0n } : b)) };
    expect(count(html(h(AgeingBlock, { ageing: sparse, period: "2026-10-01", selected: null })), />See the flats<\/a>/g)).toBe(4);
    const chosen = html(h(AgeingBlock, { ageing, period: "2026-10-01", selected: "DAYS_31_60" }));
    expect(chosen).toMatch(/aria-current="true"[^>]*>See the flats/);
    expect(chosen).toContain("font-semibold\">31 to 60 days");
  });

  it("nothing owed says so in words and draws no bar", () => {
    const none: Ageing = { buckets: ageing.buckets.map((b) => ({ ...b, flats: 0, bills: 0, amountDuePaise: 0n })), total: { flats: 0, bills: 0, amountDuePaise: 0n } };
    const empty = html(h(AgeingBlock, { ageing: none, period: "2026-10-01", selected: null }));
    expect(words(empty)).toContain("Nothing is owed.");
    expect(empty).not.toContain("width:");
    expect(empty).not.toContain("See the flats");
  });

  it("shows no name, no phone number and nothing filled", () => {
    expect(out).not.toContain("bg-accent\"></a>");
    expect(out).not.toMatch(/<button/);
    expect(text).not.toMatch(/\d{10}/);
  });
});

describe("CA2 the drill-down rows", () => {
  const out = html(h(AgeingRows, { rows: page().rows, caption: "Open dues, 31 to 60 days, oldest first" }));

  it("is a real table from 768px with a caption, scope on every header, and the flat as the row header", () => {
    expect(out).toContain('<div class="hidden md:block">');
    expect(out).toContain('<caption class="sr-only">Open dues, 31 to 60 days, oldest first</caption>');
    expect(count(out, /<th scope="col"/g)).toBe(4);
    expect(count(out, /<th scope="row"/g)).toBe(2);
    for (const heading of ["Flat", "Bill month", "Days overdue", "Amount due"]) expect(out).toContain(`>${heading}</th>`);
  });

  it("each row has the flat code, the month of the bill, the days overdue and the amount due", () => {
    const first = out.slice(out.indexOf("<tbody>")).split("<tr ")[1];
    const text = words(first);
    for (const part of ["T12-0408", "September 2026", "47", "₹6,468"]) expect(text).toContain(part);
  });

  it("numbers are right-aligned in tabular figures", () => {
    expect(out).toMatch(/<th scope="col" class="py-2 pr-4 text-right font-semibold">Days overdue<\/th>/);
    expect(out).toMatch(/<th scope="col" class="py-2 text-right font-semibold">Amount due<\/th>/);
    expect(out).toMatch(/<td class="tnum py-2 pr-4 text-right">47<\/td>/);
    expect(out).toMatch(/<td class="py-2 text-right"><span class="tnum text-body">₹6,468<\/span><\/td>/);
  });

  it("stacked cards below 768px say the same in sentences", () => {
    const cards = out.slice(out.indexOf('<ul class="flex flex-col md:hidden">'));
    expect(words(cards)).toContain("T12-0408 ₹6,468 Bill of September 2026 47 days overdue");
  });

  it("a bill not yet due says so instead of a number of days", () => {
    const notDue = html(h(AgeingRows, { rows: [row({ daysPastDue: -3 })], caption: "c" }));
    expect(notDue).toMatch(/<td class="tnum py-2 pr-4 text-right">Not yet due<\/td>/);
    expect(words(notDue)).toContain("Not yet due");
  });

  it("carries no name and no phone number: the row type has none", () => {
    expect(Object.keys(row()).sort()).toEqual(["amountDuePaise", "billId", "daysPastDue", "flatCode", "period"]);
    expect(words(out)).not.toMatch(/\d{10}/);
  });
});

describe("CA3 the drill-down section", () => {
  const out = html(h(AgeingDetail, { page: page(), period: "2026-10-01" }));

  it("is a section with an anchor, a heading naming the bucket, the hint that there are no names, and a way to close it", () => {
    expect(out).toContain('id="ageing-detail"');
    expect(words(out)).toContain("Open dues: 31 to 60 days");
    expect(words(out)).toContain("Flat codes only: no names and no phone numbers.");
    expect(out).toMatch(/<a [^>]*min-h-12[^>]*>Close this list<\/a>/);
    expect(out).toContain('href="/staff/reports?period=2026-10"');
  });

  it("offers Load more only when there is a next page: outlined, 48px", () => {
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Load more<\/button>/);
    expect(out).not.toContain("bg-accent");
    expect(html(h(AgeingDetail, { page: page({ nextCursor: null }), period: "2026-10-01" }))).not.toContain("Load more");
  });

  it("an empty bucket says so in words and draws no table", () => {
    const empty = html(h(AgeingDetail, { page: page({ rows: [], nextCursor: null }), period: "2026-10-01" }));
    expect(words(empty)).toContain("No open dues in this age group.");
    expect(empty).not.toContain("<table");
  });
});

describe("CA4 the page with the ageing", () => {
  const report = (drilldown: AgeingPage | null): CommitteeReport => emptyReport({ ageing, drilldown });

  it("shows the ageing block always, and the drill-down only when a bucket is chosen, after the block", () => {
    const without = html(h(ReportView, { report: report(null) }));
    expect(without).toContain("committee-ageing");
    expect(without).not.toContain('id="ageing-detail"');
    const withDrill = html(h(ReportView, { report: report(page()) }));
    expect(withDrill.indexOf("committee-ageing")).toBeLessThan(withDrill.indexOf('id="ageing-detail"'));
    expect(count(withDrill, /<h1/g)).toBe(1);
  });

  it("at most one filled control: none", () => {
    const out = html(h(ReportView, { report: report(page()) }));
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});
