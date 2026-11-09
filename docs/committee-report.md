# The committee report (T14, v3)

> **Updated 2026-11-09 (D194): the layout below is superseded.** The report is now an overview at `/staff/reports` (alert strip, month selector, four headline cards, a "Look closer" list of four rows, About these numbers) and four section pages: `/staff/reports/collections` (the Billed and collected ledger, how fast bills are paid, collected within 20 days by month), `/staff/reports/dues` (what is owed, the age list, the drill-down of an age group, the three late-fee figures, towers), `/staff/reports/complaints` and `/staff/reports/bank`. Each page needs `reports:view`, has a back link, one h1 and from 1024px a list of the pages. "Choose sections" and the `committee_view` cookie are gone. The headline cards have a goal bar instead of a sparkline. Every definition and figure below still stands; only where it is shown changed. Code: `src/app/(staff)/staff/reports/`.

A read-only page for the committee, `/staff/reports`: four headline cards, then five collapsible sections (money, what is owed, collection quality, complaints, bank
reconciliation), computed live from the database when the page opens. Version 2 (Phase A; D154 to D158) changed how it is laid out and read. Version 3 (T14c; D171 to D183) applies the independent audit (`docs/committee-audit-report.md`, `docs/committee-audit-disposition.md`): some definitions changed (the safety "seen" rule, the same-age month measure, the split of Total owed), the words, the first screen and the age drill-down were reworked, and a tower roll-up was added. It shows no resident name and no phone number. Decisions: D131 (computed live from bill positions, the Home's function), D132 (no
names) and D133 (the goals are assumptions in a setting), with D5, D6, D13, D26, D35, D107, D110 and D116 behind them (`docs/decisions.md`). The look is Passbook
(`docs/design-system.md`); the screens follow `docs/staff-ui.md` and `docs/staff-complaints-ui.md`. Every string is in `src/lib/messages/en.ts` (`committee.*`).

There was no wireframe to look at: `docs/design/` holds the Passbook images and no committee dashboard. The page follows the brief's structure.

## Information architecture (v3)

Phones are for CHECKING status and laptops for investigating. Top to bottom:

| Part | What it shows |
|---|---|
| **Alert strip** | "<n> safety complaint(s) are open and not yet seen by the duty manager." Only when an open safety complaint of ANY month has no acknowledgement (D171). A link to the safety view only for a viewer with `complaints:manage`. |
| **Title, "As of <date> · read only", month selector** | Choosing a month applies at once (a Show button exists only inside `<noscript>`). |
| **Four headline cards** | Money collected for <Month>; Total still owed, all months; Bills paid by the due date, <Month> bills; Complaints answered in time, <Month>. Each says its period. Never hideable. Under them: "What these words mean" (a link to About) and, only while `committee_goals` is unset, "Targets shown are standard starting targets (90%, 90%, 8%). The committee has not set its own." |
| **Five sections** (`<details>`, ids `money`, `owed`, `quality`, `complaints`, `bank`) | Billed and collected; What is owed; How fast bills are paid; Complaints; Bank statement matching. Each has a period line and a summary that adds NEW information (D179). Below 768px all closed; from 768px the first two open. |
| **Choose sections** | At the bottom. A sheet of five checkboxes; each choice is saved at once (cookie, D157); one button, Done. |
| **About these numbers** | The as-of date and one sentence per metric. |

### The cards

| Card | Value | Lines under it |
|---|---|---|
| Money collected for <Month> | Collected percent of billed (today) | "₹1.49 crore of ₹1.81 crore billed"; "<Month> within 20 days: x%" ("so far" for a young month); "<Previous month>, at the same age: y%"; a progress bar |
| Total still owed, all months | The all-open-dues total | "All months, as of <date>"; the flats; the flats over 90 days |
| Bills paid by the due date, <Month> bills | The D134 headline | "<n> of every 100 <Month> bills were paid by the due date."; the goal with its gap ("Goal 90% · 20 points short") and Met or Not met; a six-month line on a fixed 0 to 100 scale; "<Previous> 73% → <Month> 70%" |
| Complaints answered in time, <Month> | MET over MET + MISSED_LATE + MISSED_OPEN (D150) | The goal and gap; a six-MONTH line whose last point IS this figure (D174); "<Previous> 85% → <Month> 87%" |

### The sections

