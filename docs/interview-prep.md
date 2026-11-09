# Interview preparation: the 20 hardest questions about this code

Written 2026-11-07. Read `docs/walkthrough.md` first; this file assumes it. Every number, rule name, file path and test name here was copied from the repository and checked in the session that wrote it. A tested claim is written `tests/<folder>/<file>.test.ts :: "exact test name"`; for tests inside a `describe` block only the `it` text is quoted. `UNVERIFIED` means I could not confirm it.

How to use it: say the answer in your own words, in short sentences. Each answer ends with a **Do not claim** line: the honest limit. If an interviewer pushes past the limit, say "I did not build or measure that" and say what you would do next. That is a good answer; an invented one is not.

Test counts come from a fresh run on 2026-11-07: `npm run check` gave 4203 unit tests passed and 1 skipped; `npm run test:ci-parity` then ran the integration suite, 1035 tests in 71 files, all passed.

Groups: A. the matcher (questions 1 to 5). B. the ledger and money (6 to 10). C. the AI and safety path (11 to 15). D. security and concurrency (16 to 20).

---

## A. The matcher

### 1. Why does a flat code on its own not auto-post? Why a second signal?

The matcher auto-posts a bank credit only when it is sure whose payment it is, because a wrong auto-post puts money on the wrong flat with no person looking. A flat code can be a neighbour's code in the narration, and a neighbour can owe exactly the same amount, since most flats have the same bill. So rule M4j (decision D70) asks for a second, independent signal on the same flat: the code and a known UPI id together, or a name that fits the same flat, or an amount that exactly one flat in the whole society owes (`src/domain/matching/decide.ts`). The dev benchmark found 2 false auto-posts before M4j was added, and none after it. The unit test `tests/domain/matching/decide.test.ts :: "a code with none of the three is QUEUE, MEDIUM, with the flat named and the new reason"` pins the behaviour, and `tests/domain/matching/decide.test.ts :: "a name that belongs to another flat does not confirm the code"` pins the other direction.

**Do not claim:** that M4j makes false posts impossible. The two false rows and the pre-M4j counts come from `docs/matching-benchmark.md` only (UNVERIFIED by me). The price was recall, which fell a lot; the document says from about 0.44 to about 0.17.

### 2. What does the benchmark prove, and what does it not?

It proves that on 20,000 simulated bank rows (two sets of 5 statements of 2,000 rows each), the matcher auto-posted 610 credits and none was wrong: dev 298 of 298 correct, holdout 312 of 312 correct (`tests/fixtures/benchmark/dev/expected.json`, `tests/fixtures/benchmark/holdout/expected.json`). It also proves that every statement is "accounted": each row ended in exactly one state. The gate is `tests/domain/matching/benchmark/gate.test.ts :: "%s seed %i: falseAuto is 0, precision is 1, the statement is accounted, and the numbers equal the snapshot"`, and it also demands at least one correct post so a matcher that posts nothing cannot pass. Drift tests regenerate the statements from their seeds and compare byte for byte, so a change to the simulator or the matcher shows up as a failing test. What it does not prove: the data is simulated with the author's weights, not a real bank; with about 7,300 credits per set a false-post rate below roughly 1 in 2,000 would be invisible; and it uses the ₹25,000 default threshold, not the demo's ₹10,000.

**Do not claim:** "99% accurate" or "tested on real bank data". Say "0 false auto-posts in 610 on simulated data, and the dev set was used to add M4j, so the holdout is the cleaner number". That the holdout was run once and never used for tuning comes from its README; I could not prove it from code (UNVERIFIED).

### 3. What is a false auto-post, exactly, and how is it counted?

A false auto-post is a row the matcher posted automatically where the truth was not "this payer pays this bill of this flat". That includes the wrong flat, the wrong bill, and a payer who actually did something else, such as an advance, a part payment, a payment for several bills, a non-maintenance credit or a returned cheque. The evaluator in `src/domain/matching/benchmark/evaluate.ts` compares each auto-matched row with the simulator's truth for flat and bill. The count must be zero in the gate test, and the full metrics are compared with the committed `expected.json`. It matters because the money is already in the ledger when the error is found, and the ledger cannot be edited, so the fix would be a new correcting entry.

