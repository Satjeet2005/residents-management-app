# Payment matching: decision rules and posting plan

Given one parsed bank row and the society's current state, the matcher decides one of three things:

- **AUTO_MATCH**: post the payment without a person.
- **QUEUE**: a person decides, with ranked candidates and plain reasons.
- **IGNORE**: the row is not a maintenance payment.

The headline invariant is **zero wrongly auto-posted payments**. When in doubt, QUEUE. The matcher
was designed from the rules below, not tuned to data. It is pure TypeScript in `src/domain/matching`
(no Node built-ins, no `Intl`, no randomness, no clock; `tests/domain/matching/purity.test.ts`).
It reads the parsed row described in `docs/bank-statements.md` and the late-fee rules in
`docs/late-fee-policy.md`. Decisions D7, D14, D26 and D35 in `docs/decisions.md` are what it implements.

## How it is used

```
buildMatchContext(flats, settings)          // once per batch of rows
matchRow(context, row, parseNarration(row.narrationRaw))   // once per row
```

| File | What it holds |
|---|---|
| `types.ts` | `FlatContext`, `MatchSettings`, `MatchContext`, `RowDecision`, `Candidate`, `PostingPlan`, the reason codes |
| `context.ts` | `buildMatchContext`: flats by code, by UPI id (a list, so a shared id is visible) and by name word; empty caches |
| `amounts.ts` | the amount due on a flat's oldest open bill, with `computeLateFee`; the amount index per date |
| `evidence.ts` | evidence per flat, candidate generation, scores |
| `decide.ts` | the rule table M0 to M7 and the automatic-match conditions; `matchRow` |
| `reasons.ts` | the fixed reason texts |
| `plan.ts` | `planPayment`: the ledger entries for an automatic match |

`MatchContext` is built once and read many times. It also keeps caches (late-fee results by bill
amount, due date, payments and date; an amount index per row date). The caches only save work; they
never change an answer. Build a new context when the bills change.

## Evidence

Evidence is worked out for each flat. Only CODE and PAYER identify a flat.

| Evidence | Meaning | Score |
|---|---|---|
| `CODE` | A certain, valid flat code in the narration names this flat | 100 |
| `PAYER` | The narration's UPI id is a known payer of this flat, and of **only** this flat | 90 |
| `CODE_AMBIGUOUS` | A token such as `T1 1101` can be read as this flat or another | 30 |
| `PAYER_SHARED` | The UPI id is known for more than one flat, this one included (M9) | 30 |
| `NAME_EXACT` | `nameMatchStrength` is EXACT against a resident or a payer name | 30 |
| `NAME_INITIAL` | INITIAL | 20 |
| `NAME_TRUNCATED` | TRUNCATED | 15 |

