/**
 * The text budget of the committee pages (D206, text budget v2), as pure functions over rendered HTML.
 *
 * COUNTING RULE: the visible supporting words of a page are the words (a word is a piece of text with at least one letter; numbers and symbols alone are not
 * words) inside elements marked `data-support`, leaving out the expander (`<details>`), the goal lines (`data-goal`) and the ledger lines (`data-ledger`).
 * Headings and row labels are never marked, so they are never counted.
 */

export const BLOCK_SUPPORT_WORDS = 12;
export const TAKEAWAY_WORDS = 12;
export const PAGE_SUPPORT_WORDS = 40;
export const COMPLAINTS_PAGE_SUPPORT_WORDS = 15;
export const DUES_PAGE_SUPPORT_WORDS = 12;
export const BLOCK_FIGURE_ROWS = 3;
export const LEDGER_LINES = 5;
export const DEFINITION_LINES = 9;
export const DEFINITION_WORDS = 25;

const VOID_FREE_TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

/** The words of a text: the pieces between spaces that hold at least one letter. */
export const wordCount = (text: string): number => text.split(/\s+/).filter((piece) => /\p{L}/u.test(piece)).length;

/** The plain text of a piece of HTML: tags dropped, the few entities React writes decoded, spaces collapsed. */
export const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

type Found = { tag: string; start: number; end: number; open: string; inner: string };

/** The index where the element opened at `from` (a tag named `tag`) ends, counting nested tags of the same name. */
function endOfElement(html: string, tag: string, from: number): number {
  let depth = 0;
  VOID_FREE_TAG.lastIndex = from;
  for (let match = VOID_FREE_TAG.exec(html); match !== null; match = VOID_FREE_TAG.exec(html)) {
    if (match[2] !== tag) continue;
    if (match[3] === "/") continue;
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) return VOID_FREE_TAG.lastIndex;
  }
  return html.length;
}

/** The outermost elements whose opening tag matches `opening` (a regex tested on the tag text). */
export function elementsMatching(html: string, opening: RegExp): Found[] {
  const found: Found[] = [];
  const openTag = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let cursor = 0;
  for (let match = openTag.exec(html); match !== null; match = openTag.exec(html)) {
    if (match.index < cursor || !opening.test(match[0])) continue;
    const end = endOfElement(html, match[1], match.index);
    found.push({ tag: match[1], start: match.index, end, open: match[0], inner: html.slice(match.index + match[0].length, Math.max(match.index + match[0].length, end - match[1].length - 3)) });
    cursor = end;
    openTag.lastIndex = end;
  }
  return found;
}

const hasAttribute = (name: string): RegExp => new RegExp(`\\s${name}(=|\\s|>)`);

/** The outermost elements that carry the attribute `name`. */
export const elementsWith = (html: string, name: string): Found[] => elementsMatching(html, hasAttribute(name));

/** The HTML without the outermost elements whose opening tag matches `opening`. */
function withoutMatching(html: string, opening: RegExp): string {
  let out = "";
  let cursor = 0;
  for (const el of elementsMatching(html, opening)) {
    out += html.slice(cursor, el.start);
    cursor = el.end;
  }
  return out + html.slice(cursor);
}

/** The HTML without the elements that carry the attribute `name`. */
export const withoutAttribute = (html: string, name: string): string => withoutMatching(html, hasAttribute(name));

/** The ONE expander of a page (`<details data-definitions>`) removed. Other `<details>` (the numbers behind a chart or a card) are data, not definitions. */
export const withoutExpander = (html: string): string => withoutMatching(html, /^<details\b[^>]*data-definitions/);

/** The visible supporting words of a piece of HTML, by the counting rule above. */
export function supportWords(html: string): number {
  const visible = withoutAttribute(withoutAttribute(withoutExpander(html), "data-goal"), "data-ledger");
  return elementsWith(visible, "data-support").reduce((sum, el) => sum + wordCount(textOf(el.inner)), 0);
}

/** The words of the takeaway sentence (`data-takeaway`) of a block, 0 when there is none, and how many there are. */
export function takeaways(html: string): string[] {
  return elementsWith(withoutExpander(html), "data-takeaway").map((el) => textOf(el.inner));
}

/** The blocks of a page: the `<section data-block>` elements (or the cards of the overview). */
export const blocksOf = (html: string): string[] => elementsWith(html, "data-block").map((el) => html.slice(el.start, el.end));

/**
 * The figure ids of a piece of HTML outside the expander. `data-figure` holds one or more ids separated by spaces (a ledger holds the ids of its parts and is ONE
 * figure row); `data-figure-form` marks a second visual form of a figure that is already a row (a chart of the same figure), which adds its id but no row.
 */
export function figureIds(html: string): string[] {
  const outside = withoutExpander(html);
  const idsOf = (name: string) => elementsWith(outside, name).flatMap((el) => (new RegExp(`${name}="([^"]*)"`).exec(el.open)?.[1] ?? "").split(" ").filter((id) => id !== ""));
  return [...idsOf("data-figure"), ...idsOf("data-figure-form")];
}