**Do not claim:** that the benchmark's idea of truth is the real world's. The truth is what the simulator drew. In the real world there is no truth label unless a person checks.

### 4. Only about 4% of credits are auto-posted. Isn't that a failure?

It is a deliberate trade, and the number is in the benchmark: dev auto rate 0.0408 and recall 0.1691, holdout auto rate 0.0429 and recall 0.1789. The matcher is built so that an unclear row goes to a person and never to the ledger on a guess (rule M5 to M7, the queue). Most simulated payers write a flat code and nothing else, and M4j refuses to post on a code alone. The honest summary is that the matcher removes the clear cases and ranks the rest for staff: of the queued rows that really pay a bill, the true flat is first in the candidates for roughly half to three quarters of them (`top1` 0.52 to 0.62 across statements in `expected.json`). The demo statement shows 25 of 106 rows posted automatically, but it is hand-built to show screens, and the test name says so: `tests/server/sample-statement.test.ts :: "MP8 the mix: 106 rows, 25 posted automatically, 43 queued, 38 ignored, accounted, in well under a second (an illustration, not the benchmark)"`.

**Do not claim:** high automation. Do not quote the demo's 25 of 106 as the expected real rate. The recall figure also counts rows where a neighbour pays someone else's bill, which the matcher is not expected to post (my reading of the simulator; not stated in the docs).

### 5. How do you know no bank row is lost? What if a bill changes while an import runs?

Two layers check it. First, the pure function `accountingReport` in `src/domain/matching/processor.ts` proves each row has one valid state, each auto row has exactly one payment equal to its credit, the summary counts equal a fresh count, and the four states add up to the valid rows. Second, the server's `isAccounted` in `src/server/statements/import.ts` reads the database back and compares it with the processor's books; if they differ it throws `StatementAccountingError` and the whole transaction rolls back. A property test runs 200 random statements: `tests/domain/matching/processor-invariants.test.ts :: "200 random statements, cases from %i (25 each): every row has one state and the statement is accounted for"`. For a bill that changes mid-import (a gateway payment, say), `staleRows` re-reads the bill under its lock and downgrades the row to QUEUED with the reason `STATE_CHANGED`: `tests/integration/statements-import.test.ts :: "a gateway payment committed after the snapshot downgrades the row to QUEUED with STATE_CHANGED, and posts nothing from the bank"`.

**Do not claim:** that every CSV row has a database record. Invalid rows are counted and reported (the first 50 are shown) but not stored as bank rows, so the totals add up through counts. The matcher does not know about payment attempts in progress; the database lock is what protects there.

---

## B. The ledger and money

### 6. Why `BigInt` paise and not decimals or floats?

Floating point numbers cannot hold most decimal amounts exactly, so repeated sums drift; a ledger must add up to the paisa. Integer paise are exact. JavaScript's normal number type is only exact up to 2^53, so the code uses `bigint`, which has no such limit, and the database columns are BIGINT. One helper file, `src/domain/money/money.ts`, does all parsing, rounding and formatting, including Indian grouping (123456 rupees prints as ₹1,23,456, tested in `tests/domain/money.test.ts`). A test writes the largest 64-bit values with raw SQL and reads them back through Prisma unchanged: `tests/integration/bigint.test.ts :: "%s written by raw SQL is read back exactly by Prisma"`. A property test checks that money round-trips through parse and format: the test name in `tests/domain/money.test.ts` is `round trips 2,000 seeded random non-negative values`.

**Do not claim:** that no `Number` touches money anywhere. Day counts use `Number`. The test that scans for `Number(`, `parseFloat`, `toFixed` and `Math` calls covers only `src/domain/billing/working.ts`: `tests/domain/working.test.ts :: "working.ts has no Number(), parseFloat, toFixed or Math calls on money"`.

### 7. Why is the ledger append-only, and can anyone still change it?

