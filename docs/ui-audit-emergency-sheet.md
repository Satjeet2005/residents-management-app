# UI audit: the resident Emergency sheet

Protocol: `docs/ui-fix-protocol.md` v1. Screen: the Emergency sheet on the resident Home (`src/components/emergency-sheet.tsx`, the shared `Sheet`).
BEFORE screenshots: `docs/screenshots/emergency-sheet-before-360x800.png`, `-360x500.png`, `-1280.png`.

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

## After

Filled in at the end of Part A.
