# Manual reconciliation of queued bank rows (T12b)

What staff can do with a bank row the matcher did not post by itself, on the server; the screens over it are in `docs/staff-ui.md` (T12c). Decisions: D106, D108,
D109 (`docs/decisions.md`), with D7, D14, D104, D107 and D110 behind them. The import is in `docs/statement-import-design.md`, the
matcher in `docs/matching-design.md`, the late-fee position model in `docs/late-fee-policy.md` ("Principal paid, fee owed").

## The pieces

| Piece | File | What it does |
|---|---|---|
| Review | `src/server/statements/review.ts` `getRowReview` | One row, the stored decision with its reasons, and for each of at most five candidate flats: code, tower, residents' names, open positions as of the row's date (FEE_ONLY included) and how the credit compares |
| Lanes | `listRows`, `listImports` | NEEDS_YOU (QUEUED), AWAITING_APPROVAL, MATCHED (AUTO_MATCHED and MANUALLY_MATCHED), NOT_MAINTENANCE (IGNORED); biggest amount first then id; keyset pages of at most 50; lane counts and the import summary |
| Flat search | `searchFlats` | At least 2 characters: a flat code prefix (any case, with or without the separators the code reader accepts) or a resident name token; at most 10 hits |
| Match | `manual.ts` `postManualMatch` | Post by hand, or ask for approval at or above the threshold |
| Ignore, approve, reject | `approval.ts` | The second-approver flow |
| Shared steps | `manual-core.ts` | Row lock, the plan under the bill lock, writing a match, remember-payer |
| References | `reference.ts` | D106 |
| Routes | `src/app/api/...`, `reconciliation-handlers.ts` | Below |

## A manual match, case by case

The row must be QUEUED with a credit. The flat's OLDEST open position as of the row's date (by bill due date) is taken under the bill
lock from a fresh read of its ledger, and `planPosting` plans the entries. Examples, with a bill of ₹6,370 due 10 Sep and a row dated
27 Oct (fee ₹98):

| Credit | Entries | Left on the bill | Answer |
|---|---|---|---|
| ₹6,468 (equals due) | LATE_FEE ₹98, PAYMENT ₹6,468 | nothing: SETTLED | 200 POSTED |
| T21-1601, ₹5,660 (the principal) | LATE_FEE ₹38, PAYMENT ₹5,660 | ₹38 of fee owing: the Home shows "Late fee due ₹38" | 200 POSTED, `remaining: FEE_ONLY, feeOwedPaise 3800` |
| ₹1,000 (below the principal) | PAYMENT ₹1,000 | principal ₹5,370 and the fee keeps accruing | 200 POSTED, `remaining: PRINCIPAL_OPEN` |
| ₹98 to a bill that is FEE_ONLY | PAYMENT ₹98 (never a second LATE_FEE) | nothing | 200 POSTED |
| ₹7,000 (above the amount due) | nothing | | 422 NEEDS_ADVANCE_HANDLING |
| any amount for a flat with no open position | nothing | | 422 NO_OPEN_BILL |

Both entries are dated the row's date, carry the bill, are keyed `manual:<rowId>:LATE_FEE` and `manual:<rowId>:PAYMENT`, and have
`created_by_id` the staff user; only the PAYMENT carries the bank row, with the D106 reference. The row becomes MANUALLY_MATCHED with
its flat and PAYMENT, a `payment_matches` MANUAL row records who and why, and the OPEN queue item is RESOLVED (who, when, the reason as
the note). The audit row `MANUAL_MATCH_POSTED` holds ids and amounts, never narration text.

Refusals that change nothing: 409 NOT_QUEUED (not QUEUED any more, or a debit), 409 STALE (the version moved), 409 STATE_CHANGED (see
below), 422 REASON_REQUIRED (5 to 500 characters after trimming), 422 FLAT_NOT_FOUND, 403, 404.

**Remember payer.** With `rememberPayer`, and only when the parsed row has a UPI id and money was actually posted (or approved), the id
is added to `known_payers` (source MANUAL, `added_by`) once. If it already belongs to this flat nothing is added (`ALREADY_KNOWN`); if
it belongs to ANOTHER flat nothing is added and the answer says `VPA_ON_OTHER_FLAT` (the payment is still posted).

## Thresholds and the second approver (D14, D108)

A credit at or above `society_settings.approval_threshold_paise` (the demo's setting is ₹10,000, D116; the matcher's default is ₹25,000) is never posted by one person. Match and ignore then
only REQUEST approval: the row becomes AWAITING_APPROVAL, a `payment_matches` REQUEST_APPROVAL row records the requester, the reason and
`reasons {action: 'MATCH', flatCode, rememberPayer, billId, amountDuePaise}` or `{action: 'IGNORE'}`, and the queue item stays OPEN (D109).

| State | Who | Action | Result |
|---|---|---|---|
| QUEUED | `payments:match` | match or ignore below the threshold | MANUALLY_MATCHED or IGNORED, MANUAL or IGNORE decision, item RESOLVED |
| QUEUED | `payments:match` | match or ignore at or above it | AWAITING_APPROVAL, REQUEST_APPROVAL, item OPEN |
| AWAITING_APPROVAL | `payments:approve`, not the requester | approve | the requested action as above, an APPROVED decision (`decided_by` the requester, `approver_id` the approver), item RESOLVED |
| AWAITING_APPROVAL | the requester | approve | 409 SELF_APPROVAL, from the service, before the database check (J5) could fire |
| AWAITING_APPROVAL | `payments:approve` | reject (reason) | back to QUEUED, a REJECTED decision with the reason, item OPEN |
| AWAITING_APPROVAL | anyone | approve, but the bill changed since the request | nothing posted, back to QUEUED with a REJECTED decision "State changed...", 409 STATE_CHANGED |

