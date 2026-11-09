import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Definitions } from "@/components/committee/definitions";
import { Support } from "@/components/committee/support";
import { ReportView } from "@/app/(staff)/staff/reports/report-view";
import { SectionPage } from "@/app/(staff)/staff/reports/section-page";
import { FIGURE_DEFINITIONS, PAGE_FIGURES, type PageId, definitionLinesFor } from "@/lib/reports/figures";
import { SECTIONS } from "@/lib/reports/sections";
import { COMPLAINTS_PAGE_SUPPORT_WORDS, DUES_PAGE_SUPPORT_WORDS, DEFINITION_LINES, DEFINITION_WORDS, PAGE_SUPPORT_WORDS, blockViolations, blocksOf, definitionExpanders, definitionLines, elementsWith, figureIds, figureRows, pageViolations, supportWords, takeaways, textOf, withoutExpander, wordCount } from "@/lib/reports/text-budget";
import { emptyReport, richReport } from "./committee-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }), usePathname: () => "/", redirect: () => {} }));
vi.mock("@/app/(staff)/staff/reports/actions", () => ({ loadMoreAgeing: async () => ({ ok: true, data: null }) }));

const html = renderToStaticMarkup;
const PAGES: PageId[] = ["overview", ...SECTIONS.map((s) => s.slug)];
const render = (page: PageId, report = richReport()): string => html(page === "overview" ? h(ReportView, { report }) : h(SectionPage, { slug: page, report }));
const limitOf = (page: PageId): number => (page === "complaints" ? COMPLAINTS_PAGE_SUPPORT_WORDS : page === "dues" ? DUES_PAGE_SUPPORT_WORDS : PAGE_SUPPORT_WORDS);

describe("TB1 the counting rule (D206, text budget v2)", () => {
  it("a word is a piece of text with a letter: numbers and symbols alone are not words", () => {
    expect(wordCount("1,687 of 2,399 bills · 70% ₹5")).toBe(2);
    expect(wordCount("")).toBe(0);
  });

  it("counts only the text inside data-support, and leaves out the expander, the goal lines and the ledger", () => {
    const page = [
      "<h1>Heading words are not counted</h1>",
      '<dt>Label words are not counted</dt>',
      '<p data-support="">one two three</p>',
      '<p data-support="">four <span data-goal="">goal words left out</span></p>',
      '<dl data-ledger=""><div data-ledger-line=""><dt data-support="">ledger words left out</dt></div></dl>',
      '<details data-definitions=""><summary>What do these mean?</summary><ul><li data-support="">expander words left out</li></ul></details>',
      "<p>plain text is not supporting text</p>",
    ].join("");
    expect(supportWords(page)).toBe(4);
  });

  it("finds the matching end of nested elements of the same name", () => {
    const nested = '<div data-support=""><div>inner words here</div> after</div><div>outside words</div>';
    expect(supportWords(nested)).toBe(4);
  });

  it("<Support> marks its text, and a takeaway is marked as one", () => {
    const out = html(h("div", null, h(Support, { takeaway: true, children: "Steady: 83 to 93% in every month." }), h(Support, { as: "span", children: "of bills" })));
    expect(supportWords(out)).toBe(7);
    expect(takeaways(out)).toEqual(["Steady: 83 to 93% in every month."]);
  });
});

describe("TB2 every page is within the budget, rendered from a report that shows every figure", () => {
  for (const page of PAGES) {
    it(`${page}: no violation of any block or of the page`, () => {
      expect(pageViolations(render(page), limitOf(page))).toEqual([]);
    });

    it(`${page}: the supporting words are measured, at most ${page === "complaints" ? 15 : page === "dues" ? 12 : 40} on the page and at most 12 in a block`, () => {
      const out = render(page);
      expect(supportWords(out)).toBeLessThanOrEqual(limitOf(page));
      for (const block of blocksOf(out)) expect(supportWords(block)).toBeLessThanOrEqual(12);
    });

    it(`${page}: exactly one expander of definitions, closed, with a 48px summary`, () => {
      const out = render(page);
      expect(definitionExpanders(out)).toBe(1);
      const details = /<details[^>]*data-definitions[^>]*>/.exec(out)?.[0] ?? "";
      expect(details).not.toContain(" open");
      expect(/<details[^>]*data-definitions[\s\S]*?<summary[^>]*>/.exec(out)?.[0] ?? "").toContain("min-h-12");
    });
  }

  it("the Collections page carries the one takeaway of the monthly block, and it is the computed sentence", () => {
    expect(takeaways(render("collections"))).toEqual(["October is 10 points lower than September (83% vs 93%)."]);
  });

  it("the Dues page has at most 12 supporting words, the Complaints page at most 15 and the others at most 40", () => {
    expect(DUES_PAGE_SUPPORT_WORDS).toBe(12);
    expect(COMPLAINTS_PAGE_SUPPORT_WORDS).toBe(15);
    expect(PAGE_SUPPORT_WORDS).toBe(40);
  });
});