An accounting record should only grow. A correction is a new entry (a reversal or an adjustment), so you can always see what was believed and when. The database enforces it with a trigger that raises an error on UPDATE, DELETE and TRUNCATE: `ledger_entries_reject_change`, attached by `ledger_entries_no_update_delete` and `ledger_entries_no_truncate` in the first migration. Tests try all three and check the row is unchanged: `tests/integration/ledger-invariants.test.ts :: "I3 rejects UPDATE and leaves the row unchanged"` and `"I3 rejects DELETE and leaves the row in place"`. The web app also connects as a role that is not the table owner and has only SELECT and INSERT on the ledger, so it cannot drop the trigger: `tests/integration/app-role.test.ts :: "D95 ALTER TABLE ledger_entries DISABLE TRIGGER ALL is denied"`. The table owner can still disable the trigger.

**Do not claim:** "tamper-proof". Say "append-only for the app role, by trigger and least privilege; the owner credential must stay off the server". The integration tests and CI connect as the owner for most tests, so the protection also depends on the deployment configuration, which the repository does not show running (UNVERIFIED that it was deployed).

### 8. How is the late fee computed, and why round once?

It is simple interest: 12% a year (1200 basis points), on the balance of each overdue day, with a fixed 365-day year, even in a leap year. A payment reduces the balance from the day after its date. The function `computeLateFee` (`src/domain/billing/late-fee.ts`) adds up balance times rate for every charged day and divides once at the end, rounding half up to whole rupees. Rounding once matters: for flat T12-0408 the 47 days give an exact ₹98.43 and a fee of ₹98, while rounding each day to ₹2 would give ₹94 (`tests/domain/late-fee.test.ts :: "the fee is the rounding of the exact total, not the sum of rounded days (F1: 47 x ₹2 would be ₹94)"`). The cap is a check, not a clamp: a configured rate above `capBps` throws (`tests/domain/late-fee.test.ts :: "an annualRateBps above capBps throws RangeError"`). The fee is computed when needed and never stored until a payment reaches the principal.

**Do not claim:** that the 21% ceiling cannot be exceeded. It is the default `capBps`; `capBps` itself can be set higher (`tests/domain/late-fee.test.ts :: "accepts the default policy and a cap above 21% (the 21% limit is not enforced here)"`). Do not claim that days with a payment in progress are skipped in the running app: the function supports it but every caller passes `holds: []` (`src/domain/billing/dues.ts`).

### 9. What is the fee-aware dues decision? When is the fee posted?

The fee is not in the ledger while the bill is overdue; it is computed. When a payment brings the principal to zero, `planPosting` (`src/domain/billing/posting.ts`) writes a `LATE_FEE` charge for the fee at that moment and then the `PAYMENT`, once per bill (D110). If a resident pays only the principal, the bill becomes FEE_ONLY: the principal is paid and the posted fee is still owing, and it stops growing (D107). So the amount due is principal plus fee while the principal is open, and the fee alone afterwards. The Home and the payment lock both read one function, `positionsForFlat`, so they cannot disagree: `tests/domain/payments/properties.test.ts :: "lockAmount equals the first open bill of computeDues, in paise"`. A paid fee is never charged twice: `tests/integration/fee-aware-dues.test.ts :: "a principal-only gateway payment on a bill with principal open posts the fee once and leaves a fee-only bill (D110)"`.

**Do not claim:** that a fee can be waived (there is no waiver). Say that a reversed principal payment does not reverse the posted fee, so the bill reopens and the app flags the anomaly `FEE_POSTED_ON_OPEN_BILL` for a person to fix. Do not call the ledger balance "what the resident owes": while principal is open and overdue, it understates the amount due.

### 10. A resident pays a different amount from what is due. What happens?

It depends on the route. Through the app's Pay button the amount is locked to the exact amount due; if the figure moved (for example after midnight, when one more day of fee accrues) the request is refused with `AMOUNT_CHANGED` and nothing is created (`tests/integration/payments-initiate.test.ts :: "an amount that is off by one paise, either way, is AMOUNT_CHANGED"`). Through a bank credit, the matcher auto-posts only an exact amount due, and anything else is queued for a person. A person can post a principal-only payment: it is a `PAYMENT` of the principal plus a `LATE_FEE` for the fee, and the fee stays due (example in the README: T21-1601 pays ₹5,660 and ₹38 stays due; domain test `tests/domain/billing/dues-position.test.ts :: "is a LATE_FEE_DUE position of ₹38 with the working at the settling date"`). A credit above the amount due is refused with `NEEDS_ADVANCE_HANDLING` (422).

