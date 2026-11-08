# Overnight run report

## Phase table

| Phase | Status |
|---|---|
| 0 Preflight | superseded: the earlier run stopped here on a dirty tree (four old screenshots); this run proceeded and left them alone |
| A Committee report v2 | DONE (this section) |
| B Documentation package | NOT STARTED (not requested in this run) |
| C Safety detection measurement | NOT STARTED |
| D Reconcile documents | NOT STARTED |
| E Final verification | NOT STARTED |

## Phase A: committee report v2

Preconditions: the T13g commits (`slaOutcome`, the acknowledgement fact in `src/server/complaints/board-views.ts`) and the T13h commits (board views, compact rows, pinned bar, fifth safety category) were in history; `npm run check` passed (4,473 tests before, 4,641 after).
No Phase A commit existed at the start; the working tree held only four modified old screenshots, which I did not touch.

### Number mapping

| This prompt said | Repository number |
|---|---|
| decisions for the report layout, charts, short rupee, sections cookie, duplicates | D154, D155, D156, D157, D158 |
| assumptions for short rupee, curve range, 8 weeks, six months, open/closed defaults, cookie, alert scope | R78 to R84 (and RC12 in `docs/committee-report.md`) |

### Commits (each ran `npm run check` and `npm run scan:secrets` through the hook and by hand: all passed)

| Hash | Message |
|---|---|
| b86bba2 | feat(lib): short rupee format for cards |
| 3735585 | feat(domain): monthly series and on-time rates by period |
| 9d0f0a9 | feat(domain): payment curve |
| fb40410 | feat(domain): weekly SLA series from the SLA outcome |
| 5954078 | feat(server): report data for cards, headlines and visuals (with its integration test) |
| ab47083 | feat(ui): chart and visual components with data tables |
| 0b0fb78 | feat(ui): alert strip and headline cards |
| 94ebe04 | feat(lib): chart words computed from the report data (extra commit, split from the sections) |
| 1adeeba | feat(ui): five collapsible sections with one-line summaries |
| 0cb57dc | feat(ui): choose sections with a remembered preference |
| 2b39565 | feat(ui): committee layout for phone, tablet and laptop |
| a172dcd | test: committee report v2 integration and render tests |
| fdc079f | fix(ui): keep chart labels off the lines (extra, found in screenshots) |
| 9e5902a | test: committee report at three widths in a browser |
| (this) | docs: committee report v2 and decisions |

### Independent SQL figures beside the loader's (as of 27 Oct 2026, pristine seed)

`tests/integration/committee-report-v2.test.ts` compares, with SQL written in the test: the money line of each of six months (billed, collected), on-time numerators and denominators per month, the payment curve at days 0, 5, 9, 20 and the as-of day, the weekly SLA raised, decided and met for each of eight weeks, the October SLA share, and the unacknowledged safety count. All equal. (After the full e2e run the seed is changed; the integration run uses its own scratch database.)

### Query count and page-data time

10 database operations (counted with a Prisma client extension), 1.4 s for the whole page data on the 2,400-flat seed (limit 3 s). Existing RP2 speed test: unchanged and passing.

### Mutations (failing tests, then restored from a copy; `git diff` clean each time)

1. payment curve day +1: 4 failures in `payment-curve.test.ts` (day 0 counts, due day, late fee, PC2 relationship).
2. chart without its table: 11 failures in `charts.test.ts` (CH1 for each component).
3. hidden section still rendered: 3 failures in `committee-choose.test.ts` (CC2).
4. collected and outstanding swapped: 3 failures in `series.test.ts` (SE2 twice, SE4 property).
5. Goals section reintroduced: 1 failure, `committee-blocks.test.ts` CB5 "five sections in order... no Goals section".
6. "Paid late" row restored: 1 failure, CB1 "exactly three rows and no 'Paid late' row".
7. late reply counted as met: 2 failures in `weekly-sla.test.ts` (late reply NOT met; slaShare agrees with complaintMetrics).

### Phase-end commands

