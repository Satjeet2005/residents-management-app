import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeBlock, TotalBlock } from "@/app/(staff)/staff/reports/ageing-block";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import type { Ageing } from "@/domain/reports/age";
import { definitionLinesFor } from "@/lib/reports/figures";
import { DUES_PAGE_SUPPORT_WORDS, blockViolations, definitionLines, pageViolations, supportWords, textOf, withoutExpander } from "@/lib/reports/text-budget";
import { emptyReport, richReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const dues = (report = richReport()): string => html(h(SectionPage, { slug: "dues", report }));
const out = dues();
const text = textOf(out);

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
const zero = (b: Ageing["buckets"][number]) => ({ ...b, flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n });
const age = html(h(AgeBlock, { ageing }));
const total = html(h(TotalBlock, { ageing }));

describe("DU1 the header (D214)", () => {
  it("is the h1 'Dues, all months', and the date is said ONCE, in the sentence 'As of <date>'", () => {
    expect(out).toMatch(/<h1[^>]*>Dues, all months<\/h1>/);
    expect(count(text, /27 October 2026/g)).toBe(1);
    expect(text).toContain("As of 27 October 2026");
    expect(text).not.toContain("read only");
  });

  it("has no month control at all and no sentence about the month chosen", () => {
    expect(out).not.toMatch(/<form|<select|id="report-period"|<noscript/);
    expect(text).not.toMatch(/month chosen|does not change this block|All open dues, all months, as of the date above/);
  });
});

describe("DU2 the total", () => {
  it("is 'Total owed' with the figure, ONE line that splits it without saying the total again, and '<n> flats'", () => {
    expect(textOf(total)).toContain("Total owed ₹55,65,000 Unpaid bills ₹55,65,000 + late fees ₹0 520 flats");
    expect(textOf(total).split("Unpaid bills")[1]).not.toMatch(/=/);
    expect(textOf(html(h(TotalBlock, { ageing: { ...ageing, total: { ...ageing.total, flats: 1 } } })))).toContain("1 flat");
  });

  it("nothing owed says so in words and has no list, no link and no table", () => {
    const none: Ageing = { buckets: ageing.buckets.map(zero), total: { flats: 0, bills: 0, unpaidBillsPaise: 0n, lateFeesPaise: 0n, amountDuePaise: 0n } };
    expect(textOf(html(h(TotalBlock, { ageing: none })))).toContain("Nothing is owed.");
    expect(html(h(AgeBlock, { ageing: none }))).toBe("");
  });
});

describe("DU3 the age list: bills on each row, flats only on 'Over 90 days', shares that add to 100", () => {
  const list = age.slice(age.indexOf("<ul"), age.indexOf("</ul>"));

  it("lists the groups in order with their amounts, each row with ONE grey line: its count and its share", () => {
    const labels = ["Not yet due", "1 to 30 days", "31 to 60 days", "61 to 90 days", "Over 90 days"];
    const positions = labels.map((label) => list.indexOf(label));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(textOf(list)).toContain("31 to 60 days ₹25,00,000 310 bills · 45% See the flats");
    expect(textOf(list)).toContain("1 to 30 days ₹15,00,000 200 bills · 27% See the flats");
    expect(count(list, /data-support/g)).toBe(5);
  });

  it("'<n> flats' is on the Over 90 days row ONLY", () => {
    expect(textOf(list)).toContain("Over 90 days ₹5,00,000 50 flats · 9%");
    expect(count(textOf(list), /\d+ flats/g)).toBe(1);
  });

  it("the shares add to exactly 100", () => {
    const shares = [...list.matchAll(/· (\d+)%/g)].map((m) => Number(m[1]));
    expect(shares).toHaveLength(5);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("'Not yet due' is hidden when it is zero, and a group with no bills has no link", () => {
    const sparse: Ageing = { ...ageing, buckets: ageing.buckets.map((b) => (b.bucket === "OVER_90" || b.bucket === "NOT_YET_DUE" ? zero(b) : b)) };
    const sparseOut = html(h(AgeBlock, { ageing: sparse }));
    expect(textOf(sparseOut)).not.toContain("Not yet due");
    expect(count(sparseOut, />See the flats<\/a>/g)).toBe(3);
  });

  it("each bar is a share of the TOTAL, drawn by a div, and each link is a 48px target named by its group", () => {
    expect(age).not.toContain("<svg");
    expect(age).toContain("width:44.9%");
    expect(age).toContain('aria-label="See the flats: 31 to 60 days"');
    expect(age).toContain('href="/staff/reports/dues/flats?bucket=31-60"');
    for (const link of age.match(/<a [^>]*>/g) ?? []) expect(link).toContain("min-h-12");
  });

  it("has no footnote about a flat in every group and no October reconciliation sentence on the visible page", () => {
    expect(text).not.toMatch(/A flat appears in every age group where it has a bill\.[^,]/);
    expect(textOf(withoutExpander(out))).not.toMatch(/A flat appears|unpaid bills are ₹|Billed and collected/);
  });
});

describe("DU4 the table behind the list: a real table, four columns on a phone, Total equals Total owed", () => {
  const table = age.slice(age.indexOf("<table"), age.indexOf("</table>"));

  it("has the columns Age, Bills, Flats, Unpaid bills, Late fees, Total and a totals row", () => {
    expect([...table.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(["Age", "Bills", "Flats", "Unpaid bills", "Late fees", "Total"]);
    expect(textOf(table)).toContain("Total owed 700 520 ₹55,65,000 ₹0 ₹55,65,000");
    expect(textOf(table.slice(table.indexOf("<tbody>")).split("Total owed")[0])).toContain("1 to 30 days");
  });

  it("shows at most four columns below 768px: Flats and Total are hidden until md", () => {
    const heads = [...table.matchAll(/<th scope="col" class="([^"]*)">([^<]*)<\/th>/g)];
    const phone = heads.filter((m) => !m[1].includes("hidden md:table-cell")).map((m) => m[2]);
    expect(phone).toEqual(["Age", "Bills", "Unpaid bills", "Late fees"]);
    expect(phone.length).toBeLessThanOrEqual(4);
  });

  it("is a table at every width: no stacked blocks", () => {
    expect(age).not.toMatch(/md:hidden|<li class="[^"]*border-b border-hairline py-2/);
    expect(count(age, /<table/g)).toBe(1);
  });

  it("its Total column adds up to Total owed", () => {
    const rows = [...table.matchAll(/<td class="[^"]*">₹([\d,]+)<\/td><\/tr>/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const [last] = rows.slice(-1);
    expect(rows.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(last);
    expect(last).toBe(5_565_000);
  });
});

describe("DU5 late fees: three rows, exactly these labels", () => {
  const fees = out.slice(out.indexOf('<section data-block="" aria-labelledby="committee-fees"'), out.indexOf('<section data-block="" data-figure="towers"'));

  it("has the heading 'Late fees' and the labels Received, Charged, not yet paid and Building up, not yet charged, with an amount each", () => {
    expect(textOf(fees)).toBe("Late fees Received ₹3,800 Charged, not yet paid ₹1,900 Building up, not yet charged ₹1,23,456");
  });
});

describe("DU6 towers: a table of the top five directly after the heading", () => {
  it("is the heading, then the table, at most five rows, no paragraph, no inline list of all towers", () => {
    expect(out).toMatch(/<h2 id="committee-towers"[^>]*>Towers with the most unpaid<\/h2><div class="min-w-0"><table/);
    const towers = out.slice(out.indexOf('aria-labelledby="committee-towers"'));
    expect(count(towers.slice(towers.indexOf("<tbody>")), /<tr /g)).toBe(5);
    expect(towers).not.toMatch(/See all|numbers behind/);
  });
});

describe("DU7 the one expander, and the text budget of the page", () => {
  const lines = definitionLines(out);

  it("has ONE expander with these lines, in this order, and nothing else on the page explains a term", () => {
    expect(lines.map((l) => l.id)).toEqual(["owedTotal", "ageMeaning", "ageGroups", "ageReconcile", "duesReceived", "duesCharged", "duesBuilding", "towers"]);
    expect(lines[0].text).toBe("Total owed: the unpaid bills of every month, plus late fees charged or building up. A month does not change this page.");
    expect(lines[1].text).toBe("Age: how many days past the due date a bill is.");
    expect(lines[3].text).toBe("The 1 to 30 days row holds October's unpaid bills (the Still unpaid figure on the Collections page) plus their late fees.");
    expect(lines.map((l) => l.id)).toEqual(definitionLinesFor("dues", richReport()).map((l) => l.id));
  });

  it("is within the budget: at most 12 supporting words, at most one grey line per row, every block within its limits", () => {
    expect(pageViolations(out, DUES_PAGE_SUPPORT_WORDS)).toEqual([]);
    expect(supportWords(out)).toBeLessThanOrEqual(12);
  });

  it("the OLD page (about 90 supporting words: scope sentence, equation, footnote, reconciliation sentence, fee parentheses, towers paragraph) would FAIL the budget", () => {
    const sentences = [
      "All open dues, all months, as of the date above. The month chosen does not change this block.",
      "₹55,65,000 = unpaid bills ₹55,65,000 + late fees ₹0",
      "520 different flats in total",
      "October's unpaid bills are ₹15,00,000 (Billed and collected). The 1 to 30 days group also holds late fees of ₹30,751.",
      "A flat appears in every age group where it has a bill.",
      "Late fees building up on unpaid bills, not yet charged: ₹1,23,456 (a calculation, not money received).",
      "What the flats of each tower owe, unpaid bills and late fees together. Tower names and counts only: no flat codes and no names.",
    ];
    const old = `<section data-block="">${sentences.map((x) => `<p data-support="">${x}</p>`).join("")}</section>`;
    expect(supportWords(old)).toBeGreaterThan(60);
    expect(pageViolations(old, DUES_PAGE_SUPPORT_WORDS).join("|")).toMatch(/supporting words on the page/);
    expect(blockViolations(old).join("|")).toMatch(/supporting words/);
  });
});

describe("DU8 mutations are caught by name", () => {
  it("the reconciliation sentence put back, the date repeated in a second sentence, a month selector shown, a five-column phone table", () => {
    const sentence = "October's unpaid bills are ₹15,00,000 (Billed and collected). The 1 to 30 days group also holds late fees of ₹30,751.";
    expect(pageViolations(out.replace("</main>", `<p data-support="">${sentence}</p></main>`), DUES_PAGE_SUPPORT_WORDS).join("|")).toMatch(/supporting words on the page/);
    expect(count(textOf(out.replace("</main>", "<p>As of 27 October 2026, all months</p></main>")), /27 October 2026/g)).toBe(2);
    expect(/<form|<select/.test(out.replace("</main>", '<form><select id="report-period"></select></form></main>'))).toBe(true);
    const five = age.replace(/<th scope="col" class="([^"]*hidden md:table-cell)"/, '<th scope="col" class="py-2"');
    const phone = [...five.matchAll(/<th scope="col" class="([^"]*)">/g)].filter((m) => !m[1].includes("hidden md:table-cell"));
    expect(phone.length).toBeGreaterThan(4);
  });

  it("an empty month does not change the Dues page: its figures come from all months", () => {
    expect(dues(richReport({ money: null }))).toContain("Late fees");
    expect(textOf(dues(emptyReport()))).toContain("Nothing is owed.");
  });
});