**Do not claim:** advance payments, credit balances or refunds. Advances are never auto-posted and have no handling screen; refunds are out of scope (`CLAUDE.md`).

---

## C. The AI and safety path

### 11. What may a model never do in this system?

A model may never decide that something is a safety emergency, and it may never lower an urgency that a rule set. In the code, a model's allowed urgencies are HIGH, NORMAL and LOW only (`MODEL_URGENCIES` in `src/domain/complaints/taxonomy.ts`); an answer that says CRITICAL fails validation: `tests/server/complaints/providers/client.test.ts :: "an answer that says CRITICAL is INVALID"`. The pure decision function treats a safety word as an override that gives CRITICAL by rule even if a model answer was passed in: `tests/domain/complaints/decision.test.ts :: "a safety hit ALWAYS gives CRITICAL, source RULE, escalated, safety flagged and no triage"`. A model also never gets the resident's id, flat or complaint id, only the de-identified text and two questions. A model answer below 0.70 confidence for the top category is never accepted. The database adds one more check, K1: a safety flag requires urgency CRITICAL (`tests/integration/complaints-invariants.test.ts :: "K1 rejects safety_flag with urgency %s"`).

**Do not claim:** that the model is verified to be accurate. The measured result is in `docs/classifier-benchmark.md`: on 200 synthetic complaints the model's category was accepted for 92.5 percent and right on 99.5 percent of those accepted; urgency fails the pre-set bar, so a safety floor applies. The set is synthetic, so say so.

### 12. Why do the rules run before any model?

Because the safest model call is the one that is not made (D9, D73, D119 in `docs/decisions.md`). A model is slow (the whole budget is 4,000 ms), can be down, rate-limited or wrong, and is run by a third party. A word rule is instant, local and deterministic, and it reads the original text, not a de-identified or translated copy. So `src/server/complaints/classify.ts` checks the safety words first, then the resident's declared danger answer, and returns before any provider is called. The test proves it by counting requests: `tests/integration/complaints-providers.test.ts :: "a safety complaint NEVER reaches a provider: zero requests, CRITICAL by rule"`. There are four layers: the rule runs first; the pure decision re-checks it; the database check K1 backs it; and the Yes or No danger question covers words the lists miss.

**Do not claim:** that the lists catch every emergency. The question "Is anyone in danger right now?" exists because they do not (D121).

### 13. How do the provider fallbacks work?

For a normal complaint, `JevClassifier` (`src/server/complaints/providers/classifier-jev.ts`) tries the primary provider (OpenCode), then the secondary (jevmodel.app), making one attempt each and no retries. It skips a provider whose daily cap is used up (default 300) or whose circuit breaker is open (3 failures in a row by default, 120 s cooldown, then one trial request). The total time is capped at 4,000 ms: `tests/server/complaints/providers/classifier-jev.test.ts :: "both providers hang: the total time stays inside the budget and both requests are aborted"`. If both fail, or none is configured, the keyword fallback in `src/domain/complaints/fallback.ts` answers. If the fallback finds nothing, a person triages. A complaint is never refused because a provider failed: `tests/integration/complaints-providers.test.ts :: "both providers down: the keyword fallback answers inside the budget"`. A valid answer that is merely low-confidence goes to a person, not to the fallback.

**Do not claim:** that the live providers work. No real provider was ever called by this work; the protocol is assumed and tests use a local fake server (`docs/classifier-providers.md`). The breaker and cap live in memory per server instance, so on serverless hosting they are not global. A caller's own timeout also counts as a breaker failure (a quirk I found in `classifier-jev.ts`; not tested separately).

### 14. What are the limits of the safety word lists?

