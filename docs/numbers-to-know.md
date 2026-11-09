# Numbers to know

> **Updated 2026-11-09 (final state).** Since this file was written: the committee report is an overview with four section pages and no "Choose sections" (D194, `docs/committee-report.md`); the headline cards have goal bars and no sparklines; the classifier was benchmarked on synthetic data (D195, `docs/classifier-benchmark.md`, `docs/jev-integration.md`). Counts from runs of 2026-11-09: `npm run check` 5196 passed and 1 skipped (the last hook run); the full `npm run e2e` 156 passed, 18 skipped, 1 failed (a stale spec, fixed and re-run alone: passed); the integration tests and `npm run test:ci-parity` were NOT run in this last run. Counts in the body below may lag.


Written 2026-11-07. Thirty numbers an interviewer may ask for. Each row has the value, what it means and the file it comes from. Test counts are from a fresh run on 2026-11-07: `npm run check` (exit 0) and `npm run test:ci-parity` (exit 0, unit then integration suite). Everything else was read from the file named in the row. `UNVERIFIED` means I could not confirm it from the repository.

| # | Number | What it is | Source |
|---|---|---|---|
| 1 | 4203 passed, 1 skipped (4204 in all) | Unit tests in `npm run check`. The one skipped test is `it.skipIf(...)` "writes the set named by BENCHMARK_WRITE". | Fresh `npm run check` run; skip in `tests/domain/matching/benchmark/write-fixtures.test.ts` |
| 2 | 178 files (177 passed, 1 skipped) | Unit test files in that run. | Fresh `npm run check` run |
| 3 | 1035 tests in 71 files, all passed | The integration suite, against a real Postgres, run by `npm run test:ci-parity`. | Fresh `npm run test:ci-parity` run |
| 4 | 20,000 rows | Benchmark size: 2 sets (dev and holdout) of 5 statements of 2,000 rows each (10,000 per set). | `tests/fixtures/benchmark/dev/expected.json`, `tests/fixtures/benchmark/holdout/expected.json` (`rows` 10000 each); each CSV has 2,000 data rows |
| 5 | seeds 101 to 105 and 9001 to 9005 | Dev and holdout statement seeds. | `tests/fixtures/benchmark/dev/`, `tests/fixtures/benchmark/holdout/` file names |
| 6 | dev: 7,311 credits, 298 auto-posted, 298 correct, 0 false; recall 0.1691; auto rate 0.0408 | Pooled dev result. Precision 1. | `tests/fixtures/benchmark/dev/expected.json` (`pooled`) |
| 7 | holdout: 7,269 credits, 312 auto-posted, 312 correct, 0 false; recall 0.1789; auto rate 0.0429 | Pooled holdout result. Precision 1. | `tests/fixtures/benchmark/holdout/expected.json` (`pooled`) |
| 8 | 610 auto-posts, 0 false | Dev 298 plus holdout 312. Gate test: `tests/domain/matching/benchmark/gate.test.ts :: "%s seed %i: falseAuto is 0, precision is 1, the statement is accounted, and the numbers equal the snapshot"`. | Sum of rows 6 and 7 |
| 9 | 8 decision rules, 10 auto conditions | Rules M0 to M7; conditions M4a, M4b, M4c, M4d, M4e, M8, M4g, M4h, M4i, M4j (the condition `M8` is the threshold check). | `src/domain/matching/decide.ts` (`DECISION_RULES`, `AUTO_CONDITIONS`) |
| 10 | 5 candidates | Most candidate flats listed on a queued row. | `src/domain/matching/decide.ts` (`MAX_LISTED_CANDIDATES`) |
| 11 | ₹25,000 (2,500,000 paise) and ₹10,000 (1,000,000 paise) | Second-approver threshold: matcher default, and the demo setting (the seed). | `src/domain/matching/context.ts:8`; `src/domain/seed/settings.ts:28` |
| 12 | 5 to 500 characters | Length of the reason for a manual match, ignore or rejection. | `src/server/statements/manual-core.ts` (`reasonSchema`) |
| 13 | 2,000,000 characters and 20,000 rows | Largest statement the import accepts. Transaction timeout 120,000 ms; lock wait 5 s. | `src/server/statements/import.ts` (`IMPORT_LIMITS`, transaction options) |
| 14 | 106 rows: 25 auto, 43 queued, 38 ignored | The demo sample statement (an illustration, not the benchmark). | `tests/server/sample-statement.test.ts :: "MP8 the mix: 106 rows, 25 posted automatically, 43 queued, 38 ignored, accounted, in well under a second (an illustration, not the benchmark)"` |
| 15 | 79 safety rules: FIRE 20, GAS 17, LIFT_STUCK 21, SHOCK 21 | The word rules, in English, Hindi, Marathi, and the two Latin-letter forms. By language: 20, 20, 18, 13, 8. | `src/domain/complaints/safety.ts` (counted `rule("` lines) |
| 16 | 4000 ms; 3000 ms; 300; 3 and 120 s | Classifier total budget; default per-request provider timeout (500 to 4000 allowed); default daily cap per provider; breaker opens after 3 failures in a row, cooldown 120 s. | `src/server/complaints/classifier.ts:21`; `src/server/complaints/providers/config.ts` (`LIMITS`) |
| 17 | 0.70 and 0.60 | Minimum probability for the top category and for the urgency. Labelled guesses in the code. | `src/domain/complaints/decision.ts:25` |
| 18 | 15, 120, 1,440, 4,320 minutes | First-reply time limit for CRITICAL, HIGH, NORMAL and LOW complaints. | `src/domain/complaints/lifecycle.ts` (`defaultSlaMinutes`); test `tests/domain/complaints/lifecycle.test.ts :: "CL7 response_due_at is the creation time plus the minutes of the urgency, 15 / 120 / 1,440 / 4,320 by default"` |
| 19 | 5 minutes; 7 days; 60 seconds | "No answer yet" clock on a safety report; auto-close and reopen window; repeat-submission window. | `src/domain/complaints/safety-alert.ts`; `src/domain/complaints/lifecycle.ts`; `src/server/complaints/create.ts:30` |
| 20 | 6 digits, 300 s, 5 attempts | One-time code: length, lifetime, wrong guesses allowed per code. | `src/domain/auth/policy.ts` (`authPolicy.otp`) |
| 21 | 30 s; 5 per phone per hour; 30 per address per hour | Code request limits. | `src/domain/auth/policy.ts` |
| 22 | resident 14 days idle, 30 days overall; staff 30 minutes idle (1800 s), 12 hours overall (43200 s) | Session lengths. `last_seen_at` is written at most once per 60 s. | `src/domain/auth/policy.ts` (`authPolicy.session`) |
| 23 | 300 s and 32 characters | Webhook timestamp window; minimum length of a production secret (also must not start `replace-with`). | `src/server/payments/webhook.ts:13`; `src/server/secret-rules.ts` |
| 24 | 1200, 2100, 365 | Late fee: annual rate in basis points (12%), default cap (21%), days in the year. | `src/domain/billing/late-fee.ts:13` |
| 25 | 637000 paise (₹6,370); fee 9800 (₹98); due 646800 (₹6,468); 47 days | Flat T12-0408, bill due 2026-09-10, as of 2026-10-27. | `tests/domain/late-fee.test.ts :: "charges 47 days: exact ₹98.43, fee ₹98, amount due ₹6,468"` |
| 26 | bill 1066000, paid 500000 on 2026-10-12; fee 3800; due 569800; 18 days | Flat T21-1601, bill due 2026-10-09, as of 2026-10-27: 3 days on the full bill, 15 days on the rest. | `tests/domain/late-fee.test.ts :: "splits into 3 days at the full bill and 15 days after the payment: exact ₹38.43, fee ₹38"` |
| 27 | 26 tables; 5 append-only; 7 migrations | Tables in the schema and the privilege matrix; tables with the no-update trigger (`ledger_entries`, `payment_matches`, `complaint_events`, `classifications`, `audit_log`); migration folders. | `prisma/schema.prisma` (`model` count); `src/server/db-roles/app-role.ts` (`APPEND_ONLY_TABLES`); `prisma/migrations/` |
| 28 | 5 permissions; 7 public routes; 33 route files | Staff permissions; routes exported with `publicRoute`; files named `route.ts` under `src/app/api`. | `src/domain/auth/permissions.ts`; `tests/server/route-guards.test.ts`; `find src/app/api -name route.ts` |
| 29 | 2,400 flats; 3,450 complaints (30 safety); 650 paise per sq ft | Seed size and the bill rate. | `src/domain/seed/types.ts` (`TOTAL_FLATS`, `RATE_PAISE_PER_SQFT`); `src/domain/seed/complaints.ts` (`TOTAL_COMPLAINTS`, `SAFETY_COMPLAINTS`) |
| 30 | October as of 2026-10-27: billed 1,805,219,000 paise; collected 1,484,271,400; outstanding 320,947,600; 2399 flats billed, 1915 paid in full, 484 outstanding; 943 open bills owing 618,968,600 paise | Committee report figures for the seed. Billed = Collected + Outstanding. | `tests/integration/committee-report.test.ts :: "the pristine seed gives these October figures, which scripts/smoke-app.mjs also expects (as of 27 Oct 2026): a drift in the seed shows here first"` |

