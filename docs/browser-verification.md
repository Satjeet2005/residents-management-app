# Browser verification (T15)

The unit and integration tests never draw a page. This is the check that does: the built app, in a real Chromium, at the two widths the design is judged at.

## Method

`npm run e2e` (`scripts/e2e.sh`) creates the scratch database `township_seed_scratch` (the safety checks of `scripts/e2e-db.mjs` apply), migrates and seeds it, builds the app, starts it in demo mode with the business date frozen at 27 Oct 2026 and the classifier settings blank, runs Playwright, then stops the server by its process id and drops the database. It is not part of `npm run check` or `npm run test:ci-parity`; it needs Chromium (`npx playwright install chromium`, never committed).

Three device profiles, all Chromium: a **360 x 800 phone** (mobile emulation, touch, device scale factor 2), a **768 x 1024 tablet** (touch; added in T13h for the staff complaints screens) and a **1280 x 800 desktop**. People log in through the real login page once (global setup, the demo code banner), and each spec reuses that session.

The specs run as a chain of Playwright projects (`playwright.config.ts`), because some of them change the data the next ones read: resident screens, resident flows, the reconciliation flow, staff screens, the staff complaints board and complaint page at 360, 768 and 1280 (`tests/e2e/screens/staff-complaints.spec.ts`, T13h), staff flows, installability.

## The checks on every screen (`tests/e2e/helpers/checks.ts`)

For each screen, at both widths:

