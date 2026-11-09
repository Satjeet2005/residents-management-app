import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LateFeeFigures } from "@/app/(staff)/staff/reports/late-fee-figures";
import { MoneyBlock } from "@/app/(staff)/staff/reports/money-block";
import { MonthlyBlock, monthlyTakeaway } from "@/app/(staff)/staff/reports/monthly-block";
import { PeriodForm, periodHrefOf } from "@/app/(staff)/staff/reports/period-form";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import { AGE_BUCKETS } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
import type { MonthlyPoint } from "@/domain/reports/series";
import { dateWords, periodLabel } from "@/lib/reports/period";
import { emptyReport } from "./committee-fixtures";
import type { CommitteeReport } from "@/server/reports/report-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const money: MoneyLine = {
  billedPaise: 1_805_219_000n,
  collectedPaise: 1_484_271_400n,
  outstandingPaise: 320_947_600n,
  flatsBilled: 2399,
  flatsPaidInFull: 1915,
  flatsOutstanding: 484,
  fees: { postedPaidPaise: 380_000n, postedOwingPaise: 190_000n, accruingPaise: 12_345_600n },
};
const report = (over: Partial<CommitteeReport> = {}): CommitteeReport =>
  emptyReport({
    periods: ["2026-10-01", "2026-09-01", "2026-08-01"],
    money,
    ageing: { buckets: AGE_BUCKETS.map((bucket) => ({ bucket, flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n })), total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } },
    ...over,
  });

describe("CR1 the period selector", () => {
  const out = html(h(PeriodForm, { period: "2026-10-01", periods: ["2026-10-01", "2026-09-01", "2026-08-01"] }));

  it("is a plain GET form with a labelled select, 48px; the outlined Show button is only inside <noscript>, so a month applies when chosen", () => {
    const form = /<form[^>]*>/.exec(out)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/staff/reports"');
    expect(out).toContain('for="report-period"');
    const select = /<select[^>]*>/.exec(out)?.[0] ?? "";
    expect(select).toContain('id="report-period"');
    expect(select).toContain('name="period"');
    expect(select).toContain("min-h-12");
    expect(out).toMatch(/<noscript><button[^>]*type="submit"[^>]*min-h-12[^>]*>Show<\/button><\/noscript>/);
    expect(out.replace(/<noscript>.*<\/noscript>/, "")).not.toContain("type=\"submit\"");
    expect(out).not.toContain("bg-accent");
  });

  it("the month is the address the page reads", () => {
    expect(periodHrefOf("2026-09")).toBe("/staff/reports?period=2026-09");
  });

  it("offers the months with bills, newest first, the shown month chosen", () => {
    expect(words(out)).toContain("October 2026 September 2026 August 2026");
    expect(out).toMatch(/<option value="2026-10" selected="">October 2026<\/option>/);
    expect(out).toContain('value="2026-09"');
  });

  it("adds a month typed into the address that has no bills, so the select shows what the page shows", () => {
    const typed = html(h(PeriodForm, { period: "2026-03-01", periods: ["2026-10-01"] }));
    expect(words(typed)).toContain("October 2026 March 2026");
    expect(typed).toMatch(/<option value="2026-03" selected="">March 2026<\/option>/);
  });
});