| Section | Content |
|---|---|
| Billed and collected | Billed, Collected (bill amount without late fee), Still unpaid (<Month> bills); "Billed equals Collected plus Still unpaid"; three late-fee lines (received, charged but unpaid, building up: a calculation); the flats sentence; the monthly collection by day 20 (bars below 768px, columns from 768px), with the table of both measures and the notes "Every month is measured at the same age…" and "Months before billing started are not shown" |
| What is owed | Total owed with "= unpaid bills + late fees", the different flats, a sentence tying the month's Still unpaid to its age group, ONE list of age groups (bar scaled to the total, amount, bills, share, "See the flats"), the table (Age, Bills, Flats, Unpaid bills, Late fees, Total), the drill-down of flats, and "Towers with the most unpaid" |
| How fast bills are paid | Paid by the due date (goal), Of bills that were paid, paid on time (ignores the unpaid bills), Typical days to pay; "Share of <Month>'s money collected: by the due date, by day 20, today"; from 768px the payment curve ("How fast October's money came in", "Line stops at today.") |
| Complaints | "Replies within our promised time" with the promise from the settings; Raised; Typical first reply; Replied in time (goal); Typical time until marked resolved; Reopened after being marked resolved (goal); closed by the resident, automatically, by the duty manager, with "Raised = closed + still open"; the safety lines; from 768px the weekly chart |
| Bank statement matching | One summary that accounts for every bank entry, "All <n> accounted for" only when the database says so, "Matched by hand (last 30 days): n", the manual decisions table only when a count is above zero |

### The series (pure, in `src/domain/reports/`)

| Series | Definition |
|---|---|
| Monthly (`monthlySeries`) | For each of the six months ending at the selected one: billed, collected today, still unpaid, and collected WITHIN 20 DAYS of the issue date (`collectedByDay`, D173: payments dated on or before issue + 20 days, capped per bill so a late fee never counts, a reversed payment never; a month younger than 20 days is read to the as-of date and flagged `inProgress`). |
| On-time by month (`onTimeRateByPeriod`) | The D134 headline and the "of paid bills" rate per month. |
| Monthly SLA (`monthlySla`) | The `slaShare` of the complaints raised in each of the six months: the Replies card's line. |
| Payment curve (`paymentCurve`) | The share of billed collected by each day since issue, day 0 to the earlier of day 45 and the as-of day; principal only. |
| Weekly SLA (`weeklySla`) | The last eight ISO weeks; the week that is not over is `partial` (a hollow ring, "this week so far"). |
| Ageing (`ageingTable`) | Per age group and in total: flats, bills, unpaid bills, late fees, amount due (unpaid + fees, exactly; D175). |
| Flats of a group (`ageingFlats`) | Per flat: bills, days overdue of the oldest, total owed, in a total order (largest or oldest first; ties by flat code and id) for the keyset cursor (D180). |
| Towers (`towerRollup`) | Per tower: flats owing, bills, unpaid bills, late fees, flats over 90 days; the towers add up to Total owed (D182). |

## Charts

Plain SVG and HTML in `src/components/charts/`, no library, no new dependency. Every chart is non-interactive (no hover, no tooltip, no tap target inside it): tooltips fail on touch,
so each value is written on the chart and again in a table. Rules, each enforced by `tests/ui/charts.test.ts`:

- a `<figure>` with a `<figcaption>`; an `<svg role="img">` named by its `<title>` and described by a `<desc>` that states the takeaway worked out from the data;
- a "Show as a table" `<details>` with a real `<table>` (caption, `scope` on every header, every plotted value) at EVERY width; money labels use the short form, tables the full Indian grouping;
- DIRECT labels (no legend to match by colour); series differ by a pattern or a dash AND a label, never by colour alone (WCAG 1.4.1);
- token colours only, each at least 3:1 against the paper (a test reads the hex values from `globals.css`); text at least 14px; strokes at least 2px; tabular numerals; no animation;
- at most 7 bars and 3 line series (a longer list throws).

| Id | Component | Where |
|---|---|---|
| M1 | `ProgressBar` | Collected card |
| M2 | `Sparkline` | Paid on time and SLA cards |
| M3 | `HorizontalBars` | monthly collection below 768px |
| M4 | `HorizontalBars` | ageing, every width |
| C1 | `StackedBars` | monthly collection from 768px (collected solid, outstanding hatched) |
| C3 | `LineChart` | payment curve from 768px (due-day marker dotted, goal dashed) |
| C4 | `LineChart` | weekly SLA from 768px (goal dashed, gaps break the line) |