| Check | Rule |
| --- | --- |
| overflow | the page is no wider than the profile (measured against 360 or 1280, not against the page's own `innerWidth`, see mutation 1) |
| target size | every interactive element is at least 48 x 48 px (a native checkbox or radio is measured by its label) |
| spacing | neighbouring targets are at least 8 px apart (a sticky bar is compared at the end of the scroll) |
| focus | the first Tab shows a visible focus ring |
| console and network | no console error, no failed request |
| document | a title, `html lang`, exactly one `h1` |
| one primary | at most one filled control |
| text | at least 14 px |
| axe | zero serious or critical violations; moderate and minor ones are listed in the JSON, not failed |

A failure names the screen, the width, the selector and the screenshot (`docs/screenshots/<area>-<screen>-<width>.png`). The JSON of every screen is in `test-results/checks/`.

Screens: resident login (idle, code sent), Home (overdue, no dues, safety alert 1a with the outlined Pay, fee only), the dues sheet, the Emergency sheet, the demo payment page, complaints list, raise a complaint (before and after Yes), a complaint (normal, needs your answer, safety), profile; staff landing, reconciliation start page, the workspace (every lane), the review panel, the complaints board (every lane), a complaint as the duty manager and as a plain manager, the committee report (top, ageing, a drill-down).

## Staff complaints v2 (T13h)

`tests/e2e/screens/staff-complaints.spec.ts` runs at the three widths and checks: no horizontal overflow and axe zero serious or critical (inside `checkScreen`); at 360 the
first screen of Needs action shows at least four complaint rows fully and every row is at most 120 px tall (the measured numbers are printed); at 768 and 1280 the board
is a table with the eight columns; the views sheet (below 1024px) or sidebar (from 1024px); the filters sheet (Apply, chips, Reset, Escape returning focus); a hostile
address; the Details and Timeline tabs by keyboard; the bar and actions sheet (assign, a comment with the box unchecked staying internal, resolve with a required note)
or, from 1024px, the side panel with no bar; a plain manager seeing "Update" and never the duty manager's controls; and the duty manager's "I have seen this" inside
the viewport on load, acknowledging it, and the resident's Home then showing alert 1b. Each width raises its own safety complaints (as Rohit, through the API).

## Interaction specs (real clicks)

Login and logout; pay failure and success on the demo gateway page; Copy payment note (clipboard permission, visible "Copied", the clipboard holds the flat code); a normal complaint (the danger answer cannot be skipped) and a danger complaint (Yes shows the call link, Home shows alert 1a, then 1b after the duty manager has seen it); reconciliation (import the sample through the page, open a row, search another flat, Post stays off without a reason, a manual match, a request for a second approver, approval by a second user in a second browser context); assigning a complaint; the ageing drill-down; Escape closes the dues and Emergency sheets and focus returns to the opener; the arrow keys, Home and End move between the lane tabs.

## What the browser found (defects)

| Defect | Where | Fix |
| --- | --- | --- |
| The `<dl>` of the profile held `Hairline` children (axe, serious: definition-list) | Profile, 360 and 1280 | each row draws its own bottom hairline |
| The selected review link read "Reviewing" but was named "Review the payment of ..." (axe, serious: label-content-name-mismatch) | Review panel, 1280 | a "Reviewing the payment of ..." name for the selected row |
| The current and upcoming tracker markers were inline spans, so `h-6 w-6` did nothing and they drew as thin bars (found by comparing with the Passbook image, not by a check) | Home and complaint detail, 360 and 1280 | `block`; a unit test pins it. Before and after: `docs/screenshots/before-tracker-fix-home-overdue-360.png` and `home-overdue-360.png` |
| My overflow check was blind on a phone: a wide element made the layout viewport grow, so `scrollWidth` equalled `innerWidth` (616 and 616) | the check itself | the check compares with the profile's width |

Found while writing the checks and settled in the checks, not in the app: the page behind an open modal `<dialog>` is inert and is not measured; a sticky bar is compared with the content at the end of the scroll.

## Mutations

Each was applied, the failing tests were noted, and the file was restored from a copy (clean `git diff`).

1. A 600 px element on the profile page. First run: passed at 360 (the blind check above). After the fix to the check: `[resident-screens-360] resident screens: Swati Joshi ... profile` fails with "the page is 616px wide in a 360px viewport"; the 1280 run passes, as it should.
2. `min-h-12` of the default Button changed to `min-h-8`. The login screen fails at both widths ("Send code", "Log in", "Use a different number": 328 x 32), and 19 unit tests that read the button classes fail.
3. The service worker made to cache an `/api` response. `tests/lib/service-worker.test.ts` fails: the three "a GET of /api/... is left to the browser and never stored" cases and the "no cache.put ... no mention of /api" case.
4. The 512 px icon removed from the manifest. `tests/ui/manifest.test.ts` fails: "lists a 192, a 512 and a maskable 512 icon, and each file exists at exactly that size".

## Judgment calls for the human (resident screens against the Passbook images)

Compared by eye: the Home at 360 and the dues sheet. The other resident screens were not compared image by image; the checks above ran on all of them.

- The Home has no bell with a count, no "Bills" tab, and no "View ledger" and "Receipt" links. They belong to features that are not built or sit behind flags, and the brief says every affordance is built or absent. Left absent.
- The rule under the amount is the double rule of the design system's motif; the Home image shows one thick rule. Left as the design system says.
- The complaint card shows the resident's own words as the title ("Water leak under the kitchen sink"), the image shows a short category name. The app has the words, not a short name.
- In the dues sheet the lines carry a date column and the late fee explanation sits in a tinted box; the image has a plain paragraph. The account name and number lines are absent because the society's account setting is not set in the demo.
- The offline banner says "You're offline. You can't pay right now." The image adds "Showing information from [time]"; the app does not keep a time of its own data, so it is left out.
- A full-page screenshot of a page with a sticky bottom bar shows the bar in the middle of the page and covers a few rows of the content under it. That is how the screenshot is taken, not how the page scrolls.

## Running it

```bash
npx playwright install chromium   # once
npm run e2e                       # everything; `npm run e2e -- tests/e2e/flows` for part of it
```

## Committee report v2 (Phase A of the final run)

`tests/e2e/screens/committee-report.spec.ts` runs at 360, 768 and 1280 px (three projects in `playwright.config.ts`, after the staff complaints projects): the page checks of `checkScreen`, the first two
sections open only from 768px, each visible visual has a title, a description and a table (below 768px the only visuals are the bars and sparklines), an age group link opens the drill-down, Tab reaches the section
toggles and the Choose sections button, Enter and Space toggle a section, Escape closes the sheet and returns focus, and a hidden section stays hidden after a reload until Show everything. The first thing the server sends
is the loading state (no heading), so the spec waits for the h1 before it acts. `checkScreen` ignores the content of a closed `<details>`: the browser still reports a box for it, but it is not on screen.
Screenshots: `docs/screenshots/committee-report-{360,768,1280}.png` (default state), `committee-report-open-*.png` (every section open), `committee-m1..m4-*-360.png` and `committee-c1,c3,c4-*-1280.png` (close-ups), `committee-choose-*.png` (the sheet); each is under 400 KB.
