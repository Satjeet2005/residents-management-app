# Known limitations

Written 2026-11-08. This is the candid list, built from the "Risks", "not built" and "deliberately absent" sections of the other documents. Each row was checked
against the repository on that date; a row for something that has since been built was dropped. "Effort" is a rough guess for one developer: S is under a day,
M is one to three days, L is more than three days.

## What the demo is

A take-home demo: fictional data, a mocked SMS sender and a mocked payment gateway, on free hosting. It is built to show correct money, a clear structure and
honest limits, not to run a real township tomorrow.

## Money and payments

| Limitation | Why it exists | Impact | What would fix it | Effort |
|---|---|---|---|---|
| The payment gateway is a mock (the demo checkout page and a signed webhook); nothing is charged | A real gateway needs a merchant account and a live key | A resident can "pay" with no money moving; the live ledger gains entries | A gateway adapter behind the same signed-webhook interface (`docs/payments-design.md`) | M |
| Payment hold and release states are not built: PROCESSING, UNKNOWN and RELEASED attempts, "no Pay again during a hold", the 24-hour escalation to accounts, "Contact accounts" (D33, D36, D47 to D53) | Deferred to keep the main flow correct; the repository records them as decisions (D33, D36, D47 to D53) and a state machine that refuses to auto-post them (any edge-case timelines for them are not in the repository: UNVERIFIED here) | An attempt that never gets a gateway answer stays INITIATED; a person has to decide it; skipped late-fee days while an attempt is unresolved are not applied (the dues pass no holds) | The screens and an escalation job on the existing state machine | L |
| Late-fee waivers are not built (D107) | A waiver is a separate approved workflow | A fee stays owing until paid | An approval workflow with a reason and a second approver, writing a ledger adjustment | M |
| Advance payments and one payment for several bills are queued, never posted automatically (`NEEDS_ADVANCE_HANDLING`) | Auto-posting an unclear amount could misstate dues | Staff post these by hand or not at all; there is no advance-credit balance | An advance-credit rule and a multi-bill plan in the domain layer, with tests | M |
| No undo of a posting | A correction is a new, reviewed ledger entry (the ledger is append-only) | A wrong manual match can only be corrected by a later entry, and no screen does that yet | A reversal screen with a reason and a second approver | M |
| Refunds are not executed (out of scope), and a duplicate payment has no handling screen | Out of scope in `CLAUDE.md` | A duplicate or late success becomes an accounts exception, not a refund | A refund workflow and a bank-side step | L |
| A bank payment for the late fee of a fee-only bill is queued (S11 in `docs/statement-import-design.md`) | Matching it needs a matcher change | A person posts it | A matcher rule with benchmark cases | S |
| The matching benchmark is synthetic: statements are made by a simulator from the demo data (`docs/matching-benchmark.md`) | There is no real bank statement to test on | The measured rates (about 4 percent of credits posted automatically on the benchmark; no wrongly posted credit) describe the simulator, not a real society | Run on real, de-identified statements | M |
| The demo sample statement is an illustration, not a measurement (25 of 106 rows posted automatically) | It is made to show every kind of row | It would mislead if quoted as a hit rate | Quote the benchmark, not the sample | S |

## Complaints and safety