Below 768px C1, C3 and C4 are not drawn (their wrapper is `hidden md:block`); their numbers are in the text and the tables. Layout: cards one column, two by two from 768px, four from 1280px; sections one column,
two from 1280px; charts full width inside their section.

## Show or hide sections

"Choose sections" (a 48px button at the bottom) opens a sheet with one checkbox per SECTION (five, plain labels, never the cards) and one button, Done. Each choice calls a server action that needs `reports:view`,
refuses a cross-site request (the D83 check), validates with zod (at most five ids from the allowlist, no repeats) and sets the cookie `committee_view`: the hidden ids joined by commas, `Path=/staff`,
`SameSite=Lax`, `HttpOnly`, `Secure` over https, one year, at most 80 bytes. The page reads it and OMITS hidden sections from the HTML. An invalid, oversized or unknown-id cookie is ignored as a whole.
Ticking every section again deletes it. It is **per device and browser**, so on a shared tablet one person's choice reaches the next; there is no database change and no personal data.

## What is absent (v3)

Per-user layouts, export, print views, Marathi and Hindi labels, a history of Total owed (so no "30 days ago"), a login that goes straight to the report, tooltips and any hover or tap behaviour inside a chart, a trend longer than six months or eight weeks, a drill-down for blocks other than the ageing.

## Who and where

| Address | Who | What |
|---|---|---|
| `/staff/reports` | staff with `reports:view` (Meera Kapoor in the seed) | the report. `?period=YYYY-MM` picks the month, `?bucket=not-yet-due\|1-30\|31-60\|61-90\|over-90` opens an ageing drill-down. |
| `/staff` | any active staff | lists "Committee report" for `reports:view`. |

The page calls `requireUser({ need: "reports:view" })` itself; `loadCommitteeReport` and `loadAgeingPage` check the permission again at the data (`StaffAccessError`); the
"Load more" action is built with `withPermissionAction("reports:view")`. A resident, staff without `reports:view` and nobody signed in are turned away
(`tests/server/page-guards.test.ts`, `tests/integration/committee-report.test.ts` RP6, the browser tests in `tests/e2e`). The app role got **no new privilege**: every read is a SELECT on tables it
already reads.

## One source for money

Every money figure comes from `billPosition` through `positionsForFlat` (`src/domain/billing/dues.ts`), the function the Home, the payment lock and the statement import use, so the report
and a resident's Home cannot disagree. `loadReportPositions` (`src/server/reports/positions.ts`) reads the policy, the bills (with their flat's code) and the bill-linked ledger entries in THREE queries
however many flats there are, and builds every position in memory. The business clock decides "as of" (`istDateOf(businessNow())`); a bill issued after that date is not in the positions.

## The metrics and where each is computed

All pure functions are in `src/domain/reports/`; the loaders in `src/server/reports/`. "Paid" means the PRINCIPAL is paid (`position.settledOn` is set: SETTLED or FEE_ONLY).