describe("TB3 the figure-definition registry, page by page (D207)", () => {
  for (const page of PAGES) {
    const out = render(page);
    const lines = definitionLines(out);

    it(`${page}: every figure the page shows has its definition line inside THAT page's expander`, () => {
      const defined = new Set(lines.map((l) => l.id));
      for (const id of figureIds(out)) expect(defined.has(id), `${page}: ${id}`).toBe(true);
    });

    it(`${page}: the expander lists only ids the page declares in the registry, at most 9 lines of at most 25 words, in the registry's text`, () => {
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(DEFINITION_LINES);
      for (const line of lines) {
        expect(PAGE_FIGURES[page], `${page}: ${line.id}`).toContain(line.id);
        expect(wordCount(line.text), line.id).toBeLessThanOrEqual(DEFINITION_WORDS);
        expect(line.text, line.id).toBe(textOf(definitionLinesFor(page, richReport()).find((d) => d.id === line.id)?.text ?? ""));
      }
      for (const id of figureIds(out)) expect(PAGE_FIGURES[page], `${page}: ${id}`).toContain(id);
    });

    it(`${page}: no definition text is written outside the expander`, () => {
      const outside = textOf(withoutExpander(out));
      for (const line of lines) expect(outside.includes(line.text), `${page}: ${line.id}`).toBe(false);
    });
  }

  it("every figure id of the registry is declared by at least one page, and every page id has a definition", () => {
    const declared = new Set(PAGES.flatMap((p) => PAGE_FIGURES[p]));
    for (const id of Object.keys(FIGURE_DEFINITIONS)) expect(declared.has(id as keyof typeof FIGURE_DEFINITIONS), id).toBe(true);
  });

  it("a page that shows no figure draws no expander (an empty month, no complaints); the Bank page always keeps the line that says what the 30 days are, so a keyboard has a first stop", () => {
    for (const slug of ["collections", "complaints"] as const) expect(definitionExpanders(render(slug, emptyReport()))).toBe(0);
    expect(definitionLines(render("bank", emptyReport())).map((l) => l.id)).toEqual(["bankWindow"]);
    expect(html(h(Definitions, { lines: [] }))).toBe("");
  });

  it("the targets line is in the expander of the overview only when the committee has not set its own goals", () => {
    const standard = definitionLines(render("overview", richReport())).map((l) => l.id);
    const own = definitionLines(render("overview", richReport({ goals: { ...richReport().goals, source: "SETTING" } }))).map((l) => l.id);
    expect(standard).toContain("goalsDefault");
    expect(own).not.toContain("goalsDefault");
  });

  it("the 'of bills that were paid' figure is shown in the expander only, computed (88% of 1,915)", () => {
    const text = definitionLines(render("collections")).find((l) => l.id === "paidOfPaid")?.text ?? "";
    expect(text).toBe("Of bills that were paid, 88% were paid on time (1,687 of 1,915). This ignores the 484 bills not yet paid.");
    expect(textOf(withoutExpander(render("collections")))).not.toContain("88%");
  });

  it("'Closed automatically' reads its number of days from the report, never from the text", () => {
    const text = (n: number) => definitionLines(render("complaints", richReport({ autoCloseDays: n }))).find((l) => l.id === "closedAuto")?.text ?? "";
    expect(text(7)).toContain("within 7 days");
    expect(text(12)).toContain("within 12 days");
  });
});

