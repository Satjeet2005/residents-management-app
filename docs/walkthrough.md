# Walkthrough: how the Township app works, area by area

> **Updated 2026-11-09 (final state).** Since this file was written: the committee report is an overview with four section pages and no "Choose sections" (D194, `docs/committee-report.md`); the headline cards have goal bars and no sparklines; the classifier was benchmarked on synthetic data (D195, `docs/classifier-benchmark.md`, `docs/jev-integration.md`). Counts from runs of 2026-11-09: `npm run check` 5196 passed and 1 skipped (the last hook run); the full `npm run e2e` 156 passed, 18 skipped, 1 failed (a stale spec, fixed and re-run alone: passed); the integration tests and `npm run test:ci-parity` were NOT run in this last run. Counts in the body below may lag.


Written 2026-11-07 from the repository (branch `master`, after commit 9efa6d6). Every number, rule name, file path and test name below was copied from the repository and checked in the session that wrote this file.

How to read it:

- A tested claim is written `tests/<folder>/<file>.test.ts :: "exact test name"`. For tests that sit inside a `describe` block, only the `it` text is quoted.
- `path:line` points at the line that was read when this was written. Lines move; the symbol name next to it is the stable part.
- `UNVERIFIED` means I could not confirm it from the repository. I did not guess.
- Where an older document disagreed with the code, this file follows the code. The list is in the section "Where documents and code disagree" at the end.
- "Pure function" means a function that only computes an answer from its inputs. It touches no database, no clock, no network. Pure functions live in `src/domain/**` and are easy to test.
- "Enforced" means what stops the bad thing from happening. "Tested" means which test fails if that protection is removed.

Test counts used in this guide come from a fresh run on 2026-11-07: `npm run check` (lint, typecheck, unit tests) exited 0 with 4203 unit tests passed and 1 skipped, in 177 passed files and 1 skipped file. `npm run test:ci-parity` exited 0 and ran the same unit tests, then the integration suite: 71 files, 1035 tests passed. The one skipped test is `it.skipIf(...)("writes the set named by BENCHMARK_WRITE", ...)` in `tests/domain/matching/benchmark/write-fixtures.test.ts`; it only runs when someone asks to regenerate the benchmark fixtures.

---

## 1. Login and sessions

**What it does.** A person types a 10-digit Indian mobile number and gets a 6-digit one-time code. In the demo the code is returned in the API answer for demo phones, because the SMS sender is a mock that sends nothing (`mockOtpSender`, `src/server/auth/otp-service.ts`). The server stores only a keyed hash of the code, and when the code is right it creates a database session; the browser keeps only a random token, and the server stores only the hash of that token. Staff sessions are short (30 minutes idle, 12 hours overall) because staff can move money.

**Open these 5 files first.**

1. `src/domain/auth/policy.ts`: every login and session number in one object, `authPolicy`.
2. `src/domain/auth/otp.ts`: how a code is made without bias, the request limits and the attempt rules (all pure).
3. `src/server/auth/otp-service.ts`: `requestOtp` and `verifyOtp`, including the one-statement SQL that counts attempts.
4. `src/server/auth/session-service.ts` and `src/server/auth/cookie.ts`: create, read and revoke sessions; cookie name and flags.
5. `docs/auth-design.md`: the design and the threat table (read it with the disagreement list at the end of this file).

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| Every 6-digit code is equally likely (no modulo bias). | Pure `otpFromRandom` in `src/domain/auth/otp.ts` only accepts a random 32-bit word below the largest multiple of 10^6 that fits; it throws after `MAX_REJECTED_WORDS = 1000` (`otp.ts:7`). | `tests/domain/auth/otp.test.ts :: "skips a word at or above the limit and uses the next one"` |
| The code is never stored in clear. | `codeHash` is HMAC-SHA256 with a secret pepper (`src/server/auth/crypto.ts`). | `tests/integration/otp-service.test.ts :: "V1 the plain code is in no text column of otp_codes, audit_log or sessions, and in no log call"` |
| In production a missing, short or placeholder pepper stops everything. | `src/server/auth/crypto.ts` and `src/server/secret-rules.ts` (`MIN_SECRET_LENGTH` 32, prefix `replace-with`). | `tests/integration/auth-routes.test.ts :: "V7 in production with the pepper missing or short, the first use throws and nothing is written"` |
| Request limits: 30 s between codes, 5 per phone per hour, 30 per address per hour. | Pure `evaluateOtpRequest` in `otp.ts`; numbers in `policy.ts`. | `tests/domain/auth/otp-rules.test.ts :: "allows exactly at the cooldown (30,000 ms) and not at 29,999 ms"` and `tests/integration/otp-service.test.ts :: "V2 a phone may ask 5 times an hour; the 6th is PHONE_LIMIT with the wait until the first leaves the hour"` |
| A refused request is not stored, so a blocked client cannot extend its own wait. | `otp-service.ts` returns before any insert. | `tests/integration/otp-service.test.ts :: "V2 a refused request is not recorded, so it cannot lengthen the wait"` |
| An unknown, inactive and known phone get the same answer shape. | `requestOtp` stores a row for all of them and calls the sender only for an active user. | `tests/integration/otp-service.test.ts :: "V1 a registered and an unregistered phone get identical answers"` |
| Only the newest code is valid. | `requestOtp` retires older unused codes in the same transaction. | `tests/integration/otp-service.test.ts :: "V3 an older code is rejected after a newer request"` |
| At most 5 guesses per code, even in parallel. | SQL `UPDATE otp_codes SET attempts = attempts + 1 ... WHERE attempts < 5 RETURNING` in `otp-service.ts`; database check `otp_codes_attempts_bounded` (migration `20261106040000_otp_request_ip_hash_and_attempt_bounds`). | `tests/integration/otp-service.test.ts :: "V3 ten concurrent wrong guesses never push attempts past 5 and lose none"` |
| A code works once. | Conditional `UPDATE ... WHERE consumed_at IS NULL ... RETURNING` in `otp-service.ts`. | `tests/integration/otp-service.test.ts :: "V3 two concurrent uses of one right code succeed once"` |
| A code expires at exactly its time (300 s). | Pure `evaluateOtpAttempt` (`now >= expiresAt`). | `tests/domain/auth/otp-rules.test.ts :: "expires at exactly expiresAt, and not one millisecond before"` |
| The demo code is shown only when `DEMO_MODE` is exactly `true` and the phone starts with 5. | `otp-service.ts`, `src/domain/auth/phone.ts`. | `tests/integration/otp-service.test.ts :: "V1 DEMO_MODE=%j gives no demoCode"` |
| Session lengths by role: resident 14 days idle and 30 days overall; staff 30 minutes idle and 12 hours overall. | `authPolicy.session` in `policy.ts`; pure `evaluateSession` in `src/domain/auth/session.ts`. | `tests/domain/auth/session.test.ts :: "a staff session is 30 minutes idle and 12 hours overall; a resident's is 14 days idle and 30 days overall"` |
| Only the hash of the session token is stored. | `newSessionToken` in `crypto.ts` (32 random bytes); `session-service.ts` stores SHA-256. | `tests/integration/session-service.test.ts :: "V4 stores only the hash: the raw token is nowhere in the database"` |
| A revoked session or a deactivated user is refused on the very next request. | `resolveSession` reads `revoked_at` and `users.active` on every request. | `tests/integration/authorization-matrix.test.ts :: "a revoked session is rejected on the very next request"` |
| The cookie is `__Host-session` and Secure over https; plain `session` over http; always HttpOnly and SameSite=Lax. | `src/server/auth/cookie.ts` (D94). | `tests/server/cookie.test.ts :: "is __Host-session, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain"` |
| Client address headers are trusted only on Vercel. | `src/server/auth/client-ip.ts` (`VERCEL === "1"`). | `tests/server/client-ip.test.ts :: "does not trust the headers when env is %j"` |

**Key numbers** (all in `src/domain/auth/policy.ts` unless noted): OTP 6 digits; lifetime 300 s; 5 attempts per code; 30 s cooldown; 5 codes per phone per hour; 30 per address per hour; resident idle 14 days, overall 30 days; staff idle 1800 s, overall 43200 s; `last_seen_at` written at most once per 60 s. Session token: 32 bytes, 43 base64url characters (`crypto.ts`, `cookie.ts`). Request body at most 4,096 characters (`src/server/auth/schemas.ts`). Five permissions (`src/domain/auth/permissions.ts`).

**Failure modes.**

- Wrong, expired, used, old or unknown-phone code: HTTP 400 `OTP_NOT_ACCEPTED`. The 5th wrong guess gives `OTP_LOCKED`.
- Too many requests: 429 `TOO_MANY_REQUESTS` with `Retry-After`.
- Pepper missing or weak in production: the request throws, the guard returns a plain 500 with a reference, nothing is written.
- Off Vercel the client address is "unknown", so everyone shares one 30-per-hour bucket (`client-ip.ts`).
- The SMS sender throws: logged as fixed text and the answer is unchanged.

