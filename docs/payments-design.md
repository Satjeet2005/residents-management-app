# Payments (T11b)

How a resident pays maintenance in the demo, with a mock gateway and a signed webhook, and what is left for the next task.
Decisions: D98 to D102 (`docs/decisions.md`). The late-fee rules are in `docs/late-fee-policy.md`.

## What is built, and what is deferred

| Built | Deferred to the next task |
|---|---|
| Pay on the Home and in the review sheet; the amount lock; `POST /api/payments` | PROCESSING, UNKNOWN and RELEASED attempts, and the Home variants for them (D33, D36, D52) |
| The mock gateway, the demo checkout page, the signed webhook | The escalation to accounts after 24 hours, and "Contact accounts" |
| Posting a confirmed success: what `planPosting` plans, a LATE_FEE charge (once, when the principal is reached) and one PAYMENT (D45, D50, D107, D110) | Skipped late-fee days while an attempt is unresolved (D41): the dues still pass `holds: []` |
| A failure: FAILED, no debit, Pay still there, a strip on the Home | The staff screens that resolve an exception |
| An exception for anything that does not fit: one OPEN accounts queue item, nothing posted | Receipts, the ledger page, notifications, the payment-confirmed animation (optional) |

## The state machine as implemented

An attempt is created INITIATED, with the amount locked and the gateway reference set. Only a gateway event moves it.

| Attempt is | Event | Result |
|---|---|---|
| INITIATED | SUCCEEDED, every guard holds | POST: what `planPosting` plans (LATE_FEE if above zero, then one PAYMENT; a PAYMENT alone for a fee-only bill); attempt SUCCEEDED, debit CONFIRMED, resolved_at |
| INITIATED | SUCCEEDED, a guard fails | EXCEPTION (the reason below); the attempt stays INITIATED; nothing posted |
| INITIATED | FAILED | MARK_FAILED: attempt FAILED, debit NOT_DEBITED, resolved_at; nothing posted |
| SUCCEEDED | SUCCEEDED, same reference and amount | DUPLICATE: nothing changes |
| FAILED | FAILED | DUPLICATE |
| SUCCEEDED | FAILED, or FAILED then SUCCEEDED | EXCEPTION CONTRADICTS_FINAL_STATE: never auto-posted |
| PROCESSING or RELEASED | any | EXCEPTION CONTRADICTS_FINAL_STATE (nothing creates these yet; a person decides) |

The rules are `decideGatewayEvent` in `src/domain/payments/attempt-state.ts`: pure, no database, tested by tables and by 2,000
seeded random cases (`tests/domain/payments/`). The guards on a success, in order:

1. the event's reference is the attempt's (else UNKNOWN_REFERENCE);
2. the event amount equals the locked amount (else AMOUNT_MISMATCH);
3. no payment on the bill is dated after the attempt's start day (else LATER_PAYMENT);
4. the bill still owed something on the start day: its position is not SETTLED (else BILL_ALREADY_PAID);
5. the locked amount equals the bill's amount due on the start day, principal plus fee or the fee alone (else AMOUNT_MISMATCH);
6. `planPosting` gives entries (a refusal is BILL_ALREADY_PAID or AMOUNT_MISMATCH; with guard 5 it cannot happen).

## The amount lock and AMOUNT_CHANGED (D99, D101)

The amount is locked when Pay is tapped, not when the Home was drawn. `initiatePayment` (`src/server/payments/initiate.ts`):

1. loads the signed-in person's own current flat (the Home's rule; nothing in the request names a flat or a bill);
2. calls `lockAmount`, which reads `positionsForFlat`, the function the Home uses: the OLDEST open position's amount due on the
   business date. An open position is a bill with principal open (principal plus fee) or a bill whose principal is paid and whose
   posted late fee is not (the remainder of the fee, D107). A test compares it with `computeDues` on 500 random flats;
3. if the amount the person saw (`expectedAmountPaise`) differs, answers AMOUNT_CHANGED with today's amount and creates nothing.
   This is what happens when midnight passes while the sheet is open: the fee grew by a day. The screen shows "The amount
   changed to ₹X. Tap Pay again." and refreshes the page behind it;