| Metric | Exact definition | Computed in |
|---|---|---|
| **Period** | A month of the bills' `period`. Options: the months that have bills, none after the business month, newest first. Default: the business month if it has bills, else the newest billed month, else the business month. A month in the address wins (a month with no bills says "No bills for this month") unless it is in the future (ignored). | `src/lib/reports/period.ts` |
| **Billed** | The sum of the amounts of the month's bills (issued on or before the business date). | `moneyLine`, `src/domain/reports/money-line.ts` |
| **Collected** | Principal paid on those bills as of the business date: the bill minus the principal still owed, summed. A late fee is NOT in it and a payment above the bill is not Collected. | `moneyLine` |
| **Still unpaid** | The principal still owed on those bills (the bill amount without late fee). | `moneyLine` |
| **Flats billed / paid in full / with principal outstanding** | A flat has one bill a month, so these count flats. Paid in full: principal all paid (a late fee may still be owed). With principal outstanding: principal still owed. | `moneyLine` |
| **Late fees: posted and paid** | What was paid above the bill on bills whose principal is paid (payments above the bill count toward the fee, D107). | `moneyLine` |
| **Late fees: posted and owing** | The remainder of a posted fee: the FEE_ONLY positions (D107, D110). | `moneyLine` |
| **Late fees: accruing** | The computed fee on bills whose principal is still open: not yet posted (it is posted when the principal is paid, D110). | `moneyLine` |
| **Ageing** | ALL open positions of ALL months (PRINCIPAL_OPEN and FEE_ONLY) as of the business date, in five buckets by the days from the bill's due date to the business date: 0 or less "Not yet due", 1 to 30, 31 to 60, 61 to 90, over 90 (boundaries 0/1, 30/31, 60/61, 90/91). Per bucket: flats (each once), bills, amount due = principal outstanding + fee outstanding. The label says "All open dues, all months". | `ageBucket`, `ageingTable`, `src/domain/reports/age.ts` |
| **Drill-down** | The FLATS of one age group: code, total owed in the group, bills in it, days overdue of the oldest; largest first (default) or oldest first; keyset pages of 25 over a total order; the group's flats and amount for the heading. | `ageingFlats`, `compareFlats`; `src/lib/reports/cursor.ts`; `src/server/reports/ageing-page.ts` |
| **On-time rate (headline, D134)** | The bills of the month paid on or before their due date, out of ALL the month's bills that are due as of the business date (due date on or before it), paid or not: an unpaid bill past its due date counts against it, and a bill whose due date has not come is left out. This is the figure the goal compares. | `collectionQuality` (`due`, `dueOnTime`), `money-line.ts` |
| **On time, of paid bills (secondary)** | Bills paid on or before their due date (whether or not the due date has come), out of the paid bills only. It is shown under the headline and is never the goal's actual. | `collectionQuality` (`paidOnTime`, `paid`) |
| **Median days to pay** | Over the paid bills, days from the issue date to the day the principal was paid; the median takes the lower middle value. | `collectionQuality`, `medianOf` (`stats.ts`) |
| **Share paid late** | Paid bills settled after their due date, out of the paid bills. Still computed (`paidLate`) but no longer shown: it is the other side of "on time". | `collectionQuality` |
| **Complaints raised** | Complaints whose `created_at` falls in the month (India time). | `complaintMetrics`, `src/domain/reports/complaints.ts`; `src/server/reports/complaints.ts` |
| **First reply median / within SLA** | Median whole minutes from raising to `first_response_at`. Within the SLA (D150): MET divided by (MET + MISSED_LATE + MISSED_OPEN), from `slaOutcome`. A first reply AFTER `response_due_at` is MISSED_LATE and is not within the SLA; an unreplied complaint past its due time is MISSED_OPEN; NOT_DUE (unreplied and not yet due, or no due time) is left out. No complaint in the denominator is "No data". | `complaintMetrics` |
| **Time to marked resolved** | Median whole minutes from raising to the FIRST time it was marked resolved (the first STATUS_CHANGED event to PENDING_CONFIRMATION: a reopen clears the complaint's own time, so the event is used). | `complaintMetrics`, `loadComplaintsBetween` |
| **Reopened share** | Of the complaints marked resolved at least once, those with `reopen_count` above zero. | `complaintMetrics` |
| **Closed by whom** | Of the month's complaints: closed by the resident (CONFIRMED), automatically after no reply (AUTO_CLOSED), by the duty manager, with no kind recorded (`other`), and still open: they add up to raised, always (D172). | `complaintMetrics` |
| **Open now** | Complaints of the month whose status is not CLOSED now (the current state, whatever the "as of" date). | `complaintMetrics` |
| **Safety (D171)** | A safety complaint is SEEN when the duty manager acknowledged it (COMMENT event `kind: "ack"`, D149) or closed it. For the month: closed by the duty manager + open and seen + open and not yet seen (+ closed another way) = raised. The time to the first sight is the median from raising to the acknowledgement or the closing, whichever came first. The strip and the line "Open and not yet seen, all months" use the strict fact for OPEN complaints of every month. | `complaintMetrics`; `countUnacknowledgedSafety` |
| **Reconciliation line** | The bank rows of the imports uploaded in the last 30 India days to the business date (on or after the first day of the window) by state: posted automatically, by hand, waiting for a person, waiting for approval, not maintenance; the share automatic is posted automatically out of the rows imported; the accounted check is stored + already imported + refused = read, READ BACK for each import in the window. | `reconciliationLine`, `src/domain/reports/reconciliation.ts`; `src/server/reports/reconciliation.ts` |
| **Manual interventions** | Decisions MANUAL, APPROVED, REJECTED and IGNORE on those rows, by type: count and the median whole minutes from the row's import to the decision. | `reconciliationLine` |
| **Goals** | Three targets against the month's actuals, each Met, Not met or No data, taken on the counts, with the gap in whole points (a miss rounds up, a margin down; D176). Shown next to the metric. | `evaluateGoals`, `gapInPoints` |

A share with a denominator of zero is **"No data"** in words, never 0 percent (`percent` returns null). A share is shown as a whole percent rounded half up.

## The invariants (each has a named test)

| Invariant | Test |
|---|---|
| Billed = Collected + Outstanding, exactly, in paise | RP1 `money-line.test.ts` (2,000 seeded random bill sets); RP2 `committee-report.test.ts` (October, and every seeded month) |
| Flats paid in full + flats with principal outstanding = flats billed | the same |
| Collected never exceeds Billed | the same, and "a payment above the bill is not Collected" |
| The five buckets' amounts and bills add up to the total, and each open position is in exactly one bucket and one set of rows | RP1 `age.test.ts` (2,000 random sets); RP2 (against the Home's own sum over every flat) |
| The figures equal an INDEPENDENT raw SQL query (October as of 27 Oct 2026: Billed, Collected, Outstanding, flat counts, open bills, the bills due and those paid on time, complaints, reconciliation) | RP2 and RP5 `committee-report.test.ts` |
| A FEE_ONLY position is in the ageing and in "posted and owing"; a bill settled late is in Collected and its fee in "posted and paid"; a part payment and a bill with two payments count once | RP3 `committee-report.test.ts`, `money-line.test.ts` |
| No resident name or phone number is in the page (every seeded name and phone is searched for) | RP6 `committee-report.test.ts` |