## A few more that come up

| Number | What it is | Source |
|---|---|---|
| 2 deadlock retries | A transaction that deadlocks is re-run up to twice. | `src/server/db-retry.ts:44` (`TRANSACTION_RETRY`) |
| pool 5 (1 to 10); connect 8,000 ms; idle 10,000 ms; query 10,000 ms | Database connection settings. | `src/server/db-options.ts` |
| 30 days | Default age at which stored error events are pruned (1 to 365 allowed). | `src/server/error-prune.ts` |
| 20 per minute | Most error events stored per minute per server instance. | `src/server/error-log.ts` (`MAX_EVENTS_PER_MINUTE`) |
| 13 columns | Columns of `complaints` the app role may UPDATE (the text, flat and safety flag are not among them). | `src/server/db-roles/app-role.ts` |
| 1024 and 4096 characters | Largest payment-start body and webhook body. | `src/server/payments/handlers.ts` |
| 90, 90 and 8 percent | Committee goals: on-time collection 90%, first reply on time 90%, reopened at most 8%. Assumptions, not agreed targets. | `src/domain/reports/goals.ts`; `src/domain/seed/settings.ts` |
| 30 days | The reconciliation window on the committee page. | `src/server/reports/reconciliation.ts:6` |

## Added 2026-11-08 (T10c): the safety benchmark