4. if an unresolved attempt already exists for that bill, returns it unchanged (a double tap, a retry);
5. otherwise inserts the attempt and the audit row PAYMENT_STARTED in one transaction. A concurrent request that lost the race
   gets the database's unique-index refusal (D40) and returns the winner.

The Pay button and the footer say "Pay ₹X", or "Pay oldest bill ₹X" only when more than one position is open. X is the oldest
position's amount, never the total ("Pay ₹38" for a bill that owes only its late fee), and the sheet says "Your oldest bill. Other bills stay due."

## The mock gateway and the signed webhook (D100, D102)

`MockGateway` gives the reference `MOCK-<attemptId>` and the checkout path `/pay/mock/<attemptId>`. It exists only when
`DEMO_MODE` is exactly `"true"`: otherwise `POST /api/payments` answers 503 `PAYMENT_PROVIDER_NOT_CONFIGURED` and the checkout
page is a real 404.

The demo checkout page (`/pay/mock/[attemptId]`, in the `(demo)` route group, labelled "Demo payment page (mock gateway)") is
for residents only and for their own flat's attempt only. Its two buttons are server actions that build the event a gateway would
send, sign it with `PAYMENT_WEBHOOK_SECRET` and send it through the same `verifyWebhook` and `applyGatewayEvent` as the real
route, then go Home. The page prints no secret and no reference.

`POST /api/payments/webhook` has no session (it is on the public allowlist) and one authentication:

- headers `x-timestamp` (whole seconds) and `x-signature` = hex HMAC-SHA256 of `"<timestamp>.<raw body>"` under the secret;
- the timestamp must be within 300 seconds of the server's clock, so a captured request cannot be replayed later;
- the signature is compared with `timingSafeEqual`; any failure is `401 { error: "BAD_SIGNATURE" }` with no detail;
- only then is the body read: `{ eventId, type: "payment.succeeded" | "payment.failed", reference, amountPaise (string) }`, zod,
  unknown fields dropped; a bad body is 400. Everything else is `200 { ok: true }` whatever was decided, so the answer reveals nothing;
- a missing secret throws (a plain 500), and in production so does a secret under 32 characters or the `replace-with...`
  placeholder: fail closed. The error never contains the secret.

## Effective dates

Every ledger entry of a payment carries the IST date the attempt STARTED, not the day the event arrived. The fee was worked out for
that day and the person agreed to that amount on that day, so the entries must say the same day: a success reported at 00:05 the
next morning posts nothing new for the day in between. The idempotency keys are `payment:<attemptId>:LATE_FEE` and
`payment:<attemptId>:PAYMENT`; the PAYMENT carries the gateway reference, which the ledger keeps unique.

## A fee paid after the principal (D107, D110)

A success on a bill with principal open posts `LATE_FEE` (once, only when the credit reaches the principal) and ONE `PAYMENT`.
A success on a bill whose principal is paid posts ONE `PAYMENT` and never a second `LATE_FEE`; the key
`payment:<attemptId>:LATE_FEE` exists only for the first. `applyGatewayEvent` reads the flat's PAYMENT, REVERSAL, LATE_FEE and
ADJUSTMENT entries and asks `positionsForFlat` for the bill's position AS OF the start day, so the decision uses the same
position the Home showed. If the fee was part paid by another route between the tap and the success, the amount no longer equals
the amount due and the success is an AMOUNT_MISMATCH exception. If another route paid the whole bill with its fee, it is
BILL_ALREADY_PAID. `tests/integration/fee-aware-dues.test.ts` runs this against a database as the app role; no new grant is needed.

## Idempotence and concurrency

`applyGatewayEvent` runs in ONE transaction whose first statement is `SELECT ... FOR UPDATE` on the attempt's row. Ten parallel
success events are run one after the other: the first posts, the other nine see SUCCEEDED and are DUPLICATE. After the attempt row, `applyGatewayEvent` takes the bill's advisory lock (`lockBill`), which the bank statement import takes too (D104,
`docs/statement-import-design.md`), so a gateway success and a bank posting cannot both pay one bill. Three more
barriers sit behind it: the unique `ledger_entries.reference`, the unique `idempotency_key`, and the unique index of one
unresolved attempt per bill. Skipping the lock and the state check makes the race test fail (the mutation in the T11b report).