## The goals

`society_settings.committee_goals` = `{ "onTimeCollectionPercent": 90, "firstReplyWithinSlaPercent": 90, "reopenedPercentMax": 8 }`. They are **assumptions** (R67): on-time collection (the headline rate of D134) and first replies
within the SLA are floors, reopened is a ceiling. The seed writes the row (`COMMITTEE_GOALS` in `src/domain/seed/settings.ts`). A hosted database seeded earlier needs the row inserted ONCE by the owner:
the exact INSERT and a verifying SELECT are step E8 of `docs/deploy-checklist.md` and in `docs/deployment-plan.md`, and `tests/integration/committee-goals-sql.test.ts` runs that text on a freshly seeded
database (it also checks that running it twice is harmless). Until it is inserted, or if the value is invalid, the report shows the same numbers as built-in defaults and says so.
Each goal is shown next to its metric as "Met" or "Not met" in words with an icon (a check or a warning); "No data" has no verdict. The note that the standard starting targets are shown is under the headline cards, only when the setting is unset.

## What is deliberately absent

| Absent | Why |
|---|---|
| A charts **library** | The charts are plain SVG in `src/components/charts/`; no dependency was added. |
| **Export** and **print views** | Not built; the page is read on screen. |
| A per-flat or per-person view | The committee needs the totals; the drill-down shows flat codes only (D132). |
| A drill-down for the other blocks, a notifications list, duplicate linking | Out of this task. |
| Hindi and Marathi | English only (D2). |

## Assumptions (labelled)

