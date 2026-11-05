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
| **M4h** | The note does not say advance and does not name more than one month (`months` is empty or 1). Otherwise: "The note says advance or several months, but the amount equals one bill." |

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
| `HINT_CONFLICT` | The note says advance or several months, but the amount equals one bill. |
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

## Statement processor

`processStatement(input)` in `processor.ts` takes in a whole statement. It is pure: it reads and writes nothing
outside its arguments and never changes them.

**Input.** `rows` (valid rows from the CSV reader), `csvErrors` (what the reader refused), `flats` (the
`FlatContext` list with open bills), `settings` and `alreadyImportedKeys` (the dedupe keys of rows that an
earlier import took in).

**Order.** Valid rows are processed by transaction date, then row number, so the result does not depend on the
order the rows arrive in.

**States.** Each valid row ends in exactly one state:

| State | When | Decision |
|---|---|---|
| `AUTO_MATCHED` | the matcher said AUTO_MATCH | yes, with a plan |
| `QUEUED` | the matcher said QUEUE | yes |
| `IGNORED` | the matcher said IGNORE | yes |
| `ALREADY_IMPORTED` | the row's dedupe key is in `alreadyImportedKeys`, or repeats a payment reference seen earlier in this input | none; the row is not looked at again |

Invalid rows are not rows of the statement. They are counted in `summary.rowsRead` and `summary.invalidRows` (one per
distinct row number, and row 0, the header, counts as one), returned in `csvErrors`, and never dropped.

**Dedupe.** Each row's key is `rowDedupeKey` with an occurrence counter: the second identical row in one file is
occurrence 2, so two identical cash deposits are two payments. A row with a payment reference has the same key
whichever occurrence it is, so the same UPI payment twice in one file is one payment.

**State application (resolves C1).** The processor works on the context's own copy of every bill's payments. After an
AUTO_MATCH it records the PAYMENT on that copy (`recordPayment`) before the next row is decided, and moves the flat in the
per-date amount indexes. A later row that pays the same bill finds it paid and is queued with `NO_OPEN_BILL`; two
postings for one bill cannot come out of one statement. QUEUED and IGNORED rows change nothing. The caller's flats are never
changed (`buildMatchContext` copies the bills and their payment lists).

**Accounted.** `accounted` is computed from the data by `accountingReport`, which lists each broken condition in plain
English and is empty when all hold:

1. every row has exactly one valid state that agrees with its decision (ALREADY_IMPORTED has none);
2. the summary counts and totals equal a fresh count of the rows;
3. the four states add up to the valid rows, and valid plus invalid rows equal the rows read;
4. every AUTO_MATCHED row has a plan with exactly one PAYMENT equal to its credit;
5. `entriesToPost` is exactly those plans, in row order, with unique idempotency keys;
6. no two processed rows share a dedupe key.

**Entries.** `entriesToPost` holds the LATE_FEE and PAYMENT entries of the AUTO_MATCHED rows only. Each has the row
number, the flat code, the bill key, the amount, the effective date and the idempotency key
`bank:<dedupeKey>:<entryType>`.

### How the database layer will use it (not built yet)

1. Read the file with `parseStatementCsv`. Record the import in `statement_imports`, with the row errors.
2. Open one transaction. Take a lock that keeps other imports and manual matches away from the same bills: an
   advisory lock for the society, or `SELECT ... FOR UPDATE` on the open bills. Inside the lock, load the flats with
   their open bills, residents and known payers, and the existing `bank_rows.dedupe_key` values that match the file's
   keys, as `alreadyImportedKeys`.
3. Call `processStatement`. If `accounted` is false, roll back and report `accountingReport`; do not write anything.
4. In the same transaction write: a `bank_rows` row for every row that is not ALREADY_IMPORTED, in its state
   (`AUTO_MATCHED`, `QUEUED` or `IGNORED`; ALREADY_IMPORTED rows are not stored again); the `ledger_entries` of
   `entriesToPost`, using the idempotency key as `ledger_entries.idempotency_key`; the `payment_matches` rows of the
   AUTO_MATCHED rows; and an `accounts_queue_items` row for each QUEUED row.
