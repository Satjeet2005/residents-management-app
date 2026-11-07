# The committee report (T14)

A read-only page for the committee, `/staff/reports`: collections, what is owed, complaint handling and the bank reconciliation line, computed live from the
database when the page opens. It shows no resident name and no phone number. Decisions: D131 (computed live from bill positions, the Home's function), D132 (no
names) and D133 (the goals are assumptions in a setting), with D5, D6, D13, D26, D35, D107, D110 and D116 behind them (`docs/decisions.md`). The look is Passbook
(`docs/design-system.md`); the screens follow `docs/staff-ui.md` and `docs/staff-complaints-ui.md`. Every string is in `src/lib/messages/en.ts` (`committee.*`).

There was no wireframe to look at: `docs/design/` holds the Passbook images and no committee dashboard. The page follows the brief's structure.

## Who and where

| Address | Who | What |
|---|---|---|
| `/staff/reports` | staff with `reports:view` (Meera Kapoor in the seed) | the report. `?period=YYYY-MM` picks the month, `?bucket=not-yet-due\|1-30\|31-60\|61-90\|over-90` opens an ageing drill-down. |
| `/staff` | any active staff | lists "Committee report" for `reports:view`. |

The page calls `requireUser({ need: "reports:view" })` itself; `loadCommitteeReport` and `loadAgeingPage` check the permission again at the data (`StaffAccessError`); the
"Load more" action is built with `withPermissionAction("reports:view")`. A resident, staff without `reports:view` and nobody signed in are turned away
(`tests/server/page-guards.test.ts`, `tests/integration/committee-report.test.ts` RP6, `scripts/smoke-app.mjs`). The app role got **no new privilege**: every read is a SELECT on tables it
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
| **Outstanding** | The principal still owed on those bills. | `moneyLine` |
| **Flats billed / paid in full / with principal outstanding** | A flat has one bill a month, so these count flats. Paid in full: principal all paid (a late fee may still be owed). With principal outstanding: principal still owed. | `moneyLine` |
| **Late fees: posted and paid** | What was paid above the bill on bills whose principal is paid (payments above the bill count toward the fee, D107). | `moneyLine` |
| **Late fees: posted and owing** | The remainder of a posted fee: the FEE_ONLY positions (D107, D110). | `moneyLine` |
| **Late fees: accruing** | The computed fee on bills whose principal is still open: not yet posted (it is posted when the principal is paid, D110). | `moneyLine` |
| **Ageing** | ALL open positions of ALL months (PRINCIPAL_OPEN and FEE_ONLY) as of the business date, in five buckets by the days from the bill's due date to the business date: 0 or less "Not yet due", 1 to 30, 31 to 60, 61 to 90, over 90 (boundaries 0/1, 30/31, 60/61, 90/91). Per bucket: flats (each once), bills, amount due = principal outstanding + fee outstanding. The label says "All open dues, all months". | `ageBucket`, `ageingTable`, `src/domain/reports/age.ts` |
| **Drill-down** | The open positions of one bucket, oldest first, then flat code, then bill id; flat code, bill month, days overdue, amount due; keyset pages of 25 (an opaque cursor over that order). | `ageingRows`; `src/lib/reports/cursor.ts`; `src/server/reports/ageing-page.ts` |
| **On-time rate (headline, D134)** | The bills of the month paid on or before their due date, out of ALL the month's bills that are due as of the business date (due date on or before it), paid or not: an unpaid bill past its due date counts against it, and a bill whose due date has not come is left out. This is the figure the goal compares. | `collectionQuality` (`due`, `dueOnTime`), `money-line.ts` |
| **On time, of paid bills (secondary)** | Bills paid on or before their due date (whether or not the due date has come), out of the paid bills only. It is shown under the headline and is never the goal's actual. | `collectionQuality` (`paidOnTime`, `paid`) |
| **Median days to pay** | Over the paid bills, days from the issue date to the day the principal was paid; the median takes the lower middle value. | `collectionQuality`, `medianOf` (`stats.ts`) |
| **Share paid late** | Paid bills settled after their due date, out of the paid bills. | `collectionQuality` |
| **Complaints raised** | Complaints whose `created_at` falls in the month (India time). | `complaintMetrics`, `src/domain/reports/complaints.ts`; `src/server/reports/complaints.ts` |
| **First reply median / within SLA** | Median whole minutes from raising to `first_response_at`. Within the SLA: replied by `response_due_at`, out of the complaints whose reply is decided: replied, or unreplied and already past the due time (unreplied and not yet due are left out). | `complaintMetrics` |
| **Time to marked resolved** | Median whole minutes from raising to the FIRST time it was marked resolved (the first STATUS_CHANGED event to PENDING_CONFIRMATION: a reopen clears the complaint's own time, so the event is used). | `complaintMetrics`, `loadMonthComplaints` |
| **Reopened share** | Of the complaints marked resolved at least once, those with `reopen_count` above zero. | `complaintMetrics` |
| **Closed by the resident / by itself** | Of the complaints now closed: `close_kind` CONFIRMED, and AUTO_CLOSED (D15, D120). A closure by the duty manager is in neither. | `complaintMetrics` |
| **Open now** | Complaints of the month whose status is not CLOSED now (the current state, whatever the "as of" date). | `complaintMetrics` |
| **Safety** | Safety complaints raised; the median whole minutes to the first acknowledgement (a COMMENT event with `kind: "ack"`); and those not closed with no acknowledgement. | `complaintMetrics`, `loadMonthComplaints` |
| **Reconciliation line** | The bank rows of the imports uploaded in the last 30 India days to the business date (on or after the first day of the window) by state: posted automatically, by hand, waiting for a person, waiting for approval, not maintenance; the share automatic is posted automatically out of the rows imported; the accounted check is stored + already imported + refused = read, READ BACK for each import in the window. | `reconciliationLine`, `src/domain/reports/reconciliation.ts`; `src/server/reports/reconciliation.ts` |
| **Manual interventions** | Decisions MANUAL, APPROVED, REJECTED and IGNORE on those rows, by type: count and the median whole minutes from the row's import to the decision. | `reconciliationLine` |
| **Goals** | Three targets against the month's actuals, each Met, Not met or No data, taken on the counts. | `evaluateGoals`, `src/domain/reports/goals.ts` |

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
Each goal row has the target, the actual and "Met" or "Not met" in words with an icon (a check or a warning); "No data" has none.

## What is deliberately absent

| Absent | Why |
|---|---|
| **Charts** and any charts library | The ageing is a segmented bar of plain elements with the numbers beside it; the task asked for no library. |
| **Export** and **print views** | Not built; the page is read on screen. |
| A trend over months, a per-flat or per-person view | The committee needs the totals; the drill-down shows flat codes only (D132). |
| A drill-down for the other blocks, a notifications list, duplicate linking | Out of this task. |
| Hindi and Marathi | English only (D2). |

## Assumptions (labelled)

- **RC1.** The median of an even count is the LOWER of the two middle values, in whole units (days or minutes rounded down), so a median is always an observed value. SQL's `percentile_disc(0.5)` has the same rule, which is how the tests check it.
- **RC2.** The default month is the business month if it has bills, else the newest billed month (a new month before its bills are issued would otherwise open on an empty page). A future month in the address is ignored.
- **RC3.** "Paid in full" and "with principal outstanding" are about the PRINCIPAL, so they add up to the flats billed; a flat that has paid the principal but owes a late fee is paid in full and is in the fee block ("posted and owing") and the ageing.
- **RC4.** The headline on-time rate is out of ALL bills due so far (D134), so a bill nobody has paid counts against it; a bill not yet due is out of it, even if paid early. The "of paid bills" line and the share paid late are out of the paid bills, so those two add up to 100 percent and the headline does not share their denominator.
- **RC5.** The share of complaints within the SLA is out of the complaints whose reply is decided (replied, or unreplied past the due time).
- **RC6.** The complaint figures describe the month's complaints in their CURRENT state ("open now", who closed them), not their state on the business date. The seed has no acknowledgement events, so its safety median is "No data".
- **RC7.** The reconciliation window starts 29 days before the business date and has no upper bound, because the import service stamps `uploaded_at` with the real time: under a frozen demo date (`DEMO_AS_OF`) an import made later in real time still counts. On a live clock nothing is newer than the business date.
- **RC8.** The share automatic is posted automatically out of all the rows imported in the window (not out of the rows that were decided).
- **RC9.** A month begins and ends at midnight India time, for the complaints and the imports.
- **RC10.** The drill-down page is taken in memory from the same positions as the report, so "Load more" rebuilds them (about 1.4 s); at most 25 rows are drawn at a time.
- **RC11.** The goals are compared on the counts, so 89.6 percent does not pass a 90 percent target on rounding (R67).

## Speed

The whole page data (money line, ageing, quality, complaints, reconciliation, goals and a drill-down page) builds in about 1.4 s on the seeded 2,400-flat database (`tests/integration/committee-report.test.ts`, budget 6 s).
Nine queries, however many flats, bills or complaints there are: the policy, the bills, the ledger entries, the month's complaints and their events, the imports, their rows grouped by state, the manual decisions and the goals setting.

## What is not tested here

The look at 1280px and 360px, where focus lands and how the grid wraps need a person and a browser (the commands are in the README, "Reading the committee report"). The render tests
(`tests/ui/committee-*.test.ts`) check the markup of every block and state; the pure functions are table-driven and property tested (`tests/domain/reports/`); the loaders run as the app role
against raw SQL (`tests/integration/committee-report.test.ts`); the page over HTTP is `scripts/smoke-app.mjs`. The smoke starts the server with the `JEV_` classifier variables blank, so that it is the same
whether or not the machine's own `.env` holds provider keys, and sends nothing to a provider. A click is not simulated anywhere: no DOM library is installed and none was added.
