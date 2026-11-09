# The demo clock

Decision D226 (the live demo runs in demo mode with its business date FIXED at 2026-10-27, so every number matches the client's sample table) and D227 (everything other than the three sample flats is generated data). The code is `src/server/clock.ts`; the tests are `tests/server/clock.test.ts`, `tests/server/demo-note.test.ts`, `tests/ui/demo-note.test.ts`, `tests/integration/demo-date-sample-flats.test.ts` and the readiness tests.

## The rule in one paragraph

Two clocks exist. The BUSINESS clock, `businessNow()`, answers "what day is it for the dues, the replies and the report": it is the real time, unless **both** `DEMO_MODE=true` **and** `DEMO_AS_OF=YYYY-MM-DD` are set, and then it is 12:00 India time on that date. The REAL clock (`Date.now()`, `realNow()`) answers "when did this happen to the machine": sessions, one-time codes, rate limits and the audit log. With `DEMO_MODE` not exactly `true`, `DEMO_AS_OF` is ignored everywhere (tested by `D228 the override exists only in demo mode`, and by a scan that no other source file reads the variable) and `/api/health/ready` says so in a warning.

## Inventory: every use of time

Each row: what it is, the clock, the file and line (read in this session), and what a reviewer sees under `DEMO_MODE=true`, `DEMO_AS_OF=2026-10-27`. "Seen" means I read the page text on a scratch server (database `township_test_clockcoh`, since dropped) after raising two complaints as Swati, paying as Aamir and importing the sample statement as Priya.

| What | Clock | Evidence | What a reviewer sees |
|---|---|---|---|
| Bill position, days overdue, late fee, amount due on the Home | BUSINESS | `src/app/(resident)/page.tsx:15` passes `businessNow()`; `src/server/home/home-data.ts:17` `istDateOf(now)` is the as-of date | T12-0408 47 days, Rs 6,468; T21-1601 18 days, Rs 5,698; T07-1203 nothing due (test `D226 the three sample flats at the demo date`). Seen. |
| The dues sheet (breakdown, "Amount as of ...") | BUSINESS | same data object as the Home (`home-data.ts:29`) | "Amount as of 27 Oct 2026", "Late fee so far, 47 days". |
| Payment attempt: the amount lock and `started_at` | BUSINESS | `src/server/payments/handlers.ts:45` passes `businessNow`; `src/server/payments/initiate.ts:49` (`today`) and `:81` (`startedAt: new Date(now)`) | The attempt starts "at noon on 27 October". |
| Ledger entry date of a successful gateway payment | BUSINESS (taken from the attempt's start) | `src/server/payments/webhook.ts:118` `startedOn = istDateOf(row.startedAt)` | Aamir's Home after paying: "27 Oct Payment received Rs 5,698". Seen. |
| Payment attempt `resolved_at`, the payment audit rows, the mock checkout page | REAL | `src/server/payments/webhook.ts:158`, `src/server/payments/webhook.ts:163`; `handlers.ts:72` (`deps.now()`); `src/app/(demo)/pay/mock/[attemptId]/page.tsx:21` (`realNow()`) | Not shown on any page. In the database `resolved_at` is the real time, later than `started_at`. |
| Committee report: as-of line, months, metrics, ageing | BUSINESS | `src/app/(staff)/staff/reports/page.tsx:27`, `[section]/page.tsx:26`, `actions.ts:14`; `src/server/reports/report-data.ts:79`, `src/server/reports/report-data.ts:97` | "As of 27 October 2026" on the overview and on Complaints. Seen. |
| Complaint `created_at`, event times | BUSINESS | `src/server/complaints/handlers.ts:41` (`clock`); `create.ts:111,124,146` | Every new complaint is stamped 27 Oct, 12:00 pm, however long the reviewer takes. Seen. |
| SLA due time (`response_due_at`) | BUSINESS | `create.ts:109` `responseDueAt(now, ...)` | Normal: "Reply due 28 Oct, 12 pm"; danger: "Reply due today, 12:15 pm" (resident), "Reply due in 15 min" (staff). Seen. |
| "Reply due" wording and the overdue flag on the resident and staff pages | BUSINESS | `src/app/(resident)/complaints/page.tsx:13`, `complaints/[id]/page.tsx:16`, `(staff)/staff/complaints/[id]/page.tsx:17`; `src/lib/staff-complaints/time.ts` | A complaint raised in the demo is never overdue, because the clock does not move (see "Limits"). |
| Staff board views (Needs action, Overdue) and their counts | BUSINESS | `src/app/(staff)/staff/complaints/page.tsx:15`, `actions.ts:24`; `src/server/complaints/board-views.ts:128` | Overdue 3 and Needs action 17 stay the same while the reviewer works. Seen. |
| Staff home | BUSINESS | `src/app/(staff)/staff/page.tsx:13` | Counts as of 27 Oct. |
| Safety acknowledgement time (`first_response_at`) | BUSINESS | `src/server/complaints/safety.ts:35` (`input.now` from `handlers.ts:41`) | The first-response time is stamped 27 Oct, 12:00 pm. |
| Lazy auto-close of resolved complaints | BUSINESS | `src/server/complaints/auto-close.ts:19`, called from `home-data.ts:16` and `handlers.ts` | The waiting period is counted from 27 Oct. |
| Repeat-complaint window (60 seconds) | BUSINESS | `src/server/complaints/create.ts:30`, `src/server/complaints/create.ts:47` | Limit: see below. Seen (same text twice returned the first complaint). |
| Statement import: the as-of date for matching and the late fee | BUSINESS | `src/server/statements/handlers.ts:53`; `reconciliation-handlers.ts:75,83` | The sample read 106 rows, posted 25 and queued 43. Seen. |
| Statement `uploaded_at` ("Last statement: 9 Nov 2026") | REAL (the database default `now()`, `prisma/schema.prisma:403`) | `src/server/staff/home-data.ts:52`; `src/server/statements/ui-data.ts:56`, `src/server/statements/ui-data.ts:218` | An import made in the review shows the real date, after the as-of date. Limit: see below. Seen. |
| Manual match, ignore, approve, reject: audit rows and queue `resolved_at` | REAL | `src/server/statements/reconciliation-handlers.ts:101`, `src/server/statements/reconciliation-handlers.ts:112`, `src/server/statements/reconciliation-handlers.ts:122`, `src/server/statements/reconciliation-handlers.ts:132` (`Date.now()`) | Not shown. The ledger entries a match writes are dated the bank row's date, not this time. |
| Visitor passes ("expected today") | BUSINESS | `home-data.ts:17` as-of date | "2 visitors expected today" for T12-0408. Seen. |
| Notifications (`notifications.created_at`) | BUSINESS for the safety notification | `create.ts:146` | No screen reads it (`docs/known-limitations.md`). |
| `audit_log` of sign-in events | REAL | `src/server/auth/audit.ts:18` (`deps.now()` from `src/server/auth/default-deps.ts:10`) | Not shown. |
| Sessions: creation, last seen, expiry, revoke | REAL | `src/server/auth/session-service.ts:12`, `src/server/auth/session-service.ts:14`, `src/server/auth/session-service.ts:51`, `src/server/auth/session-service.ts:57`, `src/server/auth/session-service.ts:62` | A session lasts in real time. |
| One-time codes: expiry, attempts, the hourly limit | REAL | `src/server/auth/otp-service.ts:51`, `src/server/auth/otp-service.ts:67`, `src/server/auth/otp-service.ts:130` | The code on the login banner expires in real time. |
| Rate limits (code requests) | REAL | `src/server/auth/handlers.ts:57`, `src/server/auth/handlers.ts:72`, `src/server/auth/handlers.ts:85` (`deps.now()`) | "Try again in N seconds" is real seconds. |
| Classifier daily cap | BUSINESS (a documented choice, R54) | `src/server/complaints/providers/factory.ts:25`, `cap.ts:18` | With the date frozen the cap day never changes and the count never resets; the cap is 300 calls. |
| The seed's own dates | CONSTANT | `src/domain/seed/types.ts` (`DEMO_AS_OF`, `DEMO_NOW`) | The seed is always made as of 27 Oct 2026, 12:00 IST, whatever the environment says. |

## The demo note

It is shown on the login screen, the resident Home and the Profile, in demo mode only. The wording depends on whether the clock is frozen:

* Frozen: "This demo's business date is fixed at 27 October 2026 so the numbers match the client's sample table. Sign-in codes and sessions use real time." On the Home a one-line version (under 25 words) sits at the very bottom, below Recent activity, so it cannot push the Pay button down.
* Not frozen (the real date): the note says the data was created as of 27 October 2026, so overdue days and late fees are higher than in the sample table. It names no environment variable and gives no advice to set one.

The staff complaints board has its own one-line demo note ("Demo data is dated 27 October, so replies can look overdue."); it is hidden when the date is frozen, because it would then be false.

## The coherence check (what I read, what I changed)

On a scratch server with `DEMO_MODE=true DEMO_AS_OF=2026-10-27` I raised an ordinary and a danger complaint as Swati, paid as Aamir through the signed webhook, imported the sample statement as Priya, then read the resident Home, the complaints list and complaint page, the staff board and complaint pages, the staff home, the reconciliation home, and the committee overview and Complaints page. Findings:

1. The staff board said "Demo data is dated 27 October, so replies can look overdue" while the date was frozen: false. FIXED: the board shows it only when the clock is not frozen (`src/app/(staff)/staff/complaints/page.tsx`).
2. The login note told every reader to "set DEMO_AS_OF=2026-10-27". FIXED: the note is built from the state; no variable name is shown.
3. The Home had no note at all. FIXED: one line at the bottom.
4. An import shows "Last statement: 9 Nov 2026" (the real upload time) while the as-of line says 27 October. NOT FIXED, listed in `docs/known-limitations.md`: `uploaded_at` is a database default, and the import code is among the audited areas that this round does not change.
5. The same complaint text raised twice returns the first complaint (a 60-second window measured on a clock that does not move). NOT FIXED, listed in `docs/known-limitations.md`; it is the safe direction (no duplicate).
6. A complaint raised in the demo is never overdue and a danger complaint never escalates by time, because the business clock stands still. NOT FIXED by design (this is what "fixed date" means), listed in `docs/known-limitations.md`.

Nothing was found that is in the future of the as-of line apart from item 4, no overdue count jumped, and no ledger date disagreed with the as-of line.

## Production behaviour

With `DEMO_MODE` unset or `false` the business clock is the real clock whatever `DEMO_AS_OF` holds, even an invalid value (tests in `tests/server/clock.test.ts`). `/api/health/ready` reports `config.demoAsOf` (a boolean: demo mode on and the variable set) and, when the variable is set but demo mode is off, a `warnings` list with the word `demoAsOfIgnored`. A warning never changes the status. No value is printed.
