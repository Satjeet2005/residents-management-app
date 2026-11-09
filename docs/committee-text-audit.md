# The committee text audit (D206)

Every block of every committee page, with the supporting words it carries, before and after Part 3 of Round A.

## The counting rule

Visible supporting words are the words (a piece of text with at least one letter; numbers and symbols alone are not words) inside elements marked `data-support` (the `<Support>` component, `src/components/committee/support.tsx`), leaving out headings, row labels, the goal line (`data-goal`), the ledger lines (`data-ledger`) and the content of the expander (`<details data-definitions>`). The helper is `src/lib/reports/text-budget.ts`; `tests/ui/committee-text-budget.test.ts` renders every page from a report that shows every figure and fails on any violation.

Limits per block: at most 12 supporting words; at most one takeaway sentence of at most 12 words; at most three figure rows (a ledger counts as one, with at most five lines); no heading text repeated inside its block; no figure in two rows of a page (allowlist in the helper, with the reason). Limits per page: at most 40 supporting words (15 on Complaints) and one expander of at most 9 lines of at most 25 words.

## BEFORE (measured on the pages at commit `52edee8`, with a throw-away script)

The old pages had no `<Support>`, so the script counted the words of every `<p>`, `<li>` and small `<span>` outside headings, row labels, values, tables, charts and the expander, and took the "As of ... read only" line out of the count of the block table below. The fixture: the October 2026 numbers of the seeded demo (2,399 bills, 1,915 paid, 106 bank rows, a complaint set with one open safety complaint). These counts are therefore approximate; they are the "BEFORE" of the same method, not the helper. The script was not kept.

| Page | Words counted | What they were |
|---|---|---|
| Overview | 57 outside the expander, plus the expander of 616 | the period line of each card ("October bills", "All months, as of ..." and so on), card captions, the goals note, "What these words mean", and the About block: 12 paragraphs, 616 words, with a toggle |
| Collections | 105 | the Money facts (11), "How fast bills are paid" (62: a definition under every row, "paid on or before their due date" twice, a 22-word paragraph of numbers that are also in the chart, "the middle value"), the chart note (4), the two monthly notes (21) and a repeated sub-heading |
| Dues | 53 | the scope sentence (14), "Nothing is owed" and the age-group sentences, the three late-fee lines (36), the towers hint (21 when the towers show) |
| Complaints | 83 | the promise line (9), a grey line under almost every row (about 50), the closing sentence, the sum line, and a four-sentence safety paragraph (22) |
| Bank | 30 | one summary sentence (23 words with the parts), the accounted line and the by-hand line |

## AFTER (the helper, from the report that shows every figure)

| Page | Supporting words on the page (limit) | By block | Expander lines (longest, in words) | Grey lines left | Repeated facts | Statistical terms |
|---|---|---|---|---|---|---|
| Overview | 30 (40) | cards 4, 8, 0, 0; "Look closer" 17 (four one-line headlines) | 6 (24) | the card captions and the four "Look closer" lines, each new information | none: the period lines are gone, the title says the month | "Half of ... within" nowhere on the overview |
| Collections | 24 (40) | Billed and collected 11; How fast bills are paid 6 ("n of n bills", the chart note); Collected within 20 days, by month 7 (the one takeaway, "October is 10 points lower than September (83% vs 93%)."; the note about months before billing moved into the chart description) | 9 (25) | the two facts, the count under "Bills paid by the due date", the chart note, the takeaway | the 88% figure is in the expander only | "Half of paid bills are paid within" (the median), no "(the middle value)" |
| Dues (Part 5, D214) | 10 (12) | Total owed 5 (the split "Unpaid bills ₹x + late fees ₹y" 4, "n flats" 1); How old are the dues? 5 (one word on each of five rows: "bills", or "flats" on Over 90 days); Late fees 0; Towers 0 | 8 (25) | one grey line per age row | Total owed: the headline figure, and once in the table behind the list (the one allowed repetition) | none |
| Flats page (Part 6, D217) | 8 (40) | two header lines: "<age group> · as of <date>" (5 words) and "Flat codes only." (3) | none: a list page with no figure label (the h1 says "n flats owe ₹x") | none | none | none |
| Towers page (Part 6, D217) | 0 (40) | none: the table is the page | none | none | Total owed in the totals row (the one allowed repetition) | none |
| Complaints | 14 (15) | Replies 12 (the promise 9, "n of n replies due" 3); Resolution 2; Where <Month>'s complaints stand 0; Safety complaints 0 | 9 (22) | the promise line and two counts | none | "Half of first replies come within", "Half are marked resolved within", "Half are seen within" |
| Bank | 0 (40) | one ledger, no supporting sentence | 7 (17) | none | none | none |

Every number in AFTER is printed by the helper from `richReport()` in `tests/ui/committee-fixtures.ts`. The Dues limit is 12 words on the page (Part 5).
