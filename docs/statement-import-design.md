# Bank statement import on the server (T12a)

How an uploaded statement becomes bank rows, ledger postings and queue items, in one transaction, with no screen yet.
Decisions: D103 to D105 (`docs/decisions.md`). The matching rules are in `docs/matching-design.md`, the CSV format in
`docs/bank-statements.md`, the gateway side of paying a bill in `docs/payments-design.md`.

## The flow (`importStatement`, `src/server/statements/import.ts`)

1. **Read and refuse.** The file is refused before any database work if it is over 2,000,000 characters, has more than 20,000 rows
   (valid plus invalid) or contains a NUL byte (`StatementLimitError`, a `RangeError`; the route answers 413, and 422 for NUL).
   `parseStatementCsv` reads it. An error on row 0 (the header) is fatal: `INVALID_CSV` with the errors, nothing stored.
   Bad data rows are not fatal: they are counted (`invalidRows`), returned (the first 50) and never dropped.
2. **One transaction.** It takes `pg_advisory_xact_lock(hashtext('statement-import'))` after `SET LOCAL lock_timeout = '5s'`, so imports
   run one after the other and a wait of 5 s is `IMPORT_IN_PROGRESS` (409). Inside the lock it loads the matching context
   (`loadMatchContext`, six queries, `src/server/statements/context.ts`), computes the row keys (`computeRowKeys`), asks which of those keys
   are already stored (in chunks of 1,000) and runs `processStatement`.
3. **Re-validate the automatic matches.** Every AUTO_MATCHED row names a bill. The bills are locked (`lockBill`, sorted by id, so the order never
   differs) and then read once more, with their payments, for ALL the automatic rows together. A row whose bill no longer owes exactly the planned
   amount on the row's date, or has a live payment dated after the row, is downgraded to QUEUED with the reason `STATE_CHANGED`
   (`downgradeRows`, pure) and counted in `downgraded`. The locks are held until the commit, so what was read is still true when the
   entries are written.
4. **Write.** The import row; a bank row for every NEW valid row (never for ALREADY_IMPORTED); for each automatic row the LATE_FEE (only when above
   zero) and ONE PAYMENT, dated the row's date, with the bill, the PAYMENT carrying the bank row and its D106 reference (`bank:<rail>:<bank reference>` in clear, else `bank:h:` and 32 hex of the SHA-256 of the dedupe key; never narration text); the bank
   row set AUTO_MATCHED with its flat and ledger entry (version up by one); a `payment_matches` row (decision AUTO, the top candidate's score, the
   reasons, the candidates, no human); an OPEN `accounts_queue_items` row of type BANK_ROW for each QUEUED row; and the audit rows.
5. **Read back and check.** The counts are read from the database (rows per state, open queue items, the PAYMENT count and total) and compared with
   the processor's books (`isAccounted`). If they differ the transaction is rolled back with an error: a statement is saved only when every row is
   accounted for.

`hooks` (`afterSnapshot`, `beforeCommit`, `lockTimeoutMs`) exist for tests only: they let a test commit a gateway payment between the snapshot and the
postings, throw before the commit, or shorten the lock wait. Production callers never pass them.

## Locks, and why

| Lock | Taken by | Why |
|---|---|---|
| `hashtext('statement-import')` | every import | Two imports of overlapping files would both see a key as new and the second would hit the unique index. One at a time makes the second see the first's rows and skip them. Held to the end of the transaction. |
| `hashtext(<bill id>)` (`lockBill`, `src/server/payments/bill-lock.ts`) | the import (for each automatic bill) and `applyGatewayEvent` | A bill can be paid by the gateway or by a bank row. Both read the bill's payments only after this lock and keep it until they commit, so the second one sees the first one's payment. The gateway side then becomes BILL_ALREADY_PAID or LATER_PAYMENT, the bank side a downgrade. Never two PAYMENTs. |
| the attempt row (`FOR UPDATE`) | `applyGatewayEvent` | Two events for one attempt run one after the other. |

Deadlocks: the import takes its global lock first and then bill locks in sorted order and never locks an attempt row; the gateway takes one attempt row and
then one bill lock and never the global lock. No two of them can wait for each other. The 5 s `lock_timeout` also covers the bill locks.

## State mapping

| Processor state | `bank_rows.state` | Ledger | Queue item | `payment_matches` |
|---|---|---|---|---|
| AUTO_MATCHED (and still true at posting) | AUTO_MATCHED, with `flat_id` and `ledger_entry_id` | LATE_FEE (if above zero) and one PAYMENT | none | one AUTO row |
| AUTO_MATCHED but the bill changed | QUEUED, reason STATE_CHANGED | none | one OPEN BANK_ROW item | none |
| QUEUED | QUEUED | none | one OPEN BANK_ROW item | none |
| IGNORED (debit, interest, bank charge, not maintenance) | IGNORED | none | none | none |
| ALREADY_IMPORTED | not stored | none | none | none |