**Honest limits.** There is no real SMS provider; the sender is a mock. With `DEMO_MODE=true`, anyone who knows a demo phone number can log in as that person, including staff. There is no per-account lockout: one code locks after 5 wrong tries, and an attacker can burn a victim's 5 codes per hour. There is no limit on the verify route itself, only on code requests. A fresh code before a large approval is a documented next step and is not built (`docs/assumptions.md` R23).

---

## 2. Bills, the late fee and the ledger

**What it does.** Money is a `bigint` count of paise (1 rupee = 100 paise), handled by one helper, `src/domain/money/money.ts`. The flat is the billing unit. The ledger is a table where rows are only ever added; each row has a positive amount and a direction (CHARGE or PAYMENT), and "balance due" is charges minus payments, worked out when needed and never stored. The late fee is also worked out on demand by `computeLateFee`; it is written into the ledger as a `LATE_FEE` charge only when a payment brings the principal to zero.

**Open these 5 files first.**

1. `docs/late-fee-policy.md`: the rules (R-a to R-e), worked examples and assumptions.
2. `src/domain/billing/late-fee.ts`: `computeLateFee`, the policy, hold skipping, one rounding at the end.
3. `src/domain/billing/position.ts` and `src/domain/billing/posting.ts`: `billPosition` (PRINCIPAL_OPEN, FEE_ONLY, SETTLED) and `planPosting` (which ledger rows one credit makes).
4. `src/domain/money/money.ts`: `paise`, `parseRupees`, `formatRupees`, `roundPaiseToRupeesHalfUp`.
5. `prisma/migrations/20261104080217_init_schema/migration.sql` (ledger checks, trigger, unique indexes), then `src/domain/billing/dues.ts` (`positionsForFlat`, `computeDues`).

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| I1: a ledger amount is above zero. | Check `ledger_entries_amount_paise_positive`. | `tests/integration/ledger-invariants.test.ts :: "I1 rejects amount %i"` |
| I2: the entry type fixes the direction (BILL and LATE_FEE are charges, PAYMENT is a payment). | Check `ledger_entries_type_direction`. | `tests/integration/ledger-invariants.test.ts :: "I2 accepts REVERSAL and ADJUSTMENT with direction %s"` |
| I3: the ledger is append-only. UPDATE, DELETE and TRUNCATE raise an error. | Trigger function `ledger_entries_reject_change`; triggers `ledger_entries_no_update_delete` and `ledger_entries_no_truncate`. | `tests/integration/ledger-invariants.test.ts :: "I3 rejects UPDATE and leaves the row unchanged"` and `"I3 rejects DELETE and leaves the row in place"` |
| The app's own database role cannot switch the trigger off. | The app role is not the table owner and has only SELECT and INSERT on `ledger_entries` (`src/server/db-roles/app-role.ts`). | `tests/integration/app-role.test.ts :: "D95 ALTER TABLE ledger_entries DISABLE TRIGGER ALL is denied"` |
| I4: the idempotency key is unique; the reference is unique when present. | Unique indexes `ledger_entries_idempotency_key_key` and `ledger_entries_reference_key`. | `tests/integration/ledger-invariants.test.ts :: "I4 rejects a duplicate idempotency_key and accepts a distinct one"` |
| I5: a reversal names its target and an entry is reversed at most once; an adjustment needs a note. | Checks and unique index `ledger_entries_reverses_entry_id_key`. | `tests/integration/ledger-invariants.test.ts :: "I5 rejects reversing the same entry twice"` |
| A ledger row cannot point at another flat's bill. | Composite foreign keys (migration `20261104094500_same_flat_composite_foreign_keys`). | `tests/integration/same-flat-invariants.test.ts` (file exists; individual test names not read: UNVERIFIED). |
| Paise survive the largest 64-bit value. | BIGINT columns and Prisma BigInt. | `tests/integration/bigint.test.ts :: "%s written by raw SQL is read back exactly by Prisma"` |
| The fee is rounded once, on the exact total. | `late-fee.ts`: `divideRoundHalfUp(numerator, denominator * PAISE_PER_RUPEE) * PAISE_PER_RUPEE`. | `tests/domain/late-fee.test.ts :: "the fee is the rounding of the exact total, not the sum of rounded days (F1: 47 x ₹2 would be ₹94)"` |
| A payment reduces the balance from the day after its date. | The day loop in `late-fee.ts`. | `tests/domain/late-fee.test.ts :: "a payment reduces the balance from the day after its date, not on it"` |
| A rate above the cap throws. | `validateLateFeePolicy` in `late-fee.ts`; `parsePolicy` in `src/server/home/mapper.ts`. | `tests/domain/late-fee.test.ts :: "an annualRateBps above capBps throws RangeError"` |
| D107: principal paid, fee still owed, never silently dropped. | `billPosition` (kind FEE_ONLY). | `tests/domain/billing/position.test.ts :: "principal-only is FEE_ONLY and the amount due is the posted fee"` |
| D110: the fee is posted once, when the payment reaches the principal. | `planPosting` (`reachesBill`). | `tests/domain/billing/posting.test.ts :: "a LATE_FEE is planned only when the credit brings the payments to the bill, and only once per bill"` |
| Home screen and payment lock use one function, so they agree. | `positionsForFlat` in `dues.ts`. | `tests/domain/payments/properties.test.ts :: "lockAmount equals the first open bill of computeDues, in paise"` |
| Domain code imports nothing from next, react, prisma, server or app. | ESLint `no-restricted-imports` in `eslint.config.mjs`, plus tests. | `tests/domain-imports.test.ts :: "every file under src/domain imports only allowed modules"` and `tests/architecture.test.ts :: "reports an error when src/domain imports @prisma/client"` |

**Worked example (copied from the tests).** Flat T12-0408 owes a bill of 637000 paise (₹6,370) due 2026-09-10; today is 2026-10-27; no payments. Overdue days: 20 in September plus 27 in October = 47. The exact fee is 637000 x 1200 x 47 / (10000 x 365) = 9842.96 paise (₹98.43). Rounded once, to whole rupees, it is 9800 paise (₹98). Amount due is 646800 paise (₹6,468). Test: `tests/domain/late-fee.test.ts :: "charges 47 days: exact ₹98.43, fee ₹98, amount due ₹6,468"` (inside the describe `F1 T12-0408: ₹6,370 due 2026-09-10, as of 2026-10-27, no payments`). Posting that payment gives a `LATE_FEE` of 9800 and a `PAYMENT` of 646800: `tests/domain/billing/posting.test.ts :: "T12-0408 paid in full on 27 Oct: LATE_FEE ₹98 and PAYMENT ₹6,468"`.

**Key numbers.** Annual rate 1200 basis points (12%) and cap 2100 (21%) and 365-day year: `defaultLateFeePolicy`, `src/domain/billing/late-fee.ts:13`. Bills are due on the 10th (period is the 1st, due day offset 9: `src/domain/seed/billing.ts`). Seed bill rate 650 paise per square foot (`src/domain/seed/types.ts`). India time is +05:30 and a day starts at 00:00 IST (`src/domain/time/calendar.ts`). Ledger entry types: BILL, LATE_FEE, PAYMENT, REVERSAL, ADJUSTMENT (5). Demo "today" is 2026-10-27, set by `DEMO_AS_OF` (`src/domain/seed/types.ts`).

**Failure modes.**

- Bad date, non-positive amount, or a rate above the cap: `RangeError` from the pure function.
- The `late_fee_policy` setting is missing or not valid: `parsePolicy` throws "The late_fee_policy setting is missing or not valid". The code never guesses a rate.
- A credit larger than the amount due: `planPosting` refuses with `EXCESS`. A settled bill gives `NO_DUES`.
- Any UPDATE, DELETE or TRUNCATE of the ledger: Postgres raises an error.
- A reversed principal payment does not reverse the posted fee. The bill reopens and the anomaly `FEE_POSTED_ON_OPEN_BILL` is flagged for a person (`position.ts`; test `tests/domain/billing/dues-position.test.ts :: "a reversed principal payment makes the bill PRINCIPAL_OPEN again, and its posted fee is flagged"`).

**Honest limits.**

- The "days with an unresolved payment attempt are skipped" rule exists in `computeLateFee` and is tested, but every caller passes `holds: []` (`src/domain/billing/dues.ts`). The hold columns exist and nothing writes them. So in the running app no day is ever skipped. See `docs/payments-design.md` P10 and `docs/late-fee-policy.md` A14.
- The 21% is the default `capBps`. The code only checks that the rate is not above `capBps`; it does not stop someone storing a `capBps` above 2100 (test: `tests/domain/late-fee.test.ts :: "accepts the default policy and a cap above 21% (the 21% limit is not enforced here)"`).
- `formatRupees` prints paise when an amount is not whole rupees; whole-rupee display is `formatRupeesRounded` (`src/domain/money/money.ts`). Fees are always whole rupees.
- While a bill has principal open, the ledger balance (charges minus payments) understates what is owed, because the fee is not in the ledger yet. Use "amount due", not "balance", for what the resident pays.
- There is no fee waiver.