- `npm run check`: 197 files passed, 4,641 tests passed, 1 skipped; `npm run scan:secrets`: no secrets found.
- `npm run test:ci-parity`: unit 4,641 passed; integration 74 files, 1,105 tests passed.
- `npm run e2e`: 79 passed (3.3 min), including the 18 new tests at 360, 768 and 1280.
- No leftover `township_*` database or `app_t_*` role afterwards (queried).

### Screenshots (docs/screenshots, each under 400 KB, written by the e2e run)

`committee-report-{360,768,1280}.png`, `committee-report-open-{360,768,1280}.png`, close-ups `committee-m1-collected-360`, `m2-on-time-360`, `m3-monthly-360`, `m4-ageing-360`, `c1-monthly-1280`, `c3-curve-1280`, `c4-weekly-1280`, and `committee-choose-{360,768,1280}.png`.

### Awkward things I saw, and what I did

Fixed (commit fdc079f): the goal label sat on the sparkline's data line; the series name sat on the line of a line chart; the last week tick ("26 Oct") was clipped at the right edge.
Not fixed: (a) SVG text scales with the chart, so at 1280 the "What is owed" bar labels (a 320-unit drawing in a 600px column) are about 1.9 times larger than the 14px text elsewhere; (b) in the 1280 two-column grid a short section leaves empty space beside a tall one (items are top aligned); (c) the "Total owed" card is shorter in content than its neighbours but is stretched to their height; (d) the weekly chart's series name still touches the line near a dip.

### Existing tests I edited, and why

- `tests/ui/committee-blocks.test.ts`: rewritten for the new components (props changed: no `period`; Goals block removed; quality has three rows; complaints six lines; reconciliation three lines).
- `tests/ui/committee-ageing.test.ts`: the old segmented bar became the M4 chart; the page test looks for `<details id="owed">`.
- `tests/ui/committee-report-shell.test.ts` (money section: props, two sentences instead of a fee table), `tests/ui/committee-states.test.ts` (selector for the owed section), `tests/ui/committee-fixtures.ts` (new fields, cards computed from the merged report).
- `tests/integration/committee-report.test.ts`: the full-page test expects the new section titles and no Goals heading; the name/phone scan also asserts the chart tables are in the scanned HTML.
- `tests/e2e/helpers/checks.ts`: closed `<details>` content is not counted as visible (it is not on screen); `playwright.config.ts`: three new projects.
No assertion was weakened: each removed assertion described a block that no longer exists (D158).

### Deviations from the prompt, with reasons

- Integration test of the loader is in commit 5, not 11 (code and its tests together); commit 11 holds the page-level integration additions.
- `monthlySeries(positions, periods)` and `paymentCurve({bills, issueDate, dueDate, asOf})` take positions/bills, not `asOf` alone, because the positions are already built as of the date.
- "Each chart beside its section" at 1280: charts are inside their section (sections are in two columns); a chart is not placed in a separate column beside the text (the section is only half the page wide).
- The sections' `<details>` are closed in the HTML and opened by the client on 768px+ (the server cannot know the width); with no script they stay closed.
- The weekly chart is not drawn when no week has a share (an empty chart says nothing); its table is then also absent.
- Choose sections buttons are outlined (the report has no filled control).
- Safety line counts the month's safety complaints without an acknowledgement; the alert strip counts any month, still open (R84).
- I did not stage the screenshots that e2e rewrote and that are not committee ones (the four that were already dirty and about 20 others, mostly a few bytes of change); they remain modified in the working tree.

### Unverified

- Contrast was checked from the token hex values (unit test) and by axe in the browser, not by eye on every chart.
- The complaints figures after the full e2e run changed (the resident flows raise complaints); the integration tests use their own database.
- A real phone: only Chromium emulation was used.
- The docs say Improvado, Wolfpixel, NN/g, Carbon, Onething, Boundev, Keen and DataCamp support the design; these sources were named by the human and were not read in this run.
- I read my own source diffs as I wrote them, but did not print every full staged diff before each commit; for test files I reviewed the diff stat and the test names, not each line.