These rows were read from `tests/fixtures/safety/*/expected.json` and `history.json` after the T10c commits. The test counts in the table above are from 2026-11-07 and are older: a fresh `npm run check` of the T10c commits gave 4,963 passed, 1 skipped.

| Number | What it is | Source |
|---|---|---|
| 46.1% (95% CI 44.8 to 47.5; 2307/5000) | Single-operation recall of the safety words on the NEW holdout (seeds 9401 to 9405), run once after the detector was frozen. Baseline detector on the same texts: 36.6%. | `tests/fixtures/safety/holdout2/expected.json`, `history.json` |
| 20.8% (520/2500) | Double-operation recall on the same holdout (baseline 17.0%). | same |
| 3.4% (54/1594) | False-alarm rate on all benign sentences of that holdout (generated benign sentences: 0 of 1,248; near-miss words 21.7% by design). | same |
| 302 sentences, 71 still hit | Everyday Indian phrasing that overlaps a safety word; hits fell from 88 to 71 after D169. | `src/domain/complaints/safety-benchmark/negatives.ts`, `everyday.test.ts` |
| 10 terms of 5 rules | The bare "current" terms that now need a shock word (D169). | `needsShockContext` in `src/domain/complaints/safety.ts` |

## Numbers that are doc-only or unconfirmed

- The pre-M4j benchmark figures (778 correct, 2 false, recall about 0.44) are in `docs/matching-benchmark.md` only: UNVERIFIED.
- Hosted-service limits (Vercel Hobby, Neon Free) are quoted from vendor pages fetched on 2026-11-06 by an earlier agent, listed in `docs/deployment-plan.md`: UNVERIFIED.
- Seed totals of 3,434 users and 3,429 flat members are quoted from `docs/seed-data.md`, not recounted: UNVERIFIED.
- Why 2399 flats and not 2400 appear in the October figures: UNVERIFIED.