There are 79 rules: FIRE 20, GAS 17, LIFT_STUCK 21, SHOCK 21, across English, Hindi, Marathi, Hindi in Latin letters and Marathi in Latin letters (`src/domain/complaints/safety.ts`). They are matched on normalised text, whole words for Latin terms and word starts for Devanagari. Only the first 2,000 characters are read. There is no negation handling on purpose, so "no fire" and "gas bill" still escalate; a false alarm costs a phone call. A spelling nobody listed is missed. The Hindi and Marathi lists were not checked by a native speaker, and the review sheet has an empty "Reviewed by" column that a test requires to stay honest: `tests/domain/complaints/safety-review-doc.test.ts :: "says it is not verified by a native speaker, and has a column for who reviewed it and when, left empty"`. Tests do cover that de-identification never hides a word the rules see: `tests/domain/complaints/purity.test.ts :: "de-identifying a complaint never hides a safety word (the model reads de-identified text, the rules read the original: both must see the same danger)"`.

**Do not claim:** full Hindi or Marathi coverage, or native-speaker review. Say "high recall, unreviewed, easy to extend one line at a time".

### 15. What do you send to an outside provider, and is it anonymous?

Only a de-identified copy of the complaint text, and only for non-safety complaints (`src/server/complaints/classify.ts`). `deidentify` (`src/domain/complaints/deidentify.ts`) replaces e-mail and UPI addresses, links, runs of 10 or more digits, flat codes, honorific-plus-name, and the names of the raiser and everyone on the flat. The request body holds the text and two questions, nothing else: `tests/server/complaints/providers/privacy.test.ts :: "the request body is exactly the model, the given text and the two questions"`. The integration test checks the text sent has no phone, e-mail, flat code or the resident's name: `tests/integration/complaints-create.test.ts :: "CL2 the text sent to the classifier has no phone, e-mail, flat code or the resident's name"`. Provider keys and URLs are never logged: `tests/server/complaints/providers/privacy.test.ts :: "console output after every kind of failure never holds the key, the text, the URL, its query or a response body"`.

**Do not claim:** anonymisation. It cannot remove a name that is not in the flat's list and has no honorific, an address, a building name, a vehicle number, an account number under 10 digits, or a fact in a sentence. Say "reduced, not removed". The operator of the secondary provider is not verified (`docs/classifier-providers.md`).

---

## D. Security and concurrency

### 16. How do you stop one bill being paid twice when the gateway, the bank import and two staff all act at once?

Several layers, all in the database. A partial unique index allows only one unresolved payment attempt per bill (`payment_attempts_one_unresolved_per_bill`). The gateway handler, the bank import and the manual match all take the same transaction-level advisory lock on the bill, `pg_advisory_xact_lock(hashtext(billId))`, through one function, `lockBill` (`src/server/payments/bill-lock.ts`, D104). After taking the lock each re-reads the bill's payments, so the second one sees the first one's payment and becomes an exception or a downgrade. Bills are locked in sorted order, and deadlocks are retried twice (`src/server/db-retry.ts`). A unique index also allows one payment per bank row (`ledger_entries_one_payment_per_bank_row`). Tests: `tests/integration/manual-concurrency.test.ts :: "a gateway success that races a manual post: exactly ONE PAYMENT, the loser is an exception or a refusal (6 rounds)"` and `tests/integration/payments-bill-lock.test.ts :: "when a bank payment on the bill committed first, the gateway success is an exception and posts nothing"`.

**Do not claim:** that the deadlock test exercises the real gateway handler. `tests/integration/deadlock-retry.test.ts` uses hand-written transactions with the lock and retry functions. Do not claim that the "two approvers at once" test uses two different people: it builds the second as a copy of the same user. Two bills can share a lock because `hashtext` is a 32-bit hash; that only makes one wait.

### 17. How is the payment webhook secured, and what makes it idempotent?

