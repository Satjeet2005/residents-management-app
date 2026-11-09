FACTS ONLY. The human writes the narrative and the reasoning.

# Limitations, cuts and next steps

Source: `docs/known-limitations.md` (read 2026-11-09). Effort in hours is the agent's reading of the S, M or L column (S about 1 to 3 hours, M about 4 to 8, L more): UNVERIFIED, an estimate and not a measurement. The brief's out-of-scope list is in `CLAUDE.md` ("Out of scope").

## Out of scope by the brief

Gate visitor flow, amenity booking, staff admin UI, multi-flat residents, executing refunds (`CLAUDE.md`). Receipts, the ledger page, the notices list and Hindi/Marathi UI are optional and sit behind feature flags.

## From the limitations table

| Limitation (shortened) | Effort | Group |
|---|---|---|
| The payment gateway is a mock (the demo checkout page and a signed webhook); | M | accepted risk |
| Payment hold and release states are not built: PROCESSING, UNKNOWN and RELEASED attempts, "no Pay again during a hold", the 24-hour escalation to accounts, "Contact accounts" (D33, D36, D47 to D53) | L | accepted risk |
| Late-fee waivers are not built (D107) | M | next step |
| Advance payments and one payment for several bills are queued, never posted automatically (`NEEDS_ADVANCE_HANDLING`) | M | next step |
| No undo of a posting | M | next step |
| Refunds are not executed (out of scope), and a duplicate payment has no handling screen | L | next step |
| A bank payment for the late fee of a fee-only bill is queued (S11 in `docs/statement-import-design.md`) | S | next step |
| The matching benchmark is synthetic: statements are made by a simulator from the demo data (`docs/matching-benchmark.md`) | M | accepted risk |
| The demo sample statement is an illustration, not a measurement (25 of 106 rows posted automatically) | S | accepted risk |
| Hindi and Marathi screens are not built (English only, D2) | L | next step |
| The Hindi, Marathi and romanised safety word lists have NOT been reviewed by a native speaker (`docs/safety-words-review.md`) | M | next step |
| The fifth safety category (medical and violence, D153) is a human-added extension of the brief's four; | S | next step |
| Safety detection is only partly robust to misspellings. | M | next step |
| Everyday electricity phrasing is no longer a CRITICAL alert, but a real shock written only as "तार में करंट आ रहा है" or "current aa raha hai" with no shock word is no longer caught by those terms | S | next step |
| The classifier was benchmarked only on SYNTHETIC complaints (200, written by the coding agent, not reviewed by a native speaker; | M | accepted risk |
| Duplicate-complaint linking and "affects me too" are not built (the events exist and are never shown) | M | next step |
| The notifications bell and list are not built (D22, D55); | M | next step |
| There is no real notification delivery: the outbox table exists, but nothing processes it (`processOutbox()` of `CLAUDE.md` is not implemented), and no cron route exists | M | next step |
| Breaker, daily cap and flood protection are per serverless instance, in memory (D141, R56, `docs/observability.md`) | S | next step |
| An error cannot be stored when the database is down | M | next step |
| Vercel Hobby: non-commercial terms, and runtime logs kept for 1 hour | S | accepted risk |
| Neon Free: 1 GB storage, 100 compute-hours a month, sleep after 5 idle minutes | S | next step |
| The hosted ledger is append-only, so every demo payment consumes demo data | S | accepted risk |
| The live site uses today's date, the seed is dated 27 October 2026 | S | accepted risk |
| Demo mode shows the login code to anyone who knows a demo phone | M | accepted risk |
| `smoke:app` is retired (D204): it failed 34 of 166 checks against the redesigned screens; the browser tests (`npm run e2e`), the unit and integration suites, `smoke:auth` and `scripts/verify-clean-clone.sh` cover what it checked | S | not needed |
| Only Chromium is tested in a real browser (D146) | S | accepted risk |
| The service worker caches only the offline page and the icons (D147) | not given | next step |
| The committee view choice (a cookie, per device, D157) no longer exists | not given | next step |
| No export or print view of the committee report; | M | next step |
| Staff admin UI, gate visitor flow, amenity booking and multi-flat residents are out of scope | L | next step |
| The security items in `docs/security.md` ("What is NOT built") | L | next step |
| The committee report has no export or print view, no "30 days ago" for Total owed (no history is kept), no Marathi or Hindi labels, and the login still goes to Staff home first | not given | next step |
| The audit that drove committee report v3 was a simulated review of screenshots, not a user study | not given | next step |
| The wrap of "Typical days to pay" and "Typical time until marked resolved" on a 360 px phone, a screen-reader pass and a large-text pass were not checked | not given | next step |

## Cut for time in the last run

| Item | Status |
|---|---|
| smoke:app repair (34 of 166 checks failed against the redesigned screens) | not done: RETIRED instead (D204) |
| Architecture diagrams, repository hygiene report, reviewer-path browser test | not done: SKIPPED (time) |
| Integration tests and `npm run test:ci-parity` | not run in the last run (fast mode); GitHub CI runs them |