---

## 3. Payments: attempts, the mock gateway, the signed webhook, locks

**What it does.** When a resident taps Pay, `initiatePayment` locks the amount due on the oldest open bill (principal plus fee, or the fee alone), creates one INITIATED attempt with the gateway reference `MOCK-<attemptId>`, and sends the resident to `/pay/mock/<attemptId>`. The mock page stands in for a real provider and posts a signed webhook to the same code a real provider would use. `applyGatewayEvent` locks the attempt row and then the bill, asks the pure `decideGatewayEvent` what to do, and either posts a LATE_FEE and a PAYMENT, marks the attempt FAILED, ignores a duplicate, or opens a queue item for a person.

**Open these 5 files first.**

1. `docs/payments-design.md`: states, guards, the amount lock, the webhook, assumptions P1 to P14.
2. `src/domain/payments/attempt-state.ts`: `decideGatewayEvent` and the guards in order.
3. `src/server/payments/webhook.ts`: `verifyWebhook`, `applyGatewayEvent`, `TIMESTAMP_WINDOW_SECONDS`.
4. `src/server/payments/initiate.ts` and `src/domain/payments/amount-lock.ts`: the amount lock and the one-attempt race.
5. `src/server/payments/bill-lock.ts` and the attempt constraints in `prisma/migrations/20261104080217_init_schema/migration.sql`.

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| I6: at most one unresolved attempt (INITIATED or PROCESSING) per bill. | Partial unique index `payment_attempts_one_unresolved_per_bill`. | `tests/integration/payment-attempt-invariants.test.ts :: "I6 rejects a second attempt while the first is %s"` |
| I7: gateway reference is unique; RELEASED needs a reason. | Unique index `payment_attempts_gateway_reference_key`; check `payment_attempts_released_has_reason`. | `tests/integration/payment-attempt-invariants.test.ts :: "I7 rejects a duplicate gateway_reference but allows many NULLs"` |
| Twenty parallel taps make one attempt. | `initiate.ts` catches the unique violation and returns the winner. | `tests/integration/payments-initiate.test.ts :: "twenty parallel initiations return the same attempt id, and exactly one row and one audit row exist"` |
| A stale amount creates nothing (`AMOUNT_CHANGED`). | `lockAmount` and the check in `initiate.ts` (D99, D101). | `tests/integration/payments-initiate.test.ts :: "an amount that is off by one paise, either way, is AMOUNT_CHANGED"` |
| Ledger entries post only on confirmed success, exactly when every guard holds. | Pure `decideGatewayEvent` (POST only if all guards pass). | `tests/domain/payments/properties.test.ts :: "a POST happens exactly when every guard holds, and in no other case (every failed guard is an EXCEPTION or a safe non-post)"` |
| Ten parallel success events post once. | `SELECT ... FOR UPDATE` on the attempt row first, then a state check (D102). | `tests/integration/payments-webhook.test.ts :: "ten parallel success events post exactly once: one POSTED, nine DUPLICATE, two ledger entries, one PAYMENT"` |
| A replayed success posts nothing more. | State-based idempotence. | `tests/integration/payments-webhook.test.ts :: "a replayed success is DUPLICATE, changes nothing and opens no queue item"` |
| Contradicting signals never auto-post (success after failure, failure after success). | `decideGatewayEvent` returns `CONTRADICTS_FINAL_STATE`. | `tests/integration/payments-webhook.test.ts :: "a success after FAILED is CONTRADICTS_FINAL_STATE, leaves the attempt FAILED, and opens exactly one OPEN queue item (a second one adds none)"` |
| Two entries cannot carry the same reference or key. | Unique indexes `ledger_entries_reference_key`, `ledger_entries_idempotency_key_key`. | `tests/integration/payments-webhook.test.ts :: "the ledger refuses a second payment with the same reference or the same idempotency key (unique indexes)"` |
| The webhook signature is the hex HMAC-SHA256 of `<timestamp>.<rawBody>`, compared in constant time. | `verifyWebhook`, `webhook.ts`. | `tests/server/webhook.test.ts :: "a tampered body fails: changing the amount by one paise, the type or the reference breaks the signature"` |
| A signed request older or newer than 300 s is refused. | `TIMESTAMP_WINDOW_SECONDS = 300`, `webhook.ts:13`. | `tests/server/webhook.test.ts :: "an old request replayed after 5 minutes is refused even though its signature is genuine"` |
| A missing or weak secret fails closed (plain 500, nothing processed). | `checkedSecret` in `webhook.ts`; `src/server/secret-rules.ts`. | `tests/integration/payments-webhook.test.ts :: "with no secret set the route answers a plain 500 and nothing is processed (fail closed)"` |
| The bank import and the gateway cannot both pay one bill. | Both take `pg_advisory_xact_lock(hashtext(billId))` through `lockBill` (D104). | `tests/integration/payments-bill-lock.test.ts :: "when a bank payment on the bill committed first, the gateway success is an exception and posts nothing"` |
| Deadlocks are retried (twice) and bills are locked in sorted order. | `withDeadlockRetry`, `TRANSACTION_RETRY` (`src/server/db-retry.ts:44`); `lockBills` in `bill-lock.ts` (D115). | `tests/server/db-retry.test.ts :: "gives up after the retries and throws the deadlock"` and `tests/integration/deadlock-retry.test.ts :: "lockBills takes the bills in sorted order, so opposite requests never deadlock and need no retry"` |
| The mock gateway exists only when `DEMO_MODE` is exactly `true`. | `isDemoMode` in `src/server/clock.ts`; `paymentProviderConfigured` in `src/server/payments/gateway.ts`. | `tests/integration/payments-initiate.test.ts :: "DEMO_MODE=%j is 503 PAYMENT_PROVIDER_NOT_CONFIGURED and creates nothing"` |
| A resident pays only their own flat; flat and bill are never taken from the request. | `initiatePayment` reads the flat from the session. | `tests/integration/payments-initiate.test.ts :: "an extra field in the body, such as a flat or a bill, is ignored: the flat is always the person's own"` |
| The entries are dated the day the attempt started. | `decideSuccess`. | `tests/integration/payments-webhook.test.ts :: "the entries are dated the day the attempt STARTED, not the day the event arrives"` |

**Guard order for a success event on an INITIATED attempt** (`src/domain/payments/attempt-state.ts`): reference matches; event amount equals the locked amount; no payment dated after the start day; the bill is not already settled; the locked amount equals the current amount due; then `planPosting`. Any failure is an EXCEPTION with one of five reasons: `AMOUNT_MISMATCH`, `LATER_PAYMENT`, `BILL_ALREADY_PAID`, `CONTRADICTS_FINAL_STATE`, `UNKNOWN_REFERENCE`.

**Key numbers.** Webhook window 300 s. Production secret at least 32 characters and not starting `replace-with` (`secret-rules.ts`). Deadlock retries: 2. Initiate body at most 1024 characters and webhook body at most 4096 (`src/server/payments/handlers.ts`). Attempt statuses: 5 (INITIATED, PROCESSING, SUCCEEDED, FAILED, RELEASED). Decision kinds: 4 (POST, MARK_FAILED, DUPLICATE, EXCEPTION). Test sizes: 10 parallel events; 20 parallel initiations; 2,000 random decision cases and 500 random flats in `tests/domain/payments/properties.test.ts`.

**Failure modes.**

- Bad, old or future signature: 401 `BAD_SIGNATURE`, database untouched.
- Signed but invalid body: 400.
- Unknown reference: 200, an audit row, no queue item.
- Guard failure on a success: one OPEN queue item, nothing posted. The attempt stays INITIATED and keeps the one-unresolved-attempt slot.
- Deadlock: the whole transaction re-runs up to 2 times, then the error is thrown.
- `DEMO_MODE` not exactly `true`: 503 on initiate and a real 404 on the checkout page.
- Midnight passes while the pay sheet is open: `AMOUNT_CHANGED` (409) with today's amount.

**Honest limits.**

- Only INITIATED, SUCCEEDED and FAILED are ever created. PROCESSING and RELEASED exist in the database enum and nothing writes them.
- Idempotence is by attempt state and gateway reference. The `eventId` is validated and logged, not used to dedupe (D102).
- There is no real gateway. With `DEMO_MODE=true` on a public site, anyone who can log in can "pay" for free.
- No screen resolves a payment exception yet, so an exception leaves the attempt blocking new attempts on that bill.
- `hashtext` is a 32-bit hash, so two bills can share a lock. That only makes one wait; it never gives a wrong answer.
- `tests/integration/deadlock-retry.test.ts` exercises `withDeadlockRetry` and `lockBill` with hand-written transactions, not `applyGatewayEvent` itself.

---

## 4. Bank statements and the matcher