A bank row is created QUEUED first because the database's state-and-links check (J3) requires an AUTO_MATCHED row to have its ledger entry, and the entry
needs the row.

## What is stored

- `statement_imports`: uploader, filename, SHA-256 of the text, `rows_read` (valid plus invalid), and `notes`, a JSON text with counts only (invalid rows, already imported,
  downgraded, credit total). Rows an earlier import held are not stored again, so their count lives here; `getStatementSummary` reads it back.
- `bank_rows.parsed`: the narration reader's output plus a `decision` object: kind, confidence, reasons, at most 5 candidates, how many there were, the ignore kind.
  The posting plan is not kept (the ledger holds what was posted).
- Audit: `STATEMENT_IMPORTED` (counts only) and `BANK_ROW_AUTO_POSTED` per batch of 50 automatic rows (bank row and ledger entry ids). Neither holds narration text.

## Bills whose principal is paid (D107)

The matcher is not changed. `loadMatchContext` hands it only the bills whose position is `PRINCIPAL_OPEN`, which is exactly the
bills whose payments are below the bill amount. A bill whose principal is paid but whose posted late fee is not (`FEE_ONLY`) is
therefore **invisible to the matcher**: a bank payment for that fee has no open bill, so it is queued as NO_OPEN_BILL for a
person. This is a documented limit; the benchmark, the dev and holdout snapshots and the sample statement's state counts are
unchanged (their tests pass untouched). Inside the transaction `staleRows` re-validates each automatic row with `billPosition`
(through `positionsForFlat`, which also reads the bill's LATE_FEE and ADJUSTMENT entries): the bill must still be `PRINCIPAL_OPEN`
on the row's date and `planPosting` must give exactly the entries the matcher planned (a LATE_FEE and one PAYMENT for an
equals-due credit), or the row becomes QUEUED with STATE_CHANGED. Only equals-due payments are posted automatically.

## Limits (not built yet)

No undo and no screen. A payment above the approval threshold, an advance, a payment for several bills, a part payment and an unclear payer are all queued
for a person; what a person can do with a queued row is in `docs/manual-reconciliation-design.md` (T12b), and a later task builds the screens.

## Assumptions

- **S1.** A fatal header problem is any error on row 0. A NUL byte is answered like a bad file (422 INVALID_CSV with one error), not like a big one.
- **S2.** `now` is the business clock (D97). It decides which bills are open and which memberships are current; the amounts are worked out as of each row's own date.
- **S3.** The automatic rows' bills are locked together and read once, instead of lock-and-read per row: the same guarantee in a constant number of queries.
- **S4.** The ledger `reference` is `bank:<dedupeKey>`, as asked. A key of a row without a payment reference holds up to 80 characters of the normalised narration, so a
  name can end up in a ledger reference. A key longer than 120 characters is cut and given a hash of the whole key. Whether to hash it fully is a decision for the human.
- **S5.** A row that the processor queued because an automatic row of the same statement paid its bill stays queued if that automatic row is downgraded afterwards.
- **S6.** A file whose rows are all repeats still creates an import row and an audit row, and changes no bank row, entry, match or queue item.
- **S7.** `created_by_id` of the ledger entries is empty: an automatic posting has no human, like its `payment_matches` row. The uploader is in the audit log.
- **S8.** The commit that adds the per-bill lock to the gateway comes before the commit that adds the import, so no commit posts from the bank without it.
- **S9.** The sample statement's expected counts (27 posted, 40 queued, 38 ignored, 105 rows) are for the seeded database; after T12-0408 pays through the gateway, 26 are posted and 41 queued.
- **S10.** The match context decides "open" with the matcher's own rule (payments below the bill) instead of running `billPosition` for
  every bill of the society: the two are the same set (PRINCIPAL_OPEN), a test compares them for every flat of a seeded database, and
  it keeps the context to six queries.
- **S11.** A bank payment for the late fee of a FEE_ONLY bill is queued, not matched: a person posts it. Matching it needs a matcher
  change, which this task does not make.
- **S12.** The sample statement is an ILLUSTRATION made to show every kind of row and a society that follows the payment-note instruction (20
  well-formed payments from known UPI ids, 27 of 105 rows posted automatically). It is NOT the benchmark: on the benchmark's statements the
  matcher posts about 4 percent of the credits by itself (`docs/matching-benchmark.md`). Its mix is set by the generator
  (`src/domain/matching/sample-statement.ts`), not by the matcher, which is unchanged.