5. Commit. The unique indexes on `bank_rows.dedupe_key` and the idempotency key are the final guard: if two imports race, one
   fails with a unique violation. The loser retries from step 2. The result is the same because the processor is deterministic.

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

Statement processor (`processor-invariants.test.ts`, with `processor.test.ts` and `processor-state.test.ts`):

| Id | Invariant |
|---|---|
| Y1 | Conservation: every row has one state and `accounted` is true; a corrupted copy is not accounted for |
| Y2 | Idempotence: a second run with the first run's keys is all ALREADY_IMPORTED; overlapping files skip the shared rows |
| Y3 | Two identical cash deposits are both processed; a re-import skips both |
| Y4 | State: two rows paying one bill, the second is queued; a bill is never auto-posted twice or for more than was unpaid |
| Y5 | The input is never changed |
| Y6 | The same input, or the rows reversed, give equal output |
| Y7 | Invalid rows are counted and never dropped |
| Y8 | Entries reconcile to the auto-matched total, with unique idempotency keys |
| Y9 | 5,000 rows against the 2,400-flat demo society, about 0.9 s (the test budget is 6 s) |
| Y10 | `processor.ts` is pure |

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
| Remove M4h (the note rule) | the five M4h tests that queue ADV, advance, 3 months, 3 mths and 2 month |
| The processor does not record the payment on its copy | Y4 (the two-row test and every random chunk), 4 state tests, the accounted and the example tests |
| The summary leaves out ALREADY_IMPORTED rows | Y1 (every chunk), Y2 (both tests), Y7, Y9 and the summary example |

Dropping M4a alone changes the shape of an M5 decision but no AUTO result, because M4b and M4d still guard it.

## What the matcher does not do

- It does not post anything. It returns a decision and a plan.
- `matchRow` alone does not know what earlier rows in the same file did. `processStatement` does, and applies each automatic match before the next row (C1).
- It reads only two narration hints, `advance` and a month count above 1 (M4h). It ignores `rent` and `maintenance`.
- It does not handle multi-bill, advance or partial payments except by queueing them.
- It does not use holds. A payment attempt in progress is ignored here.
- It does not read a bank, a database or the clock.

## Assumptions

- **C1.** `matchRow` is stateless: two rows that each pay a flat's oldest bill would both auto-match. `processStatement` resolves this by recording each automatic match on its own copy of the bills before the next row is decided. Anything that calls `matchRow` in a loop must do the same.
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
- **C17.** A narration that says "advance", "adv" or a month count above 1 ("3 months", "3 mths", "2 month") is never auto-matched (M4h), even when a code names the flat and the credit is exactly the amount due: the note and the amount disagree, so a person looks. "1 month" and "maint" do not block. A month count above 24 is not read as a count (`docs/bank-statements.md`, B14), so it does not block.
- **C18.** `invalidRows` counts distinct row numbers among the CSV errors, so one row with two errors is one invalid row. A file-level error (row 0, the header) counts as one. `rowsRead` is valid plus invalid rows.
- **C19.** A repeated payment reference inside one input is the same payment, so the second row is ALREADY_IMPORTED. A repeated row with no reference (cash) is a second payment and gets occurrence 2.
- **C20.** The occurrence counter depends on the order in the file. If two identical cash rows fall one in each of two overlapping files, the one in the second file is read as occurrence 1 and so looks already imported. Cash rows with a slip number do not have this problem.
- **C21.** The payment the processor records on a bill is the whole PAYMENT amount (principal plus fee), as the seed posts it, so the bill's principal is covered.
- **C22.** A row dated before a payment already on the bill is decided as of the row's date (C7), so it can be auto-matched for the full amount due on that date although a later payment exists. The database layer should pass bills as they stood on the statement's period, or refuse a statement older than the last posted payment.
- **C23.** `processStatement` throws `RangeError` for a repeated flat code, a bad bill, bad settings or a negative amount. The database layer validates before calling it.
- **C24.** The result also holds `csvErrors`, `accounted` and each row's `creditPaise`, so `accountingReport` can check it on its own.
- **C25.** Holds are not read. Whether a payment attempt is unresolved on a bill is the database layer's question.