**What it does.** A hand-written CSV reader (`src/domain/matching/csv.ts`) turns an uploaded file into rows with integer paise, or row errors. A separate narration parser pulls the payment rail, reference, UPI id, name and flat codes out of the free text. A pure matcher, `matchRow` (`src/domain/matching/decide.ts`), runs a fixed rule table and returns AUTO_MATCH, QUEUE or IGNORE with plain reasons. Scores only rank candidates for a person; no decision reads a score. The server imports a whole file in one transaction and checks that every row ended in exactly one state.

**Open these 5 files first.**

1. `src/domain/matching/decide.ts`: the rule table M0 to M7 and the auto-post conditions.
2. `src/domain/matching/processor.ts`: `processStatement` and `accountingReport` (the "accounted" check).
3. `src/server/statements/import.ts`: the one-transaction import, `staleRows`, `isAccounted`, the limits.
4. `docs/matching-benchmark.md`, `tests/fixtures/benchmark/dev/expected.json`, `tests/fixtures/benchmark/holdout/expected.json` and `tests/domain/matching/benchmark/gate.test.ts`: the benchmark.
5. `src/domain/matching/csv.ts`, `src/domain/matching/dedupe.ts` and `src/domain/matching/narration.ts`: the canonical schema, row keys and the parser layer.

**The rules, every id** (`src/domain/matching/decide.ts`; `DECISION_RULES = [M0, M1, M2, M3, M4, M5, M6, M7]`, the first rule that returns a decision wins):

| Rule | Meaning |
|---|---|
| M0 | No credit and no debit amount: IGNORE as not maintenance. |
| M1 | A debit: IGNORE. Exception: a returned cheque (rail `CHEQUE_RETURN`) is QUEUE. |
| M2 | A credit on rail INTEREST or BANK_CHARGE: IGNORE. |
| M3 | A credit with an empty narration: QUEUE, no candidates. |
| M4 | AUTO_MATCH, confidence HIGH, with a posting plan. Only when exactly one flat is identified and every auto condition below holds. |
| M5 | A flat is identified (by code or known payer) but an M4 condition failed: QUEUE, MEDIUM. The reasons say which condition failed. |
| M6 | No identity, but names, ambiguous codes, shared ids or amounts fit some flats: QUEUE, LOW, at most 5 candidates listed. |
| M7 | Nothing fits: QUEUE, NONE, reason `NO_MATCH`. |

The ten auto conditions inside M4 (`AUTO_CONDITIONS`, all must hold):

| Condition | Meaning |
|---|---|
| M4a | Exactly one flat has code or known-payer evidence and no other flat has. |
| M4b | At most one flat code in the narration and no ambiguous flat token. |
| M4c | The UPI id is not listed by more than one flat. |
| M4d | If both a flat code and a known UPI id are present, they name the same flat. |
| M4e | The credit equals the amount due (principal plus computed late fee) on that flat's oldest open bill. |
| M8 | The credit is below the approval threshold. The title in the code reads "(M4 f)". The id in code is `M8`. |
| M4g | The rail is not CHEQUE_RETURN. |
| M4h | The narration does not say "advance" and names no month count above 1. |
| M4i | The oldest open bill has no payment dated after the row's date. |
| M4j | A second, independent signal confirms the payer (D70): code and known payer on the same flat, or a name on the same flat, or the credit is the amount due of exactly one flat in the whole society. |

So there are 8 decision rules and 10 auto conditions. M9 is not in the table; it is the evidence rule (a shared UPI id is weak evidence only), in `src/domain/matching/evidence.ts`.