**Amount** (as of the row's transaction date, using `computeLateFee` with no holds): the amount due is
the unpaid principal plus the late fee of the flat's **oldest open bill**.

| Relation | The credit equals... | Score |
|---|---|---|
| `EQUALS_DUE` | the amount due | 40 |
| `EQUALS_PRINCIPAL` | the unpaid principal only (the fee is left out) | 25 |
| `EQUALS_BILL` | one open bill's full amount (and neither of the above) | 25 |
| `LESS_THAN_DUE` | less than the amount due | 5 |
| `MORE_THAN_DUE` | more than the amount due | 5 |
| `NO_OPEN_BILL` | the flat has no open bill | -20 |

The checks run in the order of the table.

**Scores only rank candidates.** A decision is made by rules and never reads a score. A candidate's
score is the sum of its identity evidence (CODE, PAYER), plus its best weak evidence (counted once), plus
its amount score. Ranking is score, then identity evidence first, then flat code. That ordering means
no mix of weak evidence can outrank a flat that has identity evidence.

**Candidates** are, in order: flats named by CODE or PAYER; flats with weak evidence (a shared UPI id,
an ambiguous token or a name); and, only when no flat has CODE or PAYER evidence, every flat whose
oldest open bill needs exactly the credit (as its amount due, or as its principal without the fee).
All are counted in `totalCandidates`; at most 5 are listed.

## Decision rules

The rules are in `DECISION_RULES` in `decide.ts`, in this order. The first that gives a decision wins.

| Rule | When | Decision |
|---|---|---|
| **M0** | No amount on either side | IGNORE, `NOT_MAINTENANCE` |
| **M1** | Debit (`debitPaise > 0`) | IGNORE, `DEBIT`. **Except** rail `CHEQUE_RETURN`: QUEUE, confidence NONE, reason "Cheque returned: a person must reverse the matching payment". |
| **M2** | Credit with rail `INTEREST` or `BANK_CHARGE` | IGNORE with that `ignoreKind` |
| **M3** | Credit with no narration text | QUEUE, confidence NONE, no candidates |
| **M4** | **All** conditions in the next table hold | AUTO_MATCH, confidence HIGH, with a plan |
| **M5** | CODE or PAYER evidence, but M4 fails | QUEUE, confidence MEDIUM, the flat first, with reasons that say exactly what did not match |
| **M6** | Names, ambiguous tokens, shared ids and/or amounts only | QUEUE, confidence LOW, ranked, up to 5 listed with the total |
| **M7** | No candidates | QUEUE, confidence NONE, "No flat found. May not be a maintenance payment." |

### M4: every condition must hold for an automatic match

| Id | Condition |
|---|---|
| **M4a** | Exactly one flat has CODE or PAYER evidence, and no other flat has |
| **M4b** | The narration has no second, different flat code and no ambiguous flat token |
| **M4c** | The UPI id is not listed by more than one flat (see assumption C3) |
| **M4d** | A flat code and a known UPI id, if both are there, name the same flat (otherwise "Flat code and UPI id point to different flats") |
| **M4e** | The flat has an open bill and the credit `EQUALS_DUE` for its **oldest** open bill |
| **M8** | The credit is below `approvalThresholdPaise` (M4 f). At or above it: "Needs a second approver when posted" |
| **M4g** | The rail is not `CHEQUE_RETURN` |

M4a is implied by M4b and M4d for flats that exist in the society. It stays as a second guard. M4b and M4d
also cover a code for a flat that is not in the society, which M4a cannot see.

**M9.** A UPI id known for more than one flat is **not** PAYER evidence. It gives every such flat
`PAYER_SHARED` (weak) evidence and the reason "UPI id is registered to more than one flat".

`flatCode` in a decision is set only for AUTO_MATCH and for an M5 decision with exactly one identity flat. It is
`null` for M6 even when one flat is listed: the amount or the name does not say who paid.

### Reason codes

Every decision carries at least one reason: a fixed `code` and plain English `text`. `REASON_CODES` in
`types.ts` is the list a translation will use.

| Code | Example text |
|---|---|
| `CODE_FOUND` | Flat code T12-0408 is in the narration |
| `CODE_AMBIGUOUS` | A flat reference in the narration could mean more than one flat |
| `CODE_CONFLICT` | Flat code and UPI id point to different flats; The narration names more than one flat code |
| `PAYER_KNOWN` | UPI id aamir.s@demo is known to be used by flat T21-1601 |
| `PAYER_SHARED` | UPI id is registered to more than one flat |
| `NAME_EXACT` / `NAME_INITIAL` / `NAME_TRUNCATED` | The name on the payment is the name of a resident of T12-0408 (matches except for an initial; is cut short) |
| `AMOUNT_EQUALS_DUE` | Amount equals the amount due on the oldest open bill |
| `AMOUNT_PRINCIPAL_ONLY` | Amount equals the unpaid bill but not the late fee: ₹38 would remain |
| `AMOUNT_LESS` | Amount is less than the amount due |
| `AMOUNT_MORE` | More than the amount due: possible advance or several months |
| `NO_OPEN_BILL` | No open bill on this flat |
| `MULTIPLE_FLATS_OWE` | 3 flats owe ₹10,660 |
| `ABOVE_THRESHOLD` | Needs a second approver when posted |
| `DEBIT`, `INTEREST`, `BANK_CHARGE` | Why a row is ignored |
| `CHEQUE_RETURN` | Cheque returned: a person must reverse the matching payment |
| `NO_NARRATION` | The row has no narration, so nothing says who paid |
| `NO_MATCH` | No flat found. May not be a maintenance payment. |

## Posting plan

`planPayment(flat, creditPaise, txnDate, settings)` is called for every AUTO_MATCH. When the credit equals the
amount due on the oldest open bill it returns:

1. a `LATE_FEE` entry (a CHARGE) for the computed fee, effective on `txnDate`, **only if the fee is above zero**;
2. **one** `PAYMENT` entry for principal plus fee, effective on `txnDate`.

Both carry that bill's key. This is how the seed settles a bill that is paid late (`src/domain/seed/billing.ts`).
It throws `RangeError` when the flat has no open bill or the credit is not exactly the amount due, and it
never makes two `PAYMENT` entries, because the database allows one payment per bank row.

Example, T12-0408 on 2026-10-27 paying 646,800 paise: `[LATE_FEE 9800, PAYMENT 646800]`.

## Invariants and their tests

| Id | Invariant | Tests |
|---|---|---|
| X1 | Exactly one flat: a code and a payer on different flats, or two codes, queue | `invariants.test.ts` |
| X2 | A shared UPI id never auto-matches | `invariants.test.ts` |
| X3 | Names alone and amounts alone never auto-match | `invariants.test.ts` |
| X4 | An ambiguous flat token never auto-matches | `invariants.test.ts` |
| X5 | Only EQUALS_DUE of the oldest bill auto-matches | `invariants.test.ts` |
| X6 | The threshold: below auto, at or above queue | `invariants.test.ts` |
| X7 | Debits, interest, bank charges ignored; a cheque return queues | `invariants.test.ts` |
| X8 | The demo scenarios as of 2026-10-27 | `demo-scenarios.test.ts` |
| X9 | Plan reconciliation over 500 random flats and dates | `plan-property.test.ts` |
| X10 | Reasons, plans, confidence, ordering, the cap of 5 | `demo-scenarios.test.ts` |
| X11 | Speed and purity | `demo-scenarios.test.ts`, `purity.test.ts` |

Rule-by-rule tests: `decide.test.ts`, `evidence.test.ts`, `amounts.test.ts`, `plan.test.ts`, `match-context.test.ts`.

**Why names alone and amounts alone never auto-match (X3).** Two people can share a name, the person who
pays may be paying for a neighbour, and a bank may cut a name short. Hundreds of flats have the same bill
amount, and one flat owing an amount today does not make it the payer.

### Mutations that the tests catch

| Change | Failing tests |
|---|---|
| NAME evidence counted as identity | X3 (two tests), the M6 name test, the T15-0902 scenario, the 2,000-row check |
| Drop the "no other flat" family (M4a, the second code in M4b, M4d) | X1 (two tests), M4a, M4b and M4d tests |
| Allow AUTO at or above the threshold | X6 (two tests), two M8 tests in `decide.test.ts` |

Dropping M4a alone changes the shape of an M5 decision but no AUTO result, because M4b and M4d still guard it.

## What the matcher does not do

- It does not post anything. It returns a decision and a plan.
- It does not know what earlier rows in the same file did. See C1 below.
- It does not read the narration hints (`advance`, `rent`, a month count) when deciding.
- It does not handle multi-bill, advance or partial payments except by queueing them.
- It does not use holds. A payment attempt in progress is ignored here.
- It does not read a bank, a database or the clock.

## Assumptions

- **C1.** The matcher is stateless. Rows in one file are decided against one context, so two rows that each pay the
  oldest bill of a flat would both auto-match. The statement processor (T7c) must rebuild the context, or remove a bill from it,
  after each posted row. Identical rows get different dedupe keys by design (see `docs/bank-statements.md`).
- **C2.** Multi-bill, advance and partial payments are never auto-posted in this version. Only the exact amount due on the oldest open bill is.
- **C3.** A shared UPI id blocks AUTO even when a code names one of its flats. This is stricter than M4c alone, so X2 has no exception.
- **C4.** An ambiguous flat token is not identity. Its flats are listed as weak candidates with `CODE_AMBIGUOUS`, and the row is queued.
- **C5.** A known payer of type NAME counts as a resident name for NAME evidence.
- **C6.** `CODE_AMBIGUOUS` and `PAYER_SHARED` are evidence codes the brief did not list. Each scores 30. Weak evidence counts once in a score.
- **C7.** A bill is open on the row's date when payments dated on or before that date leave principal unpaid. A payment dated after the row is ignored.
- **C8.** The late fee is worked out as of the row's transaction date, not the value date.
- **C9.** Holds are ignored (the brief says so). A bill with an unresolved attempt is treated like any other.
- **C10.** A debit whose narration is a bank charge or interest is still `DEBIT`, and carries the second reason.
- **C11.** A row with no amount on either side is `IGNORE` with `NOT_MAINTENANCE` (M0). A negative amount throws. The CSV reader already refuses both.
- **C12.** A returned cheque on the debit side is queued with no candidates. A person finds the payment to reverse.
- **C13.** Amount-only candidates need the credit to equal the amount due or the principal of the **oldest** open bill. A flat that owes the amount on a newer bill is not found that way.
- **C14.** The reason texts are English and fixed. A translation looks them up by code.
- **C15.** Resident names are the members of the flat whose membership has not ended. Which people count is the caller's choice.
- **C16.** The scores are for ranking only and are not tuned to any data.
- **C17.** A narration that says "3 months" or "advance" does not stop an automatic match when the credit is exactly the amount due and a code names the flat.
