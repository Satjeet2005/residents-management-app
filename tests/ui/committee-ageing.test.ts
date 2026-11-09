import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeingRows } from "@/app/(staff)/staff/reports/ageing-rows";
import { FlatsView } from "@/app/(staff)/staff/reports/flats-view";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import type { Ageing } from "@/domain/reports/age";
import { flatsHref, legacyFlatsTarget } from "@/lib/reports/ageing";
import { PAGE_SUPPORT_WORDS, blockViolations, supportWords, textOf } from "@/lib/reports/text-budget";
import type { AgeingPage, AgeingRowView } from "@/server/reports/ageing-page";
import { emptyReport, richReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
// The server action is only called on a click; rendering needs the module to exist.
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const words = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

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
const view = (over: Partial<AgeingPage> = {}, sort: "LARGEST" | "OLDEST" = "LARGEST") => html(h(FlatsView, { page: page(over), bucket: "DAYS_31_60", sort, asOf: "2026-10-27" }));

describe("CA2 the rows of the flats page: ONE line each, per FLAT (D217)", () => {
  const out = html(h(AgeingRows, { rows: page().rows }));

  it("is a list at every width, one line per flat: the flat code, the days overdue of its oldest bill, and the total owed in the group at the right", () => {
    expect(count(out, /<li /g)).toBe(2);
    expect(count(out, /<table/g)).toBe(0);
    expect(words(out)).toContain("T12-0408 47 days ₹6,468");
    expect(words(out)).toContain("T07-1203 40 days ₹10,660");
  });

  it("each row is a single line: no second line for the bills, and a height of 48px at least and no more than 56px by its classes", () => {
    for (const li of out.match(/<li [^>]*>/g) ?? []) {
      expect(li).toContain("min-h-12");
      expect(li).toContain("items-center");
      expect(li).not.toMatch(/flex-col|min-h-1[4-9]/);
    }
    expect(words(out)).not.toMatch(/bills|overdue/);
    expect(words(out)).not.toMatch(/(^|\s)bill\b/);
  });

  it("the days are 14px secondary ink and the amount is bold in tabular figures", () => {
    expect(out).toContain('<span class="tnum text-caption text-ink-2">47 days</span>');
    expect(out).toMatch(/<span class="tnum text-body font-semibold">₹6,468<\/span>/);
  });

  it("a flat not yet due says so instead of a number of days", () => {
    expect(words(html(h(AgeingRows, { rows: [row({ oldestDaysPastDue: -3 })] })))).toContain("T12-0408 Not yet due");
  });

  it("carries no name and no phone number: the row type has none", () => {
    expect(Object.keys(row()).sort()).toEqual(["amountDuePaise", "bills", "flatCode", "oldestDaysPastDue"]);
    expect(words(out)).not.toMatch(/\d{10}/);
  });
});

describe("CA3 the flats page", () => {
  const out = view();

  it("has the back link 'Dues' with an arrow and the name 'Back to dues' at the TOP only, and no 'Close this list' or 'Back to age groups'", () => {
    const back = /<a [^>]*href="\/staff\/reports\/dues"[^>]*>[\s\S]*?<\/a>/.exec(out)?.[0] ?? "";
    expect(back).toContain('aria-label="Back to dues"');
    expect(back).toContain("min-h-12");
    expect(back).toContain("<svg");
    expect(back).toMatch(/Dues<\/a>$/);
    expect(count(out, /Back to dues/g)).toBe(1);
    expect(words(out)).not.toMatch(/Close this list|Back to age groups/);
    expect(out.indexOf("Back to dues")).toBeLessThan(out.indexOf("<h1"));
  });

  it("has the h1 '<n> flats owe <amount>' (which takes the focus), ONE line '<age group> · as of <date>' and ONE line 'Flat codes only.'", () => {
    expect(out).toMatch(/<h1[^>]*tabindex="-1"[^>]*>120 flats owe ₹25.0 lakh<\/h1>/);
    expect(words(out)).toContain("31 to 60 days · as of 27 October 2026");
    expect(words(out)).toContain("Flat codes only.");
    expect(words(view({ flats: 1 }))).toContain("1 flat owes ₹25.0 lakh");
    expect(words(out)).not.toMatch(/no names and no phone numbers/);
  });

  it("offers Largest first and Oldest first as two equal 48px links: the chosen one current with a 2px ink border and the tint, the other a 1px hairline, the same weight, no underline", () => {
    const nav = out.slice(out.indexOf("<nav"), out.indexOf("</nav>"));
    const links = nav.match(/<a [^>]*>[^<]*<\/a>/g) ?? [];
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('aria-current="true"');
    expect(links[0]).toMatch(/border-2 border-ink bg-paper-2/);
    expect(links[1]).not.toContain("aria-current");
    expect(links[1]).toContain("border-hairline");
    for (const link of links) {
      expect(link).toContain("min-h-12");
      expect(link).not.toMatch(/(?<!no-)underline|font-semibold|text-accent/);
      expect(link).toContain("no-underline");
    }
    expect(nav).toContain('class="grid grid-cols-2 gap-2"');
    expect(nav).toContain('href="/staff/reports/dues/flats?bucket=31-60"');
    expect(nav).toContain('href="/staff/reports/dues/flats?bucket=31-60&amp;sort=oldest"');
    expect(view({}, "OLDEST")).toMatch(/aria-current="true"[^>]*>Oldest first/);
  });

  it("says how many are shown of how many, and offers Show 25 more only when there is a next page: outlined, 48px", () => {
    expect(words(out)).toContain("Showing 2 of 120");
    expect(out).toMatch(/<button[^>]*min-h-12[^>]*>Show 25 more<\/button>/);
    expect(out).not.toContain("bg-accent");
    expect(view({ nextCursor: null, flats: 2 })).not.toContain("Show 25 more");
  });

  it("an empty group says so in words and draws no list", () => {
    const empty = view({ flats: 0, rows: [], nextCursor: null, amountDuePaise: "0" });
    expect(words(empty)).toContain("No flat owes anything in this age group.");
    expect(empty).not.toContain("<li ");
  });

  it("is within the text budget: its two header lines are the supporting text and nothing else is", () => {
    expect(supportWords(out)).toBe(8);
    expect(supportWords(out)).toBeLessThanOrEqual(PAGE_SUPPORT_WORDS);
    expect(count(out, /<h1/g)).toBe(1);
    expect(blockViolations(out)).toEqual([]);
  });

  it("names no flat's owner and no phone number, and nothing is filled", () => {
    expect(textOf(out)).not.toMatch(/\d{10}/);
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});

describe("CA4 the addresses of the flats page and the redirect of the old inline ones", () => {
  it("the flats page of a group in an order", () => {
    expect(flatsHref("DAYS_31_60")).toBe("/staff/reports/dues/flats?bucket=31-60");
    expect(flatsHref("OVER_90", "OLDEST")).toBe("/staff/reports/dues/flats?bucket=over-90&sort=oldest");
  });

  it("an old address with ?bucket= goes to the flats page of the same group and order; hostile values go nowhere", () => {
    expect(legacyFlatsTarget({ bucket: "over-90", sort: "oldest", period: "2026-10" })).toBe("/staff/reports/dues/flats?bucket=over-90&sort=oldest");
    expect(legacyFlatsTarget({ bucket: "31-60" })).toBe("/staff/reports/dues/flats?bucket=31-60");
    expect(legacyFlatsTarget({ bucket: "61-90", sort: "newest" })).toBe("/staff/reports/dues/flats?bucket=61-90");
    for (const bucket of [undefined, "", "all", "<script>", "31-60,61-90", "NOT_YET_DUE"]) expect(legacyFlatsTarget({ bucket }), String(bucket)).toBeNull();
    expect(legacyFlatsTarget({})).toBeNull();
  });
});

describe("CA5 the Dues page has no inline list of flats", () => {
  const ageing: Ageing = richReport().ageing;

  it("renders the age list, the late fees and at most five towers, and never the flats of a group", () => {
    const out = html(h(SectionPage, { slug: "dues", report: richReport() }));
    expect(out).not.toMatch(/id="ageing-detail"|T\d\d-\d{4}|Show 25 more|Showing \d+ of|Close this list|Back to age groups/);
    expect(count(out, /href="\/staff\/reports\/dues\/flats\?bucket=/g)).toBe(ageing.buckets.filter((b) => b.bills > 0).length);
    expect(count(out, /href="[^"]*#ageing-detail"/g)).toBe(0);
  });

  it("at most one filled control: none", () => {
    const out = html(h(SectionPage, { slug: "dues", report: emptyReport({ ageing }) }));
    for (const control of out.match(/<(button|a) [^>]*>/g) ?? []) expect(control).not.toContain("bg-accent");
  });
});
