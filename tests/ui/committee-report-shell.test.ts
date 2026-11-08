import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MoneyBlock } from "@/app/(staff)/staff/reports/money-block";
import { PeriodForm, periodHrefOf } from "@/app/(staff)/staff/reports/period-form";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { StaffView } from "@/app/(staff)/staff/staff-view";
import { AGE_BUCKETS } from "@/domain/reports/age";
import type { MoneyLine } from "@/domain/reports/money-line";
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

describe("CR2 the money section", () => {
  const series = emptyReport().series.monthly;
  const out = html(h(MoneyBlock, { money, series, period: "2026-10-01" }));
  const text = words(out);

  it("shows Billed, Collected and Still unpaid in rupees with Indian grouping, and says they add up", () => {
    expect(text).toContain("Billed ₹1,80,52,190");
    expect(text).toContain("Collected Bill amount without late fee, paid so far. Late fees are not in it. ₹1,48,42,714");
    expect(text).toContain("Still unpaid (October bills) Bill amount without late fee, still owed. ₹32,09,476");
    expect(text).toContain("Billed equals Collected plus Still unpaid.");
  });

  it("puts a double rule under the three lines, as a ledger does", () => {
    expect(out).toContain('class="h-[7px] border-y-2 border-ink"');
    expect(out.indexOf("Still unpaid")).toBeLessThan(out.indexOf("h-[7px]"));
    expect(out.indexOf("h-[7px]")).toBeLessThan(out.indexOf("Late fees received"));
  });

  it("says the late fees in three lines, real money apart from a calculation, and the flats in a sentence, in full Indian grouping", () => {
    expect(text).toContain("Late fees received: ₹3,800 (real money).");
    expect(text).toContain("Late fees charged but unpaid: ₹1,900.");
    expect(text).toContain("Late fees building up on unpaid bills, not yet charged: ₹1,23,456 (a calculation, not money received).");
    expect(text).toContain("2,399 flats billed: 1,915 paid in full, 484 with part of the bill amount still unpaid.");
  });

  it("uses tabular figures for every amount, right-aligned, in one definition list", () => {
    expect(count(out, /<dl/g)).toBe(1);
    expect(count(out, /<dd class="text-right"/g)).toBe(3);
    expect(count(out, /class="tnum[^"]*"/g)).toBeGreaterThanOrEqual(5);
  });

  it("shows a fee as paise when it has any, and whole rupees otherwise", () => {
    const odd = html(h(MoneyBlock, { money: { ...money, fees: { ...money.fees, postedPaidPaise: 380_050n } }, series, period: "2026-10-01" }));
    expect(words(odd)).toContain("Late fees received: ₹3,800.50 (real money).");
  });

  it("shows the monthly collection as bars below 768px and as columns from 768px: one set of numbers, one table each, never both at once", () => {
    expect(out).toMatch(/<div class="md:hidden"><figure[\s\S]*?monthly-bars-title/);
    expect(out).toMatch(/<div class="hidden md:block"><figure[\s\S]*?monthly-columns-title/);
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
    const empty = html(h(ReportView, { report: report({ money: null }) }));
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
    expect(words(out)).toContain("Collections, what is owed, complaints and bank matching, month by month.");
  });

  it("does not list it for anyone else", () => {
    const out = html(h(StaffView, { name: "Priya Nair", permissions: ["payments:match", "complaints:manage"] }));
    expect(out).not.toContain("/staff/reports");
  });
});