describe("TB4 the budget would have failed on the old pages (fixtures that reproduce them)", () => {
  const supportOf = (text: string) => `<p data-support="">${text}</p>`;
  const OLD_HOW_FAST_BLOCK = `<section data-block=""><h2>How fast bills are paid</h2>${[
    "1,687 of 2,399 bills due so far were paid on or before their due date",
    "1,687 of 1,915 paid bills were paid on or before their due date. This ignores the 484 unpaid bills.",
    "Counted from the day the bill was issued, over 1,915 paid bills",
    "Share of October's money collected: by the due date 70%, by day 20 70%, today 70% (by rupees, so it differs slightly from the bills figure).",
  ].map(supportOf).join("")}</section>`;
  const OLD_ABOUT = `<section><h2>About these numbers</h2><details data-definitions=""><summary>What each figure means</summary><ul>${Array.from({ length: 12 }, (_, i) => `<li data-def-for="x${i}">${"word ".repeat(50)}</li>`).join("")}</ul></details></section>`;

  it("the old 'How fast bills are paid' block (about 62 words) violates the 12-word block limit", () => {
    expect(supportWords(OLD_HOW_FAST_BLOCK)).toBeGreaterThan(50);
    expect(blockViolations(OLD_HOW_FAST_BLOCK).join("|")).toMatch(/supporting words/);
  });

  it("an old Complaints page of about 105 supporting words violates the 15-word page limit", () => {
    const page = Array.from({ length: 7 }, () => supportOf("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen")).join("");
    expect(supportWords(page)).toBe(105);
    expect(pageViolations(page, COMPLAINTS_PAGE_SUPPORT_WORDS).join("|")).toMatch(/105 supporting words on the page/);
  });

  it("the old About block (twelve lines of fifty words) violates the expander limits", () => {
    const found = pageViolations(OLD_ABOUT, PAGE_SUPPORT_WORDS).join("|");
    expect(found).toMatch(/12 definition lines/);
    expect(found).toMatch(/has 50 words/);
  });
});

describe("TB5 mutations of a good page are caught by name", () => {
  const collections = render("collections");

  it("a 20-word sentence added to a block", () => {
    const mutated = collections.replace('<section data-block="" aria-labelledby="committee-ledger" class="flex flex-col gap-3">', `$&<p data-support="">${"word ".repeat(20)}</p>`);
    expect(pageViolations(mutated, PAGE_SUPPORT_WORDS).join("|")).toMatch(/supporting words/);
  });

  it("a heading repeated inside its block", () => {
    const mutated = collections.replace("</section>", "<p>Billed and collected</p></section>");
    expect(pageViolations(mutated, PAGE_SUPPORT_WORDS).join("|")).toMatch(/is repeated inside its block/);
  });

  it("the 88% figure shown outside the expander is caught by the registry test's rule (text outside)", () => {
    const line = definitionLines(collections).find((l) => l.id === "paidOfPaid")?.text ?? "";
    const mutated = collections.replace("</main>", `<p>${line}</p></main>`);
    expect(pageViolations(mutated, PAGE_SUPPORT_WORDS).join("|")).toMatch(/definition "paidOfPaid" is also written outside the expander/);
  });

  it("a figure rendered without a definition line in its page's expander", () => {
    const mutated = collections.replace("</main>", '<div data-figure="mystery"></div></main>');
    expect(pageViolations(mutated, PAGE_SUPPORT_WORDS).join("|")).toMatch(/figure "mystery" has no definition line/);
  });

  it("a definition sentence placed outside the expander, and an expander with a 40-word line", () => {
    const first = definitionLines(collections)[0];
    expect(pageViolations(collections.replace("</main>", `<p>${first.text}</p></main>`), PAGE_SUPPORT_WORDS).join("|")).toMatch(/also written outside the expander/);
    const long = collections.replace(first.text, "word ".repeat(40).trim());
    expect(pageViolations(long, PAGE_SUPPORT_WORDS).join("|")).toMatch(/has 40 words/);
  });

  it("two expanders on a page, and more than three figure rows in a block", () => {
    expect(pageViolations(collections.replace("</main>", '<details data-definitions=""><summary>x</summary></details></main>'), PAGE_SUPPORT_WORDS).join("|")).toMatch(/2 expanders/);
    const four = `<section data-block="">${'<div data-figure="a"></div>'.repeat(4)}</section>`;
    expect(blockViolations(four).join("|")).toMatch(/4 figure rows/);
  });

  it("a ledger of six lines, and two takeaway sentences in a block", () => {
    const ledger = `<section data-block=""><dl data-ledger="">${'<div data-ledger-line=""></div>'.repeat(7)}</dl></section>`;
    expect(blockViolations(ledger).join("|")).toMatch(/a ledger of 6 lines/);
    const two = '<section data-block=""><p data-support="" data-takeaway="">One.</p><p data-support="" data-takeaway="">Two.</p></section>';
    expect(blockViolations(two).join("|")).toMatch(/2 takeaway sentences/);
  });

  it("the page's figure rows are counted with a ledger as one row", () => {
    expect(figureRows(collections)).toBeGreaterThan(0);
    expect(elementsWith(collections, "data-ledger")).toHaveLength(1);
  });
});
