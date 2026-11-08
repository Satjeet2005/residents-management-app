# UI audit: the reconciliation workspace (/staff/reconciliation/[importId])

Protocol: `docs/ui-fix-protocol.md` v1. Screen: the Needs you lane of the demo statement (Priya).
BEFORE screenshots: `docs/screenshots/reconciliation-before-360x800.png`, `reconciliation-before-1280.png`.

## Before

| # | Observation | Principle | Fix | Severity |
|---|---|---|---|---|
| 1 | The lane buttons repeat the legend and wrap raggedly. | One place for each fact. | One lane selector with equal cards; the legend is gone. | High |
| 2 | Labels differ between legend and buttons ("Need you" and "Needs you", "Posted automatically" and "Posted"). | One word for one thing. | One set of lane names. The words "Posted automatically" and "Need you" no longer exist on the page. | High |
| 3 | Two back links stack ("Staff home", "All imports"). | One way back. | One breadcrumb line. | Medium |
| 4 | Rows are about 290px tall and the narration is cut off. | Dense, scannable lists. | A card of at most 118px with the narration clamped to two lines at a word. | High |
| 5 | The amount is not first. | The key fact leads. | Line 1 is the amount in bold. | Medium |
| 6 | A small underlined "Review" link is the only tap target. | Big targets; the whole card is the control. | The whole card opens the review. | High |
| 7 | The first screen shows two rows. | Use the first screen. | Header and spacing compacted: three complete rows with the filter row. | High |
| 8 | A long queue has no filters or sort. | Let people narrow a long list. | A Filters sheet: sort, amount, reason. | High |

## Structure chosen (decided by the human)

Breadcrumb; h1 and one secondary line; accounted line; an 8px decorative proportion strip; four lane cards (2x2 on a phone, one row from 768px); the filter row; compact row cards. Rows in Needs you are one tappable card; the other lanes have no review to open, so their cards are plain and Awaiting approval keeps its Approve and Reject buttons inside the card (R116).

## After

AFTER screenshots: `docs/screenshots/reconciliation-after-360x800.png`, `reconciliation-after-1280.png`, `reconciliation-filters-sheet-360x800.png`, `reconciliation-filters-active-360x800.png`.

| # | Observation | Principle | Fix | Evidence |
|---|---|---|---|---|
| 1 | Selector block 138px tall at 360x800 (limit 150): four cards of 65px in a 2x2 grid, equal widths. With rows posted by hand, one extra 14px line sits under the cards (about 163px with it). | Compact. | `lane-selector.tsx` | `tests/e2e/screens/reconciliation-workspace.spec.ts` prints and asserts it. |
| 2 | Counts on the cards equal SQL; names are "Needs you 42 rows". | Numbers a person can trust. | The count follows the name in the page and is drawn above it. | The browser spec reads the database for the import; axe label-content-name-mismatch forced the name to be the visible words. |
| 3 | Three complete rows on the first screen, with the breadcrumb, header, selector and filter row. The tallest row is 118px (limit 120). | First screen. | Compact cards, 14px narration, tighter spacing. | Browser spec, measured, no clipped text. |
| 4 | Arrow keys, Home and End change `?lane=`; Enter and Space open the review; Escape closes it and focus returns to the same row. | Keyboard. | `lane-selector.tsx`, `row-link.tsx` | Browser spec. |
| 5 | Filters sheet: three radio groups on 48px rows, the threshold from the society setting, reason counts, Apply as the only filled control, Reset. Chips remove one choice at a time; filters survive a reload; hostile values give the defaults. | Narrow a long list. | `filters-bar.tsx`, `src/lib/reconciliation/filters.ts`. | `tests/e2e/screens/reconciliation-filters.spec.ts`; render tests WS8. |
| 6 | Every combination of sort, amount and reason returns the ids and order of an independent query, page of 3 to the end, on the sample and on generated ties; counts equal plain SQL; the facets take one query. | Correct data. | `src/server/statements/review.ts` (`listRows`, `rowFacets`). | `tests/integration/reconciliation-filters.test.ts` (12 tests). |
| 7 | Axe zero serious or critical in every lane and with the sheet open; no horizontal overflow at 360, 768 and 1280. | Accessibility. | n/a | `checkScreen`. |

Points kept for a human to judge: the narration is 14px (a four-line row would not fit 120px at 16px); a combination with no rows could not be found in the demo data, so the empty state is covered by a render test and by the browser spec only when the data has one (see the report).