## Exceptions

An exception inserts ONE `accounts_queue_items` row of type EXCEPTION referencing the attempt, with a plain-English note (no
secret), unless an OPEN one exists; it leaves the attempt as it is and posts nothing. An event for an unknown reference posts
nothing, opens no item, and writes an audit row. Every outcome writes an audit row: PAYMENT_STARTED, PAYMENT_SUCCEEDED,
PAYMENT_FAILED, PAYMENT_DUPLICATE_EVENT, PAYMENT_EXCEPTION. No screen resolves an exception yet.

## What the app role may do (D95)

INSERT and a column UPDATE (`status`, `debit_status`, `resolved_at` only) on `payment_attempts`; INSERT on `accounts_queue_items`,
`ledger_entries` and `audit_log`; SELECT as before. The amount, bill, flat and reference of an attempt can never be changed by the
app, and nothing can be deleted. `tests/integration/app-role.test.ts` reads the real privileges back.

## Security notes

- HMAC-SHA256, a 5-minute window, constant-time comparison, fail closed, no detail in the 401.
- The webhook is the only public payment route; the guard's CSRF check still applies to it (a browser page of another site is 403).
- The mock checkout exists only in demo mode and re-checks the person inside each server action (an action is a public endpoint).
- The secret is set only in the Vercel dashboard (`docs/deployment-plan.md`); it is not the Neon string. It is never in a table,
  a page, a log line or a test report; `tests/integration/payments-home.test.ts` scans what a payment writes.
- A live deployment with `DEMO_MODE=true` has the mock gateway: anyone who can log in can "pay". That is the point of a demo and
  is why `DEMO_MODE` must be `false` for real money.

## Assumptions

- **P1.** The effective date of a payment is the IST date of `started_at`. Under `DEMO_AS_OF` the attempt starts on the business
  clock, so the entries are dated the frozen date.
- **P2.** The failure strip ages from `started_at` (the business clock), not from `resolved_at` (the real clock), so it also works
  when the date is frozen; it shows while that is within 24 hours and no later attempt exists.
- **P3.** A resident who starts a payment and walks away keeps the one unresolved attempt for that bill; tapping Pay again returns
  it with its original locked amount. Releasing it (RELEASED) is the next task.
- **P4.** A FAILED event marks an INITIATED attempt failed whatever amount it carries: no money moved, so nothing can be posted wrongly.
- **P5.** A repeated success must repeat the amount to be a DUPLICATE; a different amount is AMOUNT_MISMATCH.
- **P6.** `decideGatewayEvent` takes the attempt's ids and start date as well as the fields the brief names, because the entries it
  returns must carry them. `lockAmount` takes the candidate bills (`openBills`) and the flat's PAYMENT and REVERSAL entries
  (`payments`) so that it can call `computeDues` itself.
- **P7.** A reversed payment dated after the start day does not block a success.
- **P8.** `POST /api/payments` also answers 409 `NO_DUES` when nothing is open (not in the brief).
- **P9.** An unknown reference is a 200 and an audit row, never a queue item: there is no attempt to attach it to.
- **P10.** Late-fee holds are not applied yet (the dues pass `holds: []`), so an unresolved attempt does not pause the fee.
- **P11.** The webhook timestamp is whole seconds since the epoch; milliseconds are refused.
- **P12.** The demo checkout lives in its own `(demo)` route group so that a 404 or a redirect is a real HTTP status (a page behind
  `loading.tsx` starts with a 200).
- **P13.** The input of `decideGatewayEvent` is the bill's position as of the start day (`position`, null when the bill was not yet
  issued, which is BILL_ALREADY_PAID) plus `hasPaymentAfterStart`; `planPosting` refuses a position of another date.
- **P14.** A bill whose principal was paid by a route that posted no LATE_FEE (for example a hand-made ledger entry) shows
  `FEE_NOT_POSTED`: the computed fee is owed, so a later gateway attempt locks the fee and a success for the old, larger amount is
  an AMOUNT_MISMATCH exception.
