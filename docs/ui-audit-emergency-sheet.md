# UI audit: the resident Emergency sheet

Protocol: `docs/ui-fix-protocol.md` v1. Screen: the Emergency sheet on the resident Home (`src/components/emergency-sheet.tsx`, the shared `Sheet`).
BEFORE screenshots: `docs/screenshots/emergency-sheet-before-360x800.png`, -360x500.png, -1280.png.

## Before

| # | Observation | Principle | Fix | Severity |
|---|---|---|---|---|
| 1 | The page behind the sheet scrolls when the sheet is scrolled (scroll chaining). | A modal owns the scroll; the background stays still. | One scroll lock in the shared `Sheet` (`src/lib/scroll-lock.ts`), `overscroll-behavior: contain` on the sheet body. | High |
| 2 | Two narrow columns ("Call now", "Raise a complaint") of about 14 rows for two actions. | One task, one primary action; less to read in an emergency. | Remove the columns; one sentence of examples. | High |
| 3 | Plain-text rows sit beside underlined links in the other column. | Nothing that looks interactive but is not; nothing interactive that looks like text. | Remove every underlined item; plain text stays plain. | High |
| 4 | "Raise a complaint" appears three times (column header, four links, the button). | One word, one job. | One outlined button, once. | Medium |
| 5 | "Call" is both a column header ("Call now") and the button ("Call duty manager"). | Same word for two jobs confuses. | Only the button says call. | Medium |
| 6 | The duty manager's number is not shown, so a person cannot read it out or check it. | Show what a button will do. | Show the number as text beneath the button. | Medium |
| 7 | At 360x500 the Raise button is below the fold of the sheet and needs inner scrolling. | The first screen holds the primary action. | Content fits 360x800 without scrolling; the Call button is in the top 55 percent. | Medium |

## Structure chosen (decided by the human)

Title and Close; one lead sentence; the only filled control (Call duty manager, 56px) with the number written under it; one sentence of examples; the emergency services number as one plain text line when the society has set it; a divider; "Not an emergency?"; an outlined Raise a complaint; one small sentence. No columns, no list, no underline, no "dial 112".

## After

AFTER screenshots: `docs/screenshots/emergency-sheet-after-360x800.png`, -360x500.png, -1280.png.

| # | Observation | Principle | Fix | Evidence |
|---|---|---|---|---|
| 1 | The page behind no longer scrolls: a wheel and a touch swipe inside the sheet move the sheet only; past the end nothing chains. | A modal owns the scroll. | `src/lib/scroll-lock.ts` (reference counted) used by the shared `Sheet`; `overscroll-behavior: contain` on its body. | `tests/e2e/screens/sheet-scroll.spec.ts`: three sheets, three rounds each, wheel and touch, 360x500; `tests/lib/scroll-lock.test.ts` (8 tests). |
| 2 | One lead sentence, one filled control, one sentence of examples. The two columns and the 14 rows are gone. | One task, one action. | `src/components/emergency-sheet.tsx` rewritten. | 3 controls (Close 77x48, Call 326x56, Raise 326x48), no inner scrolling at 360x800. |
| 3 | Nothing is underlined and nothing plain looks like a link. | No false affordance. | No list, no underline class in the sheet. | `tests/ui/emergency-sheet.test.ts` ("no columns, no list, no column headers and no underlined item"); the browser spec counts underlined text outside links: 0. |
| 4 | "Raise a complaint" appears once; "call" only names the button. | One word, one job. | Catalog keys rewritten, unused ones deleted. | `tests/ui/emergency-sheet.test.ts` (one occurrence). |
| 5 | The number is readable under the button: "+91 59000 00001"; with no number the sheet says so and draws no button. | Show what a button does. | `formatPhone` in `src/lib/phone-link.ts` (digits never changed). | `tests/ui/emergency-sheet.test.ts` (formatPhone table, no-number state, emergency services as plain text, not a link). |
| 6 | The Call button's bottom edge is at 185px of 800 (23 percent, budget 55). | Primary action on the first screen. | The sheet opens from the top on a phone (`Sheet fromTop`): from the bottom it was at 524px (65 percent) and failed the budget. | Browser spec, measured. |

Clutter budget measured at 360x800: no inner scrolling; exactly three controls (two when the number is not set, rendered in `tests/ui/emergency-sheet.test.ts`); one filled control; every control at least 48px and 8px apart; axe zero serious or critical.