## Locks and what is re-read (D104)

Every mutating call is one transaction. It locks the bank row (`SELECT ... FOR UPDATE`), so two people on one row take turns and the
second sees the first one's result (NOT_QUEUED). For a match it reads the flat's open positions, takes the OLDEST position's bill lock
(`lockBill`, the lock the gateway and the import use) and READS THE LEDGER AGAIN under it; if the oldest position changed meanwhile it
locks and reads again. A gateway success and a manual or approved posting for one bill therefore give exactly ONE PAYMENT: the second
sees the first one's payment and is an exception (gateway) or a refusal (NO_OPEN_BILL, STATE_CHANGED). A deadlock between two transactions is retried (`withDeadlockRetry`, D115). Real concurrent
transactions test it (`tests/integration/manual-concurrency.test.ts`).

STATE_CHANGED: the review shows the oldest position's amount due; a post may send it as `expectedAmountDuePaise`, and a different amount
under the lock refuses with nothing posted. An approval compares with the amount due recorded at the request. A live payment on the bill
dated after the row is also STATE_CHANGED (the order of payments needs a person, as the matcher says with LATER_PAYMENT).

## Routes (all `withPermission`, money as decimal strings, only a fixed error code in a refusal)

| Route | Permission |
|---|---|
| `GET /api/statements`, `GET /api/statements/[id]/rows?lane=&cursor=&limit=`, `GET /api/bank-rows/[id]`, `GET /api/flats/search?q=` | `payments:match` |
| `POST /api/statements/sample` | `payments:match`, and only when `DEMO_MODE` is exactly `"true"` (else 404 NOT_FOUND): imports the committed sample statement as `sample-statement.csv` |
| `POST /api/bank-rows/[id]/match`, `/ignore` | `payments:match` |
| `POST /api/bank-rows/[id]/approve`, `/reject` | `payments:approve` |

Statuses: 200; 409 STALE, NOT_QUEUED, NOT_AWAITING_APPROVAL, STATE_CHANGED, SELF_APPROVAL; 422 NO_OPEN_BILL, NEEDS_ADVANCE_HANDLING,
REASON_REQUIRED, FLAT_NOT_FOUND; 400 INVALID_REQUEST (a body that is not valid; unknown fields are refused); 403 without the permission
(the service checks it again); 404. A resident is 403 everywhere. The review returns only the candidates stored with that row (at most
five flats), the residents' names and no phone or id; a search returns code, tower, names and a count.

## The app role (D95)

One new grant: UPDATE of `status`, `resolved_at`, `resolved_by_id` and `note` of `accounts_queue_items`. `known_payers`,
`payment_matches`, `ledger_entries` and `audit_log` need INSERT only, `bank_rows` the four columns it already had.

## What is deliberately not built

- **Undo.** A posting is corrected by a person with a new entry, later (the `UNDO` decision exists in the enum and is unused).
- **Advance credit and several bills in one payment.** A credit above the oldest position's amount due is NEEDS_ADVANCE_HANDLING.
- **Waivers.** The late fee stays owing (D107); a waiver would be a separate, approved workflow.
- Notifications.

## Assumptions

- **M1.** `expectedAmountDuePaise` is optional on a match; a client that omits it is not protected against a payment that landed after
  the review, except by the later-payment check and the plan itself (a credit that no longer fits is refused).
- **M2.** A request for approval is checked like a post (open position, plan not refused) before it is recorded, so a request that
  could never be approved is refused at once; the approval checks again.
- **M3.** When an approval finds the state changed, the row returns to QUEUED with a REJECTED decision whose `decided_by` is the approver
  who tried it and whose reason says what changed.
- **M4.** The ledger entries of an approved match carry the approver as `created_by_id` (the person who caused the write); the requester
  is in the APPROVED decision and the audit row.
- **M5.** A person who holds `payments:approve` may also reject their own request (withdraw it); only approving it is forbidden.
- **M6.** An approval without a note is recorded with the note "Approved".
- **M7.** A rail and reference that another ledger entry already holds, or that two rows of one call share, are given the hashed D106
  reference instead of failing.
- **M8.** An AWAITING_APPROVAL row has no `flat_id` (the flat is in the request's `reasons`); the matched flat is set when it is posted.
- **M9 (closed in T12c).** The import's idempotency keys are `bank:h:<first 32 hex of SHA-256 of the dedupe key>:<TYPE>`, so no narration text is
  in a key. Only new rows get it; stored keys are not rewritten. The processor (the matcher, unchanged) still builds `bank:<dedupeKey>:<TYPE>` as an internal
  identifier; `importStatement` replaces it with the hashed key before anything is written (`bankIdempotencyKey`, `reference.ts`).
- **M10.** The search and the review use the business clock for "current residents" and "open positions today"; audit and resolution times
  use the real clock (D97).
- **M11.** A row's amount for ordering is the larger of its credit and debit (one of them is zero).