- **RC1.** The median of an even count is the LOWER of the two middle values, in whole units (days or minutes rounded down), so a median is always an observed value. SQL's `percentile_disc(0.5)` has the same rule, which is how the tests check it.
- **RC2.** The default month is the business month if it has bills, else the newest billed month (a new month before its bills are issued would otherwise open on an empty page). A future month in the address is ignored.
- **RC3.** "Paid in full" and "with principal outstanding" are about the PRINCIPAL, so they add up to the flats billed; a flat that has paid the principal but owes a late fee is paid in full and is in the fee block ("posted and owing") and the ageing.
- **RC4.** The headline on-time rate is out of ALL bills due so far (D134), so a bill nobody has paid counts against it; a bill not yet due is out of it, even if paid early. The "of paid bills" line and the share paid late are out of the paid bills, so those two add up to 100 percent and the headline does not share their denominator.
- **RC5.** The share of complaints within the SLA is MET out of MET + MISSED_LATE + MISSED_OPEN (D150). A late first reply counts against the SLA. The weekly series and the cards use the same `slaShare`.
- **RC6.** The complaint figures describe the month's complaints in their CURRENT state ("open now", who closed them), not their state on the business date. The seed has no acknowledgement events, so its safety median is "No data".
- **RC7.** The reconciliation window starts 29 days before the business date and has no upper bound, because the import service stamps `uploaded_at` with the real time: under a frozen demo date (`DEMO_AS_OF`) an import made later in real time still counts. On a live clock nothing is newer than the business date.
- **RC8.** The share automatic is posted automatically out of all the rows imported in the window (not out of the rows that were decided).
- **RC9.** A month begins and ends at midnight India time, for the complaints and the imports.
- **RC10.** The drill-down page is taken in memory from the same positions as the report, so "Load more" rebuilds them (about 1.4 s); at most 25 rows are drawn at a time.
- **RC11.** The goals are compared on the counts, so 89.6 percent does not pass a 90 percent target on rounding (R67).
- **RC12.** (R78 to R84 in `docs/assumptions.md`.) The short rupee form rounds half up and carries to "₹1.00 crore" rather than "100.0 lakh"; the payment curve stops at day 45; the weekly chart covers eight ISO weeks; the sections start closed below 768px and the first two shown open from 768px.

## Speed

The whole page data (cards, headlines, the series, the money line, ageing, quality, complaints, reconciliation, goals and the safety alert) builds in about 1.4 s on the seeded 2,400-flat database
(`tests/integration/committee-report-v2.test.ts`, budget 3 s) with TEN database operations however many flats, bills or complaints there are: the policy, the bills and the ledger entries (three), one window of
complaints and their events (two: the selected month, the previous month and the eight weeks are cut from it in memory), the imports, their rows grouped by state and the manual decisions (three), the goals setting, and
the count of safety complaints nobody has acknowledged. The query count is asserted with a counting client extension.

## What is not tested here

The look at 1280px, 768px and 360px is checked in a browser by `tests/e2e/screens/committee-report.spec.ts` (no overflow, 48px targets, focus ring, axe, one h1, the charts and their tables, the keyboard, the sheet and its cookie); a person still has to judge whether it reads well (the commands are in the README, "Reading the committee report"). The render tests
(`tests/ui/committee-*.test.ts`, `tests/ui/charts.test.ts`) check the markup of every block and state; the pure functions are table-driven and property tested (`tests/domain/reports/`); the loaders run as the app role
against raw SQL (`tests/integration/committee-report.test.ts`); the pages in a browser are `tests/e2e/screens/committee-report.spec.ts`. The browser harness starts the server with the `JEV_` classifier variables blank, so that it is the same
whether or not the machine's own `.env` holds provider keys, and sends nothing to a provider. A click is not simulated anywhere: no DOM library is installed and none was added.

## Added in v3: invariants with a named test

| Invariant | Test |
|---|---|
| Safety groups and complaint counts add up (2,000 random sets) | RP4b `tests/domain/reports/complaints.test.ts`; V3 `tests/integration/committee-report-v3.test.ts` (SQL, two dates) |
| Collected within 20 days per month equals SQL; by day 20 never above today | SE2b `series.test.ts`; V3 |
| The Replies card equals the last point of its line | MS1 `monthly-sla.test.ts`; V3; the browser spec |
| Unpaid bills + late fees = Total owed, per group and in total (2,000 sets); towers add up to it | RP1 `age.test.ts`; TW1 `towers.test.ts`; V3; RP7 |
| The drill-down never repeats or skips a flat, in both orders, with ties | RC2 `tests/lib/reports/cursor.test.ts` |
| Text sizes and contrast | TX1 `tests/ui/committee-text.test.ts` |

Mutations that were applied and caught (then restored, diff empty): the Replies line dropping its last point (cards test and V3), the safety breakdown dropping the duty manager's closings (RP4, CB2, RP2, V3), the complaint breakdown dropping a closure kind (RP4, RP4b, RP2, V3), the monthly bars using today's value (VZ1), the drill-down defaulting to oldest first (RC4 and the browser spec) and the age groups not adding up to the total (RP1, SE4, TW1). The seeded database has no FEE_ONLY bill, so the last one is caught by the random sets and not by the integration tests.