The webhook is a public route, so it is authenticated by a signature instead of a login. The signature is a hex HMAC-SHA256 of `<timestamp>.<rawBody>`, compared in constant time, and the timestamp must be within 300 seconds (`src/server/payments/webhook.ts`, `TIMESTAMP_WINDOW_SECONDS = 300`). A tampered body fails, and a genuine but old request is refused: `tests/server/webhook.test.ts :: "an old request replayed after 5 minutes is refused even though its signature is genuine"`. A missing or weak secret in production gives a plain 500 and nothing is processed. Replays inside the window are safe because idempotence is by attempt state: the handler locks the attempt row, and a repeated success is a DUPLICATE that changes nothing: `tests/integration/payments-webhook.test.ts :: "ten parallel success events post exactly once: one POSTED, nine DUPLICATE, two ledger entries, one PAYMENT"`. Unique indexes on the ledger reference and idempotency key are a last backstop.

**Do not claim:** deduplication by event id. The `eventId` is validated and logged, not used to dedupe (D102). Do not claim a real gateway: only the mock exists, and it works only when `DEMO_MODE` is exactly `true`. Webhook timestamps must be whole seconds.

### 18. Why a separate database role for the app, and what can it not do?

The tables are owned by an owner role, and the app connects as `township_app`, which is not the owner. Its privileges are generated from one matrix of 26 tables in `src/server/db-roles/app-role.ts`: SELECT and INSERT on the five append-only tables, column-level UPDATE only where the app really updates (for example 13 named columns on `complaints`, none of them the text or the safety flag), and no DELETE or TRUNCATE anywhere. Because it does not own the tables, it cannot disable the append-only triggers: `tests/integration/app-role.test.ts :: "D95 SET session_replication_role = replica is denied, so triggers cannot be skipped that way"`. A test reads the privileges back from Postgres and compares them with the matrix: `tests/integration/app-role.test.ts :: "D95 the privileges it holds are exactly the matrix, read back from Postgres for every table and privilege"`. A new table with no matrix line fails a test, and `/api/health/ready` reports degraded if the app connects with too much power.

**Do not claim:** that the owner is stopped. The owner can disable the triggers; the protection is that the owner credential never goes to the server. Whether it holds on Neon is not shown: no deployment is evidenced in the repository, and several Neon behaviours are marked unverified in `docs/deployment-plan.md`.

### 19. How do you make sure no route is left unguarded, and how do you handle CSRF?

Every API route file must export each method through `withPermission(need, handler)` or an allowlisted `publicRoute(handler)`. A test reads every route file with the TypeScript compiler and fails if any method is a bare function: `tests/server/route-guards.test.ts :: "every exported method of every route is wrapped, and no route reads the session or cookies itself"`. The public routes are exactly seven, listed in that test (`/api/health`, `/api/health/ready`, `/api/ops/error-test`, the two OTP routes, logout and the payment webhook). A page test does the same for pages and `requireUser`. For CSRF, `csrfBlocked` in `src/server/auth/csrf.ts` refuses a POST, PUT, PATCH or DELETE that is cross-site by `Sec-Fetch-Site` or whose `Origin` host differs from `Host`, and it runs before the session is read: `tests/integration/guard.test.ts :: "D83 the CSRF check comes before the session: a foreign POST with no cookie is 403 CSRF_BLOCKED, not 401"`. The session cookie is also SameSite=Lax.

**Do not claim:** complete CSRF or header protection. A request with no `Origin` and no `Sec-Fetch-Site` is allowed on purpose. No CSP, HSTS or frame-ancestors header is set in the code, and there is no global rate limit. The test guards pages only under `src/app`.

### 20. How is login protected against guessing, and what is weak about it?

The code is 6 digits made without bias, valid for 300 seconds, and stored only as an HMAC with a secret pepper. A request needs 30 seconds since the last one, and a phone gets 5 codes an hour and an address 30 an hour (`src/domain/auth/policy.ts`). Each code allows 5 wrong guesses, counted by one atomic SQL statement so parallel guesses cannot exceed it: `tests/integration/otp-service.test.ts :: "V3 ten concurrent wrong guesses never push attempts past 5 and lose none"`. A registered, inactive and unknown phone get the same answer, so the endpoint does not reveal who has an account. Sessions store only the SHA-256 of a 32-byte token, and staff sessions end after 30 minutes idle or 12 hours overall: `tests/domain/auth/session.test.ts :: "a staff session is 30 minutes idle and 12 hours overall; a resident's is 14 days idle and 30 days overall"`. A revoked session or deactivated user is refused on the next request.