| Limitation | Why it exists | Impact | What would fix it | Effort |
|---|---|---|---|---|
| Hindi and Marathi screens are not built (English only, D2) | Time | Residents who read only Hindi or Marathi cannot use the screens; complaints written in those languages are still read by the safety rules | Translated strings (optional and flagged in `CLAUDE.md`), reviewed by a native speaker | L |
| The Hindi, Marathi and romanised safety word lists have NOT been reviewed by a native speaker (`docs/safety-words-review.md`) | The agent wrote them; the review is the human's to arrange | A wrong or missing word can miss a real emergency or raise a false alarm | The native-speaker review recorded in that file's review column | M |
| The fifth safety category (medical and violence, D153) is a human-added extension of the brief's four; its false positives are accepted (`docs/decisions.md`, `docs/complaint-classification.md`) | The rule list favours catching too much | More phone calls to the duty manager; words such as "blood" in a non-incident message escalate | Tune after review | S |
| How robust safety detection is to misspellings is not measured; no safety benchmark document exists (`docs/safety-benchmark.md` is absent) | Phase C of the final run is not done | Unusual spellings, spacing and typed-in-Latin Hindi may slip past the rules | A labelled misspelling set and a measured miss rate | M |
| The classifier's accuracy is not benchmarked (D86, D87 describe the plan and the bar; the thresholds are the starting guesses R36 to R38) | The benchmark has not been run | Without model keys the keyword fallback classifies every complaint; with keys the accuracy is unknown | Run the benchmark and set the thresholds | M |
| Duplicate-complaint linking and "affects me too" are not built (the events exist and are never shown) | Out of this build | Several residents report the same leak as separate complaints | A linking screen and a resident control | M |
| The notifications bell and list are not built (D22, D55); the safety notification is a database row no screen reads | A half-built affordance misleads, so it is absent | A resident learns of an update only by opening the page | A bell and a list | M |
| There is no real notification delivery: the outbox table exists, but nothing processes it (`processOutbox()` of `CLAUDE.md` is not implemented), and no cron route exists | No SMS or e-mail provider; the free tier has no worker | Nothing is ever sent; the 24-hour hold escalation and daily jobs do not run | An idempotent processor, a daily Vercel cron and a provider | M |
| Breaker, daily cap and flood protection are per serverless instance, in memory (D141, R56, `docs/observability.md`) | A database table for them would add load for little gain | The real number of provider calls can exceed the cap; flood limits are per instance; a cold start resets them | Move the counters to a shared store | S |

## Operations and platform

| Limitation | Why it exists | Impact | What would fix it | Effort |
|---|---|---|---|---|
| An error cannot be stored when the database is down | The error log is in the same database | Only the stdout line remains (one hour on Vercel Hobby) | A log drain or an error service (`docs/observability.md`) | M |
| Vercel Hobby: non-commercial terms, and runtime logs kept for 1 hour | Free plan | The live demo may be paused; older log lines are gone, so look in `error_events` | A paid plan or another host | S |
| Neon Free: 1 GB storage, 100 compute-hours a month, sleep after 5 idle minutes | Free plan | A cold first request is slower; a busy month could suspend compute | Monitor usage; a paid plan | S |
| The hosted ledger is append-only, so every demo payment consumes demo data | The ledger rules are the point of the app | After reviewers pay, the sample bills are settled and the numbers move | The owner-only reset in `docs/hosted-reset-procedure.md`, run last | S |
| The live site uses today's date, the seed is dated 27 October 2026 | `DEMO_AS_OF` must stay unset on a live site | The live numbers differ from the brief's sample table and some replies look overdue | Re-seed on the review day, or use `DEMO_AS_OF` locally | S |
| Demo mode shows the login code to anyone who knows a demo phone | The brief allows mocked SMS | Anyone can sign in as any seeded user, including staff | `DEMO_MODE=false` and a real SMS sender | M |
| `npm run smoke:app` is out of date: against a build of the current code it ended `21 OF 162 CHECKS FAILED` (2026-11-08, scratch database, `--as-of=real`); the failing checks look for the text of the committee report and the staff complaints board before their redesigns | The script was last changed on 2026-11-07, before the report v2 and the staff board v2; the browser specs (`tests/e2e`) replaced it for those screens | A reviewer who runs it sees red that is not a money or security fault; it also mutates data, so it is never run on the live site | Update the expected text of the report and the board checks (a test-script change) | S |
| Only Chromium is tested in a real browser (D146) | One browser keeps the check fast | Firefox and Safari layouts are not verified; no real iPhone was used | Add the other Playwright browsers | S |
| The service worker caches only the offline page and the icons (D147) | A cache outlives a logout | The app is installable but not an offline app; offline shows only "You're offline" | None wanted for money screens | n/a |
| The committee view choice is a cookie, per device and browser (D157) | No personal data and no database change | A person sees their own layout only on that device | A stored per-user layout | S |
| No export or print view of the committee report; the report has no per-flat or per-person view | Out of this build | The committee reads it on screen | Export and print views | M |
| Staff admin UI, gate visitor flow, amenity booking and multi-flat residents are out of scope | `CLAUDE.md` | Permissions are seeded; a resident has one flat | Separate features | L |
| The security items in `docs/security.md` ("What is NOT built") | Scope and the free tier | Real SMS, strong staff authentication, encryption, retention, monitoring, backups with tested restores and penetration testing are all absent | See that table | L |