/** The number of figure rows (elements that carry `data-figure`, a ledger counting once) outside the expander. */
export const figureRows = (html: string): number => elementsWith(withoutExpander(html), "data-figure").length;

/** The definition lines of the expander: `{ id, text }` for every `<li data-def-for>` inside `<details data-definitions>`. */
export function definitionLines(html: string): { id: string; text: string }[] {
  return elementsMatching(html, /^<details\b[^>]*data-definitions/).flatMap((details) =>
    elementsMatching(details.inner, /^<li\b[^>]*data-def-for/).map((li) => ({ id: /data-def-for="([^"]*)"/.exec(li.open)?.[1] ?? "", text: textOf(li.inner) })),
  );
}

/** The number of `<details>` expanders of definitions in the HTML. */
export const definitionExpanders = (html: string): number => elementsMatching(html, /^<details\b[^>]*data-definitions/).length;

/** The sentences of a text (split after a full stop, a question mark or an exclamation mark followed by a space). */
export const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((s) => s !== "");

/** Figures that may appear in more than one row of a page, each with the reason: the ledgers share one definition line, and the safety block's two rows are the same fact for two scopes. */
export const REPEATED_FIGURES_ALLOWED: Readonly<Record<string, string>> = {
  ledger: "the two ledgers of the Complaints page share one definition line (the lines add up to the total)",
  seen: "the safety block shows the time to the first sight and, when it differs, the all-months count: one definition",
};

const headingsOf = (html: string): string[] => elementsMatching(html, /^<h[1-3]\b/).map((el) => textOf(el.inner));

/** The text of a heading must not be written again as the text of another element of its block (a chart title that only contains the word is not a repeat). */
function repeatedHeadings(block: string): string[] {
  return headingsOf(block)
    .filter((heading) => heading !== "" && block.split(`>${heading.replace(/'/g, "&#x27;")}<`).length - 1 > 1)
    .map((heading) => `heading "${heading}" is repeated inside its block`);
}

/** The violations of the text budget in ONE block (a `data-block` element): an empty list when it is within the budget. */
export function blockViolations(block: string): string[] {
  const found: string[] = [];
  const words = supportWords(block);
  if (words > BLOCK_SUPPORT_WORDS) found.push(`${words} supporting words (at most ${BLOCK_SUPPORT_WORDS})`);
  const sentences = takeaways(block);
  if (sentences.length > 1) found.push(`${sentences.length} takeaway sentences (at most 1)`);
  for (const sentence of sentences) if (sentencesOf(sentence).length > 1 || wordCount(sentence) > TAKEAWAY_WORDS) found.push(`takeaway "${sentence}" is longer than one sentence of ${TAKEAWAY_WORDS} words`);
  const rows = figureRows(block);
  if (rows > BLOCK_FIGURE_ROWS) found.push(`${rows} figure rows (at most ${BLOCK_FIGURE_ROWS})`);
  for (const ledger of elementsWith(block, "data-ledger")) {
    const lines = (ledger.inner.match(/data-ledger-line/g) ?? []).length - 1;
    if (lines > LEDGER_LINES) found.push(`a ledger of ${lines} lines (at most ${LEDGER_LINES})`);
  }
  return [...found, ...repeatedHeadings(block)];
}

/** The violations of the text budget in a whole page: every block, the supporting words of the page, the expander and the definition lines. */
export function pageViolations(html: string, supportLimit: number): string[] {
  const found = blocksOf(html).flatMap((block) => blockViolations(block));
  const words = supportWords(html);
  if (words > supportLimit) found.push(`${words} supporting words on the page (at most ${supportLimit})`);
  const expanders = definitionExpanders(html);
  if (expanders > 1) found.push(`${expanders} expanders of definitions (at most 1)`);
  const lines = definitionLines(html);
  if (lines.length > DEFINITION_LINES) found.push(`${lines.length} definition lines (at most ${DEFINITION_LINES})`);
  for (const line of lines) if (wordCount(line.text) > DEFINITION_WORDS) found.push(`definition "${line.id}" has ${wordCount(line.text)} words (at most ${DEFINITION_WORDS})`);
  const outside = textOf(withoutExpander(html));
  for (const line of lines) if (line.text !== "" && outside.includes(line.text)) found.push(`definition "${line.id}" is also written outside the expander`);
  const shown = [...figureIds(html)];
  const defined = new Set(lines.map((line) => line.id));
  for (const id of new Set(shown)) if (!defined.has(id)) found.push(`figure "${id}" has no definition line in the expander`);
  const rowIds = elementsWith(withoutExpander(html), "data-figure").flatMap((el) => (/data-figure="([^"]*)"/.exec(el.open)?.[1] ?? "").split(" ").filter((id) => id !== ""));
  for (const id of new Set(rowIds)) if (rowIds.filter((x) => x === id).length > 1 && REPEATED_FIGURES_ALLOWED[id] === undefined) found.push(`figure "${id}" is shown more than once on the page`);
  return found;
}