describe("CR2 the Billed and collected ledger", () => {
  const out = html(h(MoneyBlock, { money }));
  const text = words(out);

  it("is Collected plus Still unpaid equals Billed, in rupees with Indian grouping, the operators visible and also written for a screen reader", () => {
    expect(text).toMatch(/Collected ₹1,48,42,714 \+ plus Still unpaid ₹32,09,476 = equals Billed ₹1,80,52,190/);
    expect(out).toContain('<span aria-hidden="true" class="mr-2 inline-block w-4">+</span><span class="sr-only">plus </span>');
    expect(out).toContain('<span aria-hidden="true" class="mr-2 inline-block w-4">=</span><span class="sr-only">equals </span>');
    expect(1_484_271_400n + 320_947_600n).toBe(money.billedPaise);
  });

  it("puts a double rule under Still unpaid and above Billed, as a ledger does", () => {
    expect(out.indexOf("Still unpaid")).toBeLessThan(out.indexOf("h-[7px]"));
    expect(out.indexOf("h-[7px]")).toBeLessThan(out.indexOf("Billed</dt>"));
  });

  it("has ONE bar, then the share collected in words, then exactly two facts", () => {
    expect(count(out, /role="img"/g)).toBe(1);
    expect(out).not.toContain('data-part="tick"');
    expect(text).toContain("82% collected");
    expect(text).toContain("Late fees received: ₹3,800 (real money).");
    expect(text).toContain("1,915 of 2,399 flats have paid in full");
    expect(count(out.slice(out.indexOf("</dl>")), /<li>/g)).toBe(2 + 3);
  });

  it("has no grey definition under a figure, no equation in words, no principal, and the other two late-fee figures are not here", () => {
    expect(text).not.toMatch(/Bill amount without late fee|equals Collected plus|principal|Late fees charged but unpaid|building up/i);
  });

  it("keeps the definitions behind one expander with exactly three lines", () => {
    const details = /<details>[\s\S]*?<\/details>/.exec(out)?.[0] ?? "";
    expect(words(details)).toContain("What do these mean?");
    expect(count(details, /<li>/g)).toBe(3);
    expect(words(details)).toContain("Billed: the maintenance bills raised for the month.");
  });

  it("its static explanatory text, outside the expander, the headings and the row labels, is at most 30 words (the text budget)", () => {
    const bare = out.replace(/<details>[\s\S]*?<\/details>/g, "").replace(/<h2[\s\S]*?<\/h2>/g, "").replace(/<dt[\s\S]*?<\/dt>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
    const explanatory = words(bare).split(" ").filter((w) => w !== "" && !/[0-9₹%]/.test(w));
    expect(explanatory.length).toBeLessThanOrEqual(30);
  });

  it("shows a fee as paise when it has any, and whole rupees otherwise", () => {
    const odd = html(h(MoneyBlock, { money: { ...money, fees: { ...money.fees, postedPaidPaise: 380_050n } } }));
    expect(words(odd)).toContain("Late fees received: ₹3,800.50 (real money).");
  });
});

describe("CR2b the Dues page's late-fee figures and the monthly block", () => {
  it("the three late-fee figures say real money apart from a calculation", () => {
    const text = words(html(h(LateFeeFigures, { money })));
    expect(text).toContain("Late fees received: ₹3,800 (real money).");
    expect(text).toContain("Late fees charged but unpaid: ₹1,900.");
    expect(text).toContain("Late fees building up on unpaid bills, not yet charged: ₹1,23,456 (a calculation, not money received).");
    expect(html(h(LateFeeFigures, { money: null }))).toBe("");
  });

  it("the monthly collection is bars below 768px and columns from 768px, one set of numbers, never both at once, with one takeaway of at most 20 words", () => {
    const series = emptyReport().series.monthly;
    const out = html(h(MonthlyBlock, { series }));
    expect(out).toMatch(/<div class="md:hidden"><figure[\s\S]*?monthly-bars-title/);
    expect(out).toMatch(/<div class="hidden md:block"><figure[\s\S]*?monthly-columns-title/);
    expect(words(out)).toContain("Collected within 20 days, by month");
  });

  it("the takeaway names the month at day 20 and the one before, and says 'so far' for a young month", () => {
    const point = (period: string, byDay20Percent: number, inProgress: boolean): MonthlyPoint => ({ period, hasBills: true, billedPaise: 100n, collectedPaise: 80n, outstandingPaise: 20n, collectedPercent: 80, byDay20Percent, byDay20Paise: 80n, inProgress });
    expect(monthlyTakeaway([point("2026-09-01", 93, false), point("2026-10-01", 83, false)])).toBe("October is 83% at day 20; September was 93%.");
    expect(monthlyTakeaway([point("2026-09-01", 93, false), point("2026-10-01", 79, true)])).toBe("October is 79% so far; September was 93%.");
    expect(monthlyTakeaway([point("2026-10-01", 79, false)])).toBeNull();
    expect((monthlyTakeaway([point("2026-09-01", 93, false), point("2026-10-01", 83, false)]) ?? "").split(" ").length).toBeLessThanOrEqual(20);
  });
});

describe("CR3 the page", () => {
  const out = html(h(ReportView, { report: report() }));

  it("has one main landmark, one h1, the as-of date in words and the selector", () => {
    expect(count(out, /<main/g)).toBe(1);
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toMatch(/<h1[^>]*>Committee report<\/h1>/);
    expect(words(out)).toContain("As of 27 October 2026 · read only");
    expect(out).toContain('id="report-period"');
  });

  it("has no filled control and no uppercase", () => {
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
    expect(out).not.toMatch(/uppercase|tracking-/);
  });

  it("a month with no bills says so in words and draws no money line", () => {
    const empty = html(h(SectionPage, { slug: "collections", report: report({ money: null }) }));
    expect(words(empty)).toContain("No bills for this month");
    expect(words(empty)).toContain("Choose another month above.");
    expect(empty).not.toContain("Collected Principal paid");
    expect(empty).not.toContain("Late fees:");
  });

  it("names the period and the date in words", () => {
    expect(periodLabel("2026-10-01")).toBe("October 2026");
    expect(dateWords("2026-10-07")).toBe("7 October 2026");
  });
});

describe("CR4 the staff landing tool", () => {
  it("lists the Committee report for reports:view", () => {
    const out = html(h(StaffView, { name: "Meera Kapoor", permissions: ["reports:view"] }));
    expect(out).toMatch(/<a [^>]*href="\/staff\/reports"[^>]*>Open the report<\/a>/);
    expect(words(out)).toContain("Committee report");
  });

  it("does not list it for anyone else", () => {
    const out = html(h(StaffView, { name: "Priya Nair", permissions: ["payments:match", "complaints:manage"] }));
    expect(out).not.toContain("/staff/reports");
  });
});