**Do not claim:** production-grade authentication. There is no real SMS sender; the sender is a mock. With `DEMO_MODE=true` the code is returned to the caller, so anyone who knows a demo phone number can log in as that person, staff included. There is no per-account lockout and no limit on the verify route, so an attacker can burn a victim's 5 codes an hour. A fresh code before big approvals is a documented next step and not built.

## Additions, 2026-11-09 (final state)

Facts here come from `src/lib/messages/en.ts` (`committee.def.*`), `docs/decisions.md`, `docs/classifier-benchmark.md`, `docs/jev-integration.md` and `docs/observability.md`. Each answer ends with a "Do not claim" line.

### A1. Why is the on-time rate measured against all bills that are due?

The card counts bills of the month paid in full by the due date, out of ALL that month's bills that are due so far. An unpaid bill past its due date counts against the rate. The "of bills that were paid" figure uses only paid bills, so it ignores the unpaid ones and is always the higher number. Each denominator hides something: the first hides nothing about non-payers but moves as bills fall due; the second hides everyone who has not paid. Do not claim: that the higher figure is the committee's headline, or that either figure predicts next month.

### A2. Why is a safety acknowledgement not "any staff action"?

An earlier version let a plain manager's comment, assignment or status change set the first response time, and the resident was told someone had seen their danger report. That was a defect. Now only the duty manager's acknowledge action records the acknowledgement (D149), and a safety complaint also counts as seen when the duty manager closed it. Do not claim: that the earlier defect never reached a user; it was found in review, and no real resident used the app.

### A3. Where do you look when something fails in production, and why can only the developer read the log?

Each error page shows a reference. The developer looks the reference up with `npm run logs:errors` using a separate read-only logs role (`docs/observability.md`). The app's own database role can insert error rows but cannot read them, so a stolen app credential cannot read the log. Do not claim: that errors are always stored; the store is best effort and flood-limited in memory per server instance (R73).

### A4. Why was a fifth safety category added?

The first four categories were fire, gas, a stuck lift and shock. A test sentence about someone being killed was not escalated, so MEDICAL_VIOLENCE was added (D153) with words such as ambulance, unconscious, bleeding and stabbed. Its limits: words, not meaning, and everyday phrases that use these words can raise a false alarm. Do not claim: that it finds every emergency.

### A5. What does the safety benchmark measure, and what does it not prove?

It damages known safety phrases with typing errors and checks whether the detector still hits, and it checks benign sentences for false alarms. Fresh run: 46.14% of single-damage misspellings found on the newest holdout (2307 of 5000), 20.80% with two damages, 3.39% false alarms on its negatives (54 of 1594). It proves nothing about real residents' writing, and there is no pass threshold. Do not claim: that safety detection is robust to misspellings; the declared-danger question and the Emergency control are the main safety nets.

### A6. Why do phones get simple visuals and laptops get charts, and why an overview with section pages?

A phone is for checking status and a laptop for investigating. A phone shows the headline cards and bars; the line charts and columns appear from 768px. A long page of nine cards served neither use, so the report became an overview with four section pages (D194). Do not claim: that the structure was tested with committee members; the audit was a document review.

### A7. What does Jev do in the complaint flow, what may it never do, and what does the benchmark show?

After the safety rules and de-identification, a provider returns a category and an urgency as probabilities. The app accepts them only above 0.70 and 0.60. A model can never produce CRITICAL, and a safety complaint never reaches a provider. On failure the keyword fallback answers or a person does. The synthetic benchmark of 200 items showed 92.5% accepted and 99.5% right among the accepted on the primary provider, and the second provider answered none of 60 requests (`docs/classifier-benchmark.md`). Do not claim: that these numbers are accuracy on real complaints, that urgency is reliable (it failed the bar), or that Hindi and Marathi are verified (no native speaker reviewed the data).