**Why a second signal (M4j).** Before M4j, the dev benchmark found 2 false auto-posts (a neighbour's code plus a coincidentally equal amount). The doc `docs/matching-benchmark.md` gives the two rows (seed 101 row 1932; seed 105 row 799). Those two rows and the pre-M4j counts come from the document only: UNVERIFIED by me.

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| X1: one flat only; a code on A and a payer on B queues; two codes queue. | M4a, M4b, M4d. | `tests/domain/matching/invariants.test.ts :: "a code on flat A and a known payer on flat B is QUEUE, not AUTO"` |
| X3: names alone and amounts alone never auto-post. | Only CODE and PAYER count as identity. | `tests/domain/matching/invariants.test.ts :: "an exact name with exactly the amount due is QUEUE, confidence LOW"` |
| X5: only the exact amount due on the oldest bill auto-posts. | M4e. | `tests/domain/matching/invariants.test.ts :: "the amount due on the oldest bill, with a code, is AUTO"` |
| X6: below the threshold auto, at or above queue. | M8. | `tests/domain/matching/invariants.test.ts :: "one paisa below the default 25,000 rupees is AUTO"` |
| M4j: a code alone never auto-posts. | M4j. | `tests/domain/matching/decide.test.ts :: "a code with none of the three is QUEUE, MEDIUM, with the flat named and the new reason"` |
| Every row ends in exactly one state, and the books add up. | Pure `accountingReport` in `processor.ts`; server `isAccounted` in `import.ts` compares the processor's books with a read-back from the database and rolls the transaction back if they differ. | `tests/domain/matching/processor-invariants.test.ts :: "200 random statements, cases from %i (25 each): every row has one state and the statement is accounted for"` and `tests/integration/statements-import.test.ts :: "isAccounted is false when the stored counts, the queue items or the payments differ from the processor's books"` |
| The same file twice changes nothing. | Row keys in `dedupe.ts`; unique index `bank_rows_dedupe_key_key`. | `tests/integration/statements-import.test.ts :: "importing the same file again gives all ALREADY_IMPORTED and changes no row, entry, match or queue item"` |
| Two rows paying the same bill: the first posts, the second queues. | The processor records each auto-post on its own copy of the bills. | `tests/domain/matching/processor-invariants.test.ts :: "two rows that each pay the same flat's oldest bill exactly: the first is AUTO_MATCHED, the second QUEUED"` |
| A bank row is posted at most once as a payment. | Unique index `ledger_entries_one_payment_per_bank_row`. | `tests/integration/payment-matches-invariants.test.ts` (file exists; test names not read: UNVERIFIED). |
| A bill that changed between reading and writing is not auto-posted. | `staleRows` in `import.ts` re-checks under the bill lock and downgrades to QUEUED with reason `STATE_CHANGED`. | `tests/integration/statements-import.test.ts :: "a gateway payment committed after the snapshot downgrades the row to QUEUED with STATE_CHANGED, and posts nothing from the bank"` |
| A failed import leaves nothing behind. | One transaction. | `tests/integration/statements-import.test.ts :: "a failure before the commit leaves no import, bank row, ledger entry, match, queue item or audit row"` |
| Two imports at once, or an import racing the gateway, pay a bill once. | Advisory lock `statement-import` plus the bill lock. | `tests/integration/statements-import.test.ts :: "a gateway success and a bank auto-post racing for one bill give exactly ONE payment, and the loser is an exception or a downgrade"` |

**The benchmark and its method** (all values from `tests/fixtures/benchmark/{dev,holdout}/expected.json`):

- Two sets of 5 simulated statements, 2,000 rows each: dev seeds 101 to 105 and holdout seeds 9001 to 9005. That is 10,000 rows per set and 20,000 in all.
- The simulator (`src/domain/matching/benchmark/simulate.ts`) first picks what the payer truly does (the "truth"), then separately picks a narration style and a payment rail, so narration noise cannot change the truth. All weights are the author's choices, not measured from a real bank.
- Dev pooled: 7,311 credits, 298 auto-posted, 298 correct, 0 false, precision 1, recall 0.1691, auto rate 0.0408.
- Holdout pooled: 7,269 credits, 312 auto-posted, 312 correct, 0 false, precision 1, recall 0.1789, auto rate 0.0429.
- Together: 14,580 credits, 610 auto-posts, 0 false.
- The gate: `tests/domain/matching/benchmark/gate.test.ts :: "%s seed %i: falseAuto is 0, precision is 1, the statement is accounted, and the numbers equal the snapshot"` (10 cases) and `"%s: the committed snapshot itself says falseAuto 0 on every statement"`. It also demands at least one correct auto-post, because a gate that passes when nothing posted proves nothing.
- Drift tests: `tests/domain/matching/benchmark/dev.test.ts :: "seed %i: regenerating gives the committed CSV and truth byte for byte, and the same population"` and the same pattern for holdout.
- The holdout was generated and run once, after the dev results, and the matcher was not changed afterwards (`tests/fixtures/benchmark/holdout/README.md`). I could not prove that from code; `git log` on the holdout folder could check it: UNVERIFIED.
- The dev set was used to change the matcher: M4j was added after dev found false auto-posts.

**What a false auto-post is.** An AUTO_MATCHED row where the truth is not "pays this bill of this flat" (`src/domain/matching/benchmark/evaluate.ts`): wrong flat, wrong bill, or the payer did something else (advance, part payment, several bills, not maintenance, returned cheque). The money lands on the wrong flat, or the wrong thing is settled, with no person looking.

**What the benchmark does not prove.** It is simulated data, not a real bank. With about 7,300 credits per set, a false-post rate lower than about 1 in 2,000 cannot be seen (`docs/matching-benchmark.md`). It uses the matcher's default threshold of ₹25,000, not the demo's ₹10,000. It does not test ledger posting, locks or approvals. Recall is low on purpose: about 4% of credits are auto-posted, because most simulated payers write a flat code and nothing else.

**Key numbers.** 8 decision rules, 10 auto conditions. At most 5 candidates listed (`MAX_LISTED_CANDIDATES`, `decide.ts:13`). Default threshold 2,500,000 paise = ₹25,000 (`src/domain/matching/context.ts:8`); demo threshold 1,000,000 paise = ₹10,000 (`src/domain/seed/settings.ts:28`). Import limits: 2,000,000 characters and 20,000 rows (`src/server/statements/import.ts`). Transaction timeout 120,000 ms; lock wait 5 s. The demo sample statement has 106 rows: 25 posted automatically, 43 queued, 38 not maintenance (`tests/server/sample-statement.test.ts :: "MP8 the mix: 106 rows, 25 posted automatically, 43 queued, 38 ignored, accounted, in well under a second (an illustration, not the benchmark)"`). It is built to show screens; it is not the benchmark.

**Failure modes.**

- A missing required header column: `INVALID_CSV`, nothing stored.
- A file over 2,000,000 characters, over 20,000 rows, or with a NUL byte: refused before any database work.
- Another import running for more than 5 s: `IMPORT_IN_PROGRESS`.
- A bill changed between reading and writing: that row is queued as `STATE_CHANGED`, nothing is posted.
- Books do not add up: `StatementAccountingError`, everything rolled back.
- A bill with principal paid but a fee owing is invisible to the matcher, so a bank payment for the fee is queued as `NO_OPEN_BILL` (`docs/statement-import-design.md`).

**Honest limits.** Invalid CSV rows are counted and reported (the first 50 are shown) but have no `bank_rows` record, so "exactly one state" holds for each stored row, and the totals add up through counts. The CSV `reference` column is not used for row keys; only a reference parsed from the narration is. There is no undo of a posting. The matcher ignores payment-attempt holds; the database lock protects instead.

---

## 5. Manual reconciliation and approvals

**What it does.** Staff with `payments:match` open a queued bank row, choose a flat and write a reason of 5 to 500 characters. The server plans the entries under the bill lock and posts them, or, when the credit is at or above the approval threshold, only requests approval. A second person with `payments:approve`, who is not the requester, then approves (posts) or rejects (the row returns to the queue).

**Open these 5 files first.**

1. `src/server/statements/manual.ts`: `postManualMatch` (reason, flat, threshold, request or post).
2. `src/server/statements/approval.ts`: `ignoreRow`, `approveRequest` (`SELF_APPROVAL`), `rejectRequest`.
3. `src/server/statements/manual-core.ts`: `reasonSchema`, the row lock, `planUnderLock`, `approvalThreshold`.
4. `prisma/migrations/20261104083542_bank_statements_and_matching/migration.sql`: the J-series constraints, especially `payment_matches_approver_differs`.
5. `tests/integration/manual-concurrency.test.ts` and `tests/integration/manual-approval.test.ts`.

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| A human decision needs a reason of 5 to 500 characters. | `reasonSchema = z.string().trim().min(5).max(500)` in `manual-core.ts`; database check `payment_matches_human_decision_has_actor_and_reason`. | `tests/integration/payment-matches-invariants.test.ts :: "J5 %s requires a non-blank reason"` |
| At or above the threshold, nobody posts alone. | `row.creditPaise >= threshold` in `manual.ts` and `approval.ts`. | `tests/integration/manual-match.test.ts :: "a credit at or above the threshold is not posted: AWAITING_APPROVAL, a REQUEST_APPROVAL decision, the queue item stays OPEN"` |
| The person who asked cannot approve. | `approveRequest` returns `SELF_APPROVAL` before any database work; database check `payment_matches_approver_differs`. | `tests/integration/manual-approval.test.ts :: "the person who asked cannot approve: SELF_APPROVAL from the service, before any database constraint, and nothing changes"` and `"the database itself refuses an approver who is the decider (J5), whatever the service does"` |
| Only `payments:approve` can approve or reject. | Route and service both check. | `tests/integration/manual-approval.test.ts :: "a user with only payments:match cannot approve or reject: FORBIDDEN, nothing changes"` |
| The decision log is append-only. | Triggers `payment_matches_no_update_delete` and `payment_matches_no_truncate`. | `tests/integration/payment-matches-invariants.test.ts :: "J4 rejects UPDATE and leaves the row unchanged"` |
| Two staff on one row, or a manual post racing the gateway, pay a bill once. | `SELECT ... FOR UPDATE` on the bank row, then `lockBill` on the oldest open bill. | `tests/integration/manual-concurrency.test.ts :: "five rounds: exactly one posts, the other is NOT_QUEUED, and the bill is paid once"` and `"a gateway success that races a manual post: exactly ONE payment, the loser is an exception or a refusal (6 rounds)"` |
| The oldest open bill is paid, not the newest. | `planUnderLock`. | `tests/integration/manual-match.test.ts :: "the oldest open position is paid, not the newest: two open bills, the older one gets the payment"` |
| An approval is refused if the bill changed since the request. | Amount due and bill id are checked again (`approval.ts`). | `tests/integration/manual-concurrency.test.ts :: "an approval that races a gateway success: one PAYMENT; an approval that loses is STATE_CHANGED and the row returns to QUEUED"` |

**Key numbers.** Reason 5 to 500 characters. Demo threshold ₹10,000 (setting `approval_threshold_paise`, seeded 1,000,000 paise); matcher default ₹25,000. The matcher auto-posts only below the threshold; the manual path needs approval at or above it; so at exactly the threshold, nobody posts alone. Transaction timeout 30,000 ms. Seeded staff with `payments:match`: Priya Nair and Rahul Menon. Only Rahul Menon also holds `payments:approve` (`src/domain/seed/people.ts`).

**Failure modes.** Row no longer queued: `NOT_QUEUED` (409). Row version moved: `STALE` (409). Bill changed: `STATE_CHANGED` (409), nothing posted. Self approval: `SELF_APPROVAL` (409). Credit above the amount due: `NEEDS_ADVANCE_HANDLING` (422). No open bill: `NO_OPEN_BILL` (422).

**Honest limits.**

- In the seed only Rahul Menon can approve, so a request raised by Rahul has nobody eligible to approve it.
- The test `"two approvers at once: one approves, the other is NOT_AWAITING_APPROVAL, one PAYMENT"` builds the second approver as a copy of the same user (`{ ...rahul }`). It proves the row lock serialises two calls. It does not prove two different people.
- A person with approve rights may reject their own request (assumption M5). Only approving it is forbidden.
- The `UNDO` decision value exists and nothing uses it. There is no undo, no waiver, no advance handling.

---

## 6. Complaints, the safety path and the AI chain

**What it does.** A resident raises a complaint (1 to 2,000 characters). The safety word rules read the original text first. A hit, or the resident answering Yes to "Is anyone in danger right now?", makes the complaint CRITICAL, assigns it to the duty manager and never calls any model. Otherwise a de-identified copy of the text goes to a chain of classifier providers inside a 4,000 ms budget; a pure function accepts the answer, or falls back to keyword rules, or sends the complaint to a person to triage. A model can never output CRITICAL.

**Open these 5 files first.**

1. `src/domain/complaints/decision.ts`: the pure rules R1 to R5 and the policy; what a model may never do.
2. `src/domain/complaints/safety.ts`: the 79 safety rules and `detectSafetyWords`.
3. `src/server/complaints/classify.ts`: the order of steps (safety words, declared danger, de-identify, classifier, decide).
4. `src/server/complaints/providers/classifier-jev.ts`: provider failover, breaker, daily cap, budget share.
5. `src/domain/complaints/lifecycle.ts`: the state machine and the reply-time clock.

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| Safety words read the original text before anything else, and a hit never reaches a provider. | `classify.ts` returns before the classifier call; `decision.ts` rule R1 re-checks and overrides. | `tests/integration/complaints-providers.test.ts :: "a safety complaint NEVER reaches a provider: zero requests, CRITICAL by rule"` |
| Declared danger takes the same path with any text, even empty. | `declaredDecision` in `classify.ts` (D121). | `tests/integration/complaints-create.test.ts :: "D121 declared danger with innocuous text escalates like a safety word: no classifier call, CRITICAL, duty manager, DECLARED, K1 to K4 hold"` |
| A model result is never CRITICAL. | `MODEL_URGENCIES` in `taxonomy.ts` has no CRITICAL; `validateArm` in `decision.ts`; the provider parser rejects unknown labels. | `tests/domain/complaints/decision.test.ts :: "a non-safety result is NEVER CRITICAL, never source RULE and never escalated"` and `tests/server/complaints/providers/client.test.ts :: "an answer that says CRITICAL is INVALID"` |
| K1: a safety flag implies urgency CRITICAL. | Check `complaints_safety_requires_critical`. | `tests/integration/complaints-invariants.test.ts :: "K1 rejects safety_flag with urgency %s"` |
| K2: a safety complaint is never auto-closed or confirmed by the resident. | Check `complaints_safety_never_auto_closes`; `lifecycle.ts`. | `tests/integration/complaints-safety.test.ts :: "CL5 a safety complaint is never auto-closed, however long it waits"` |
| K5: events, classifications and the audit log are append-only. | Triggers (migration `20261104091653_complaints_outbox_audit_visitors`). | `tests/integration/complaint-support-invariants.test.ts :: "K5 $table rejects UPDATE and leaves the row unchanged"` |
| The pure lifecycle always satisfies the database checks. | `applyTransition` in `lifecycle.ts`. | `tests/domain/complaints/lifecycle.test.ts :: "CL1 ${PROPERTY_RUNS} seeded random action sequences: every reachable state passes K1 to K4 and the safety and rating rules"` (`PROPERTY_RUNS = 2000` in that file) |
| Two staff changing one complaint from the same version: one wins, the other gets `STALE`. | Row lock and `expectedVersion` check in `src/server/complaints/staff-actions.ts`. | `tests/integration/complaints-e2e.test.ts :: "CL6 two staff assigning at once from the same version: exactly one wins, the other is STALE, and the complaint is consistent (10 rounds)"` |
| Only the duty manager can acknowledge or close a safety complaint. | `isDutyManager` in `src/server/complaints/safety.ts`. | `tests/integration/complaints-safety.test.ts :: "CL3 acknowledge and close need complaints:duty_manager: a staff user with only complaints:manage, the accounts user and a resident get FORBIDDEN"` |
| The resident sees only comments marked visible, never internal notes or classification. | `residentTimeline` in `src/domain/complaints/timeline.ts`. | `tests/domain/complaints/timeline.test.ts :: "CL2 CLASSIFIED, a category correction, links, affected flats, an acknowledgement and an internal note are never shown"` |
| Only de-identified text goes to a provider. | `deidentify(rawText, { knownNames })` in `classify.ts`. | `tests/integration/complaints-create.test.ts :: "CL2 the text sent to the classifier has no phone, e-mail, flat code or the resident's name"` |
| Bad provider settings never block a complaint. | The factory never throws and skips the bad provider (D145). | `tests/server/complaints/providers/fail-soft.test.ts :: "the factory never throws, warns by variable name only, and logs no value"` |
| Safety words are not hidden by de-identification. | Rules read the original text. | `tests/domain/complaints/purity.test.ts :: "de-identifying a complaint never hides a safety word (the model reads de-identified text, the rules read the original: both must see the same danger)"` |
| The same text by the same person within 60 s is one complaint. | `REPEAT_WINDOW_MS = 60_000` and an advisory lock in `create.ts`. | `tests/integration/complaints-create.test.ts :: "CL8 six requests for the same text at the same moment make one complaint"` |

**The safety words** (`src/domain/complaints/safety.ts`, counted in this session): 79 rules in four categories: FIRE 20, GAS 17, LIFT_STUCK 21, SHOCK 21. By language family: English 20, Hindi 20, Marathi 18, Hindi in Latin letters 13, Marathi in Latin letters 8. Text is normalised first (`src/domain/complaints/text.ts`: Unicode NFC, zero-width characters removed, Devanagari digits turned to ASCII, cut to 2,000 characters). Only the first 2,000 characters are read. There is no negation handling by design, so "no fire" and "gas bill" still hit; a false alarm costs a call, a miss costs more. The lists are not checked by a native speaker (`docs/safety-words-review.md`, `tests/domain/complaints/safety-review-doc.test.ts :: "says it is not verified by a native speaker, and has a column for who reviewed it and when, left empty"`).

**De-identification** (`src/domain/complaints/deidentify.ts`). It replaces e-mail and UPI addresses with `[EMAIL]`, web links with `[URL]`, runs of 10 or more digits with `[PHONE]`, flat codes with `[FLAT]`, and honorific plus name or the raiser's and flat members' names with `[NAME]`. It cannot remove a name that is not in the flat's member list and has no honorific, addresses, building names, vehicle numbers, short account numbers, facts in sentences, or inflected Devanagari names. It reduces identifying detail; it does not anonymise.

**The AI chain, step by step** (`src/server/complaints/classify.ts`, `classifier.ts`, `providers/`):

1. Safety words on the original text. A hit gives a rule decision and no call.
2. Declared danger gives the same.
3. De-identify, then call the classifier inside a 4,000 ms budget (`CLASSIFIER_BUDGET_MS`, `classifier.ts:21`).
4. `JevClassifier` tries the primary provider (OpenCode), then the secondary (jevmodel.app). It skips a provider whose daily cap is used up or whose breaker is open. It makes one attempt per provider and no retries. A provider's timeout is the smaller of the per-request timeout and the remaining budget divided among the providers still available, and never below 50 ms (`classifier-jev.ts`).
5. `decideClassification` accepts an answer only if it is valid and the top category has probability at least 0.70. Otherwise the keyword fallback (`src/domain/complaints/fallback.ts`) answers; if that finds nothing, a person triages.
6. With no provider configured, `NullClassifier` makes the keyword fallback answer every complaint.

A valid but low-confidence answer goes to a person, not to the fallback (`tests/integration/complaints-create.test.ts :: "CL2 a valid answer that decideClassification refuses (low confidence) goes to a person, not to the fallback"`).

**Key numbers.**

- Classifier budget 4000 ms (`classifier.ts:21`). Provider timeout default 3000 ms (allowed 500 to 4000), daily cap 300 per provider (1 to 100,000), breaker opens after 3 failures in a row (1 to 20), cooldown 120 s (1 to 3600): `LIMITS` in `src/server/complaints/providers/config.ts`.
- Thresholds: category probability at least 0.70, urgency probability at least 0.60 (`defaultClassificationPolicy`, `src/domain/complaints/decision.ts:25`). The code comments call them guesses. The raise path sets `allowSingleArm: true`, so one provider answer is enough (`classify.ts`).
- Reply-time (SLA) minutes: CRITICAL 15, HIGH 120, NORMAL 1,440, LOW 4,320 (`defaultSlaMinutes`, `lifecycle.ts`).
- The "No answer yet" clock on the resident's Home: 5 minutes (`safety_ack_timeout_minutes`, `src/domain/complaints/safety-alert.ts`).
- Auto-close and reopen window: 7 days. Repeat window 60 s.
- 5 complaint categories (PLUMBING, ELECTRICAL, HOUSEKEEPING, LIFT, OTHER). Models may use 3 urgencies (HIGH, NORMAL, LOW).
- Seed: 3,450 complaints, 30 of them safety (`src/domain/seed/complaints.ts`).

**Failure modes.**

- Provider throws, times out, or none configured: the keyword fallback answers. A complaint is never refused for this.
- A 401 or 403 from a provider opens its breaker at once. A 429 opens it for the `Retry-After` seconds, no longer than the cooldown.
- After the cooldown the breaker lets exactly one trial request through.
- No duty manager exists: the complaint stays NEW, the event notes `NO_DUTY_MANAGER`, and no notification is written.
- A stale version gives `STALE` (409); an invalid move gives `INVALID_TRANSITION` (409).

**Honest limits.**

- No real provider was ever called by this work. The System One protocol is assumed from the provider's documentation, and the live providers' answers are UNVERIFIED (`docs/classifier-providers.md`). `npm run llm:check` is how you check with your own keys.
- No accuracy number exists for the classifier. The benchmark plan in `docs/complaint-classification.md` was not run.
- Breaker and cap state live in memory per server instance, so they are not global.
- The "No answer yet" state only changes the resident's screen and shows a call link. Nothing re-notifies staff or escalates by timer. The `escalation_hours` setting (24) exists and no code reads it. The complaint path does not use the outbox.
- `slaState` returns MET for any first response, even a late one (`lifecycle.ts`). Its comment says "by the due time"; the code does not compare.
- A staff member with only `complaints:manage` can comment on a safety complaint, and the first staff action sets `first_response_at`, which makes the resident's alert say "seen". No test covers this (UNVERIFIED).
- Safety words are not checked by a native speaker.

---

## 7. Security: roles, guards, CSRF, audit, app role privileges

**What it does.** Every API route is exported through `withPermission(need, handler)` or an allowlisted `publicRoute(handler)`; a test that reads the route files with the TypeScript compiler fails if any method is a bare function. Every page that is not public calls `requireUser`. The web app connects to Postgres as a role that does not own the tables; its privileges are generated from one matrix. Refusals (403) are written to `audit_log`; unexpected errors become a plain 500 with a short reference and a redacted row in `error_events`.

**Open these 5 files first.**

1. `src/server/auth/guard.ts`: `withPermission`, `publicRoute`, `isAllowed`, `auditDenied`.
2. `tests/server/route-guards.test.ts`: the public-route allowlist and the checker that reads the route files.
3. `src/server/db-roles/app-role.ts`: `PRIVILEGE_MATRIX` for 26 tables, `APPEND_ONLY_TABLES`, and the guards in the generated SQL.
4. `src/server/auth/csrf.ts`: the cross-site check.
5. `src/server/log.ts` and `src/server/error-log.ts`: redaction and the error store (`docs/observability.md`).

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| D81: every exported route method is wrapped. | The checker `violationsIn` in `tests/server/route-guards.test.ts`. | `tests/server/route-guards.test.ts :: "every exported method of every route is wrapped, and no route reads the session or cookies itself"` |
| D81: the public routes are exactly the seven on the allowlist. | Same file. | `tests/server/route-guards.test.ts :: "the only public routes are the seven on the allowlist plus nothing else"` |
| D81: every non-public page calls `requireUser`. | `tests/server/page-guards.test.ts`. | `tests/server/page-guards.test.ts :: "every page that is not on the public allowlist calls requireUser"` |
| 401 means no valid session; 403 means a known person who may not. Only 403 is audited. | `guard.ts`, `src/server/auth/audit.ts` (D82). | `tests/integration/guard.test.ts :: "D81 a resident on a permission route is 403 FORBIDDEN and audited with the need, method and path"` |
| A resident holding every permission string is still refused; an inactive staff member has none. | Pure `can` in `src/domain/auth/permissions.ts`. | `tests/domain/auth/permissions.test.ts :: "a resident holding every permission string still cannot %s"` |
| D83: cross-site writes are refused before the session is even read. | `csrfBlocked` in `csrf.ts`, applied first in both guards. | `tests/integration/guard.test.ts :: "D83 the CSRF check comes before the session: a foreign POST with no cookie is 403 CSRF_BLOCKED, not 401"` |
| The app role is not the owner and has no admin attributes. | The generated SQL refuses to run otherwise (`app-role.ts`). | `tests/integration/app-role.test.ts :: "D95 it is not a superuser, cannot create roles or databases, and bypasses no security"` |
| The privileges are exactly the matrix. | `buildAppRoleSql` revokes everything first, then grants. | `tests/integration/app-role.test.ts :: "D95 the privileges it holds are exactly the matrix, read back from Postgres for every table and privilege"` |
| A new table must get a privilege decision. | `undecidedTables` in `app-role.ts`. | `tests/integration/app-role-matrix.test.ts :: "D95 the schema has the 26 tables of the matrix plus _prisma_migrations, nothing else"` |
| The app role cannot switch off the append-only triggers. | Not the owner. | `tests/integration/app-role.test.ts :: "D95 ALTER TABLE ledger_entries DISABLE TRIGGER ALL is denied"` and `"D95 SET session_replication_role = replica is denied, so triggers cannot be skipped that way"` |
| The app can insert error events but never read them. | `error_events: I` in the matrix (D136). | `tests/integration/app-role.test.ts :: "D136 the trap: INSERT ... RETURNING needs SELECT and is refused, and the row is not written"` |
| Secrets are redacted from logs and stored errors. | `src/server/log.ts` (D135). | `tests/server/redact.test.ts :: "no run of 32 or more token characters or 10 or more digits survives, and the secrets never do"` |
| Readiness reports degraded if the app connects with too much power. | `src/server/health/readiness.ts`. | `tests/integration/readiness.test.ts :: "the owner connection is degraded: it can update the ledger and delete from the audit log"` |

**The roles.** Two roles: RESIDENT and STAFF. Staff hold zero or more of five permissions: `payments:match`, `payments:approve`, `reports:view`, `complaints:manage`, `complaints:duty_manager` (`src/domain/auth/permissions.ts`). Seeded staff: Priya Nair (`payments:match`), Rahul Menon (`payments:match`, `payments:approve`), Meera Kapoor (`reports:view`), Kavita Rao (`complaints:manage`), Sanjay Pawar (`complaints:manage`, `complaints:duty_manager`) (`src/domain/seed/people.ts`).

**Key numbers.**

- 26 tables in the privilege matrix, plus `_prisma_migrations` with no access.
- 5 append-only tables: `ledger_entries`, `payment_matches`, `complaint_events`, `classifications`, `audit_log` (`APPEND_ONLY_TABLES`, `app-role.ts`); each has a row trigger for UPDATE and DELETE and a statement trigger for TRUNCATE.
- Column-level UPDATE grants: `sessions` 2 columns, `otp_codes` 2, `payment_attempts` 3, `bank_rows` 4, `accounts_queue_items` 4, `complaints` 13 (counted from the arrays in `app-role.ts`). Everything else the app can touch is SELECT and INSERT only; there is no DELETE or TRUNCATE anywhere.
- 7 public routes: `/api/health`, `/api/health/ready`, `/api/ops/error-test`, `/api/auth/otp/request`, `/api/auth/otp/verify`, `/api/auth/logout`, `/api/payments/webhook` (`tests/server/route-guards.test.ts`). 33 route files under `src/app/api`.
- Error log: message cut to 500 characters, stack to 12 frames and 4,000 characters (`src/server/log.ts`); at most 20 events per minute per instance (`src/server/error-log.ts`); kept 30 days by default (`src/server/error-prune.ts`); reference `E-` plus 6 characters.
- The secret scanner `scripts/scan-secrets.mjs` has 6 patterns; CI also runs gitleaks 8.24.3 over the full history (`.github/workflows/ci.yml`).

**Failure modes.**

- A route throws: plain 500 `{error: "SERVER_ERROR", ref}`, a stdout line and an `error_events` row.
- The audit write fails on a 403: the 403 stands.
- The pepper is missing when a 403 is audited: still one audit row, with no address hash and `ipHashStatus: "unavailable"` (D129; `tests/integration/audit-missing-pepper.test.ts`).
- The app connects as the owner or a superuser: `/api/health/ready` returns 503 `degraded`.
- A resident opens a staff page: redirected to `/forbidden` (not audited).

**Honest limits.**

- The append-only triggers are not unbreakable. The table owner can disable them. The protection is that the web app connects as a different role. In CI and in local integration tests, the main connection is the owner.
- No security headers (CSP, HSTS, frame-ancestors) are set in the code. I found none in `next.config.ts`, `src` or `public`. Clickjacking protection is not claimed.
- A request with no `Origin` and no `Sec-Fetch-Site` header is allowed on purpose (scripts, `curl`). There is no global rate limit.
- `SESSION_SECRET` is in `.env.example` and no code reads it.
- Demo mode weakens login by design (see section 1).
- `audit_log` has no retention job; it only grows.

---

## 8. The committee report

**What it does.** It is built. `/staff/reports` is a read-only page showing money (billed, collected, outstanding), ageing of dues in five groups, collection quality, complaint handling, a 30-day bank reconciliation line, and three goals marked Met, Not met or No data. Only staff with `reports:view` can open it; the seed gives that to Meera Kapoor. No resident name or phone appears. Money figures come from the same `positionsForFlat` function the resident Home uses.

**Open these 5 files first.**

1. `docs/committee-report.md`: the metric definitions.
2. `src/server/reports/report-data.ts`: `loadCommitteeReport` (permission, as-of date, assembly).
3. `src/domain/reports/money-line.ts`, `age.ts` and `goals.ts`: the pure metric functions.
4. `src/server/reports/reconciliation.ts`: the 30-day reconciliation line.
5. `tests/integration/committee-report.test.ts`: the figures checked against separate raw SQL.

**Invariants.**

| Invariant | Enforced by | Tested by |
|---|---|---|
| Billed = Collected + Outstanding, in paise. | Pure `moneyLine` in `money-line.ts` (no database constraint). | `tests/domain/reports/money-line.test.ts :: "2,000 random bill sets: Billed = Collected + Outstanding exactly, paid in full + outstanding = billed, Collected never exceeds Billed"` |
| The figures equal an independent SQL query. | Loader. | `tests/integration/committee-report.test.ts :: "October as of 27 Oct 2026: Billed, Collected, Outstanding and the flat counts equal a separate SQL query"` |
| Only `reports:view` can read it. | `requireUser({ need: "reports:view" })` in the page; `requirePermission` in the loader. | `tests/integration/committee-report.test.ts :: "a resident, and staff without reports:view, are refused by the loaders at the data"` |
| No resident name or phone appears. | The loader selects flat codes only. | `tests/integration/committee-report.test.ts :: "no resident name or phone number appears anywhere in the page, in any month or any drill-down (every seeded name and phone is searched for)"` |
| A target is judged on counts, not rounded percentages. | `goals.ts`. | `tests/domain/reports/reconciliation-goals.test.ts :: "89.6 percent does not meet a 90 percent target even though it rounds to 90, and 8.1 percent reopened is over a ceiling of 8"` |

**Key numbers** (seeded October, as of 2026-10-27; `tests/integration/committee-report.test.ts :: "the pristine seed gives these October figures, which scripts/smoke-app.mjs also expects (as of 27 Oct 2026): a drift in the seed shows here first"`): billed 1,805,219,000 paise (₹1,80,52,190); collected 1,484,271,400 paise; outstanding 320,947,600 paise; 2399 flats billed, 1915 paid in full, 484 outstanding; 943 open bills owing 618,968,600 paise across all months. The goals are 90% on-time collection, 90% first reply within the reply-time limit, at most 8% reopened (`society_settings.committee_goals`; defaults in `src/domain/reports/goals.ts`). Reconciliation window: 30 days (`RECONCILIATION_DAYS`, `reconciliation.ts:6`). Ageing buckets: 5.

**Failure modes.** Without `reports:view`: redirect to `/forbidden`. No bills in the month: "No bills for this month". Missing `committee_goals` setting: the page opens on built-in defaults and says so. A zero denominator shows "No data", never 0%.

**Honest limits.** No charts, export, print or trend. The goals are assumptions, not committee-agreed (R67). The reconciliation window uses the real upload time, so under a frozen demo date an import made later still counts. Complaint figures describe the month's complaints as they are now, not as on the as-of date. Why 2399 flats are billed and not 2400: UNVERIFIED.

---

## 9. Deployment: Vercel, Neon, the owner and app roles

**What it does.** The plan is a Next.js app on Vercel Hobby (region `sin1`, Node `24.x`) talking through Neon's pooler to a free Neon Postgres in Singapore. It connects as the non-owner role `township_app`. The owner role (`neondb_owner`) is used only from the human's laptop to migrate, grant and seed. After deploying, `GET /api/health/ready` names any misconfiguration and `npm run smoke:auth` tests login over real HTTP.

**Important:** the repository does not show a deployment. `docs/deployment-plan.md` and `docs/deploy-checklist.md` both say nothing has been run, and the README has no live URL. Say "deploy-ready with a runbook and a readiness check", not "deployed", unless the owner confirms otherwise. Whether it was ever deployed: UNVERIFIED.

**Open these 5 files first.**

1. `docs/deploy-checklist.md`: the step list the human follows.
2. `docs/deployment-plan.md`: decisions, the environment table, role design, migration procedure, rollback, risks.
3. `src/server/db-roles/app-role.ts`: the matrix and the generator of the grant SQL.
4. `src/server/health/readiness.ts` and `src/app/api/health/ready/route.ts`: the first check after deploy.
5. `src/server/db-options.ts` and `src/server/db.ts`: pool settings and the lazy client (a build needs no database).

**Invariants and rules.**

| Rule | Enforced by | Tested by |
|---|---|---|
| The app is not the owner (D95). | Generated SQL guards; readiness. | `tests/integration/app-role.test.ts :: "D95 it owns no table: every table is owned by the owner role"` |
| The grants script protects itself and can be run again. | Guards in the generated SQL. | `tests/integration/app-role.test.ts :: "D95 running it twice is fine, and running it again takes back a privilege that was added by hand"` |
| The readiness report never leaks a value. | `readiness.ts` returns booleans and fixed words only. | `tests/integration/readiness.test.ts :: "ready: 200, no-store, and the body holds none of the connection's values"` |
| Unit and integration tests pass with no `.env` and only `DATABASE_URL`. | `scripts/test-ci-parity.sh` runs under `env -i` with `IGNORE_DOTENV=true` (D128). | `npm run test:ci-parity` (run in this session, exit 0). |
| The seed refuses to run on the wrong database. | `src/server/seed/guards.ts`. | `tests/server/seed-guards.test.ts` (names not read: UNVERIFIED). |
| Node stays on the 24 line. | `engines.node` is `24.x` in `package.json`. | `tests/node-version.test.ts` (names not read: UNVERIFIED). |

**Key numbers.**

- 7 migrations in `prisma/migrations` (the last is `20261107090000_error_events`) and 26 tables.
- Pool: default maximum 5 connections (1 to 10 through `DB_POOL_MAX`), connect timeout 8,000 ms, idle 10,000 ms, query 10,000 ms (`src/server/db-options.ts`).
- Readiness probe deadline 3,000 ms (`readiness.ts`).
- Production secrets (`OTP_PEPPER`, `PAYMENT_WEBHOOK_SECRET`) at least 32 characters, not starting `replace-with`.
- Vendor limits quoted by the plan (Vercel Hobby, Neon Free: 1 GB, 100 compute hours a month, sleep after 5 minutes idle, 6 hours of restore history) were fetched on 2026-11-06 by an earlier agent. I did not re-fetch them: UNVERIFIED.

**Environment variable names only** (`.env.example` and `docs/deployment-plan.md`): `DATABASE_URL` (app role, pooled), `OTP_PEPPER`, `PAYMENT_WEBHOOK_SECRET`, `DEMO_MODE`, `DEMO_AS_OF` (`2026-10-27` on the live demo, with `DEMO_MODE=true`), `SHOW_DESIGN_PAGE`, `JEV_*` (classifier), `OPS_TEST_TOKEN` (optional), `LOGS_DATABASE_URL` (the developer's machine only, never Vercel). The owner connection string never goes into Vercel.

**Failure modes.**

- `OTP_PEPPER` missing or short in production: login returns 500; readiness reports `config.otpPepper` false.
- `VERCEL` system variable not enabled: the client address is "unknown" and everyone shares one 30-per-hour login limit.
- The app connects as the owner: readiness is degraded and the smoke scripts stop.
- Neon asleep: the first query is slow; readiness gives `database: "timeout"` after 3 s.
- A bad migration: Neon restore within 6 hours loses rows written since. Migrations are forward-only.

**Honest limits.** There is no real SMS, payment gateway, cron or background worker running. Auto-close is lazy (it runs when a page loads), not a scheduled job (D120). Backups are only Neon's short restore window plus the seed. Real money data would need more than the free plan. A Vercel runtime log lasts about 1 hour on Hobby, so the durable record is the `error_events` table and `audit_log`. The matrix, the generated grant SQL and the readiness check are tested against a real Postgres, but not against Neon: UNVERIFIED (`pg_advisory_xact_lock` through Neon's pooler is listed in the plan as unverified).

---

## Where documents and code disagree (this file follows the code)

| Document says | Code says | Followed |
|---|---|---|
| `docs/decisions.md` D14: the approval threshold constant is 2,500,000 paise in `src/domain/seed/settings.ts`. | `src/domain/seed/settings.ts:28`: 1_000_000 (₹10,000). The matcher's own default is 2,500,000 (`src/domain/matching/context.ts:8`). | Code. |
| `docs/matching-benchmark.md`: the demo statement has 105 rows, about 27 posted. | `tests/server/sample-statement.test.ts`: 106 rows, 25 posted, 43 queued, 38 ignored. | Code. |
| `docs/matching-design.md`: the speed test budget is 6 s. | `tests/domain/matching/processor-invariants.test.ts`: the budget is 20 s. | Code. |
| `docs/auth-design.md`: four public routes. | `tests/server/route-guards.test.ts`: seven. | Code. |
| `docs/decisions.md` D1, D16, D54, D73, D86, D87, D88 say the guard, login code, safety acknowledgement or provider call is "not built yet". | They are built (`src/server/auth/guard.ts`, `otp-service.ts`, `src/server/complaints/safety.ts`, `providers/`). The classifier benchmark is still not built. | Code. |
| `docs/complaint-classification.md` says no adapter, database or screen exists. | They exist under `src/server/complaints` and the complaint screens. | Code. |
| `docs/decisions.md` D99: `lockAmount` uses `computeDues`. | `src/domain/payments/amount-lock.ts` uses `positionsForFlat`. | Code. |
| `docs/assumptions.md` R33: the payment flow is not built. | It is built; holds are still never created. | Code. |
| `docs/deployment-plan.md`: no connection timeout is set. | `src/server/db-options.ts` sets 8,000, 10,000 and 10,000 ms. | Code. |
| `docs/deployment-plan.md`: column UPDATE only on `sessions` and `otp_codes`. | `src/server/db-roles/app-role.ts` also grants column UPDATE on four more tables. | Code. |
| `CLAUDE.md` and `README.md`: every route handler uses `withPermission`. | The webhook route and six other routes use `publicRoute` (an allowlist). | Code. |
| `CLAUDE.md`: display whole rupees. | `formatRupees` prints paise when not whole; `formatRupeesRounded` rounds. | Code. |
| `CLAUDE.md`: the second approver at ₹25,000. | The demo setting is ₹10,000; the matcher default is ₹25,000. | Code. |
| `src/domain/complaints/lifecycle.ts` comment: the reopen window is assumption A4. | `docs/complaints-design.md` lists it as A2. | The doc numbering. |

The checks behind this file: `npm run check` exit 0 (4203 unit tests passed, 1 skipped) and `npm run test:ci-parity` exit 0 (the same unit tests, then 1035 integration tests in 71 files), both run on 2026-11-07.
