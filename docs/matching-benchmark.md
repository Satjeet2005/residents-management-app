# Matching benchmark: method and results

The benchmark asks one question of the matcher in `docs/matching-design.md`: **how many payments does it post
without a person, and is any of them wrong?** The first number is a convenience. The second must be zero.

Everything is synthetic. The statements are made by a simulator from the demo dataset as of 2026-10-27; every name, UPI id
and number is fictional. The numbers describe this simulated society, not a real bank.

## How the statements are made

| File | Role |
|---|---|
| `src/domain/matching/benchmark/truth.ts` | What a row really is: `PAYS_BILL`, `MULTI_BILL`, `ADVANCE`, `PARTIAL`, `NOT_MAINTENANCE`, `RETURN`, `AMBIGUOUS_INTENT`, with the flat and bills |
| `src/domain/matching/benchmark/population.ts` | The people and their UPI ids. A UPI address is made for every resident, 30% are registered to their flat, and 2% of those are also registered to a second flat (a shared id) |
| `src/domain/matching/benchmark/simulate.ts` | `simulateStatement({ seed, rows })`: the CSV text and one truth per row. It has its own seeded PRNG |
| `src/domain/matching/benchmark/evaluate.ts` | `evaluate(processed, truth)`: the metrics |

**The truth is decided first, the narration second.** For each row the simulator draws a behaviour (what the payer really does),
which fixes the truth, and then draws a narration style and a rail separately. The noise in the narration can never change
the truth. This is the point of the design: a style such as "the payer writes a neighbour's flat code" is a fact about
the row, not something the matcher is allowed to know.

Each flat is the subject of at most one bill payment per statement, so two truths never contradict each other. A statement runs from
2026-10-21 to 2026-10-27, except rows that are dated before a payment already on the bill (`STALE_ORDER`).

| Behaviour | Weight | Truth |
|---|---|---|
| Exact due of the oldest bill | 14 | `PAYS_BILL` |
| Principal only (no late fee) | 2.5 | `PARTIAL` |
| Part of the due | 2.5 | `PARTIAL` |
| Two months at once | 2.5 | `MULTI_BILL`, or `ADVANCE` when one bill is open |
| Advance (2 to 6 bills) | 5 | `ADVANCE` |
| An amount that is neither the due nor the principal | 2.5 | `AMBIGUOUS_INTENT` |
| A neighbour pays the exact due of another flat | 3 | `PAYS_BILL` for the other flat |
| A row dated before a payment already on the bill | 1.5 | `AMBIGUOUS_INTENT` |
| Non-maintenance credit | 38 | `NOT_MAINTENANCE` |
| Debit | 25 | `NOT_MAINTENANCE` |
| Returned cheque | 2 | `RETURN` |

| Narration style | Weight | | Rail | Weight |
|---|---|---|---|---|
| Clean code (`T12-0408`) | 30 | | UPI | 58 |
| Messy code or one wrong digit | 15 | | NEFT | 15 |
| Another flat's code (the payer's own flat when paying for a neighbour) | 5 | | IMPS | 10 |
| Name and UPI id | 12 | | RTGS | 3 |
| UPI id only | 8 | | Cheque | 8 |
| Name only (cut short, initial, `Mr`, `MMT`) | 10 | | Cash | 6 |
| No identity (`maint`, or nothing) | 8 | | | |
| Two codes | 3 | | | |
| A code of a flat that does not exist | 3 | | | |
| A reference only | 6 | | | |

Cheque and cash rows carry no reference. The weights are the author's choices, not measurements of a real bank. They are in
`BEHAVIOUR_WEIGHTS`, `STYLE_WEIGHTS` and `RAIL_WEIGHTS`, and the narration of non-maintenance credits comes from separate
templates (vendor, hall rent, interest, a friend, a gift).

The simulator can also make overlapping statements and shuffle the row order (`simulateOverlappingStatements`, `shuffleStatement`);
`tests/domain/matching/benchmark/simulate.test.ts` checks them.

## What is measured

All of it is computed from the truth, never from the matcher's opinion of itself.

| Metric | Definition |
|---|---|
| **trueAuto** | An automatic match whose truth is `PAYS_BILL`, with the same flat **and** the same bill |
| **falseAuto** | Any other automatic match: a wrong flat, a wrong bill, or a truth that is not `PAYS_BILL` (an advance, a part, a non-maintenance credit, a returned cheque, an unclear intent) |
| **matchable** | Rows whose truth is `PAYS_BILL`: the ones the matcher could rightly post |
| **precision** | trueAuto / (trueAuto + falseAuto), 1 when nothing was posted |
| **recall** | trueAuto / matchable |
| **autoRate**, **queueRate** | Automatic matches, and queued credits, over credit rows |
| **top1**, **top5** | Of the queued rows whose truth is `PAYS_BILL`, how often the true flat is the first candidate, or among the first five |
| **wrongIgnores** | Ignored rows whose truth is not `NOT_MAINTENANCE`: money wrongly ignored |
| **accounted** | The processor's own check that every row ended in exactly one state |

Precision is the gate. Recall and autoRate are not: a matcher that queues everything has precision 1 and is useless, which is why
the gate also demands that something was posted.

## The sets, the order, and the gate

- **DEV**: 5 statements of 2,000 rows, seeds 101 to 105. For finding bugs. Frozen in `tests/fixtures/benchmark/dev/`.
- **HOLDOUT**: seeds 9001 to 9005. Generated and run **once**, after the dev results, and never used for tuning.
  Frozen in `tests/fixtures/benchmark/holdout/`.

**Order followed.**

1. Built the simulator and the evaluator.
2. Ran the dev set. The first run showed two false automatic posts. Both were a bug in the simulator's label (the later payment was on a *newer* bill, so the row was a real `PAYS_BILL` and the matcher was right), fixed in the simulator and not in the matcher. Rows dated before a bill was issued were fixed the same way.
3. The dev set then showed 2 false automatic posts that were not a bug (see below). The work stopped there and the decision was taken by a person: rule M4j (decision D70). No threshold, score or other rule was changed.
4. Re-ran the dev set only: 0 false automatic posts.
5. Froze the dev set, then generated and ran the holdout once: 0 false automatic posts. The matcher was not changed afterwards.

**The gate** (`tests/domain/matching/benchmark/gate.test.ts`), for every statement of both sets: `falseAuto` is 0, precision of
automatic posts is 1, the statement is accounted, something was posted, and the metrics equal the committed `expected.json`.
`dev.test.ts` and `holdout.test.ts` regenerate the CSV and truth and require them byte for byte (drift test), and check a digest
of the population, so a change to the simulator, the dataset or the matcher shows as a failing test and a diff to a file.
Speed: simulating 2,000 rows takes about 0.1 s, processing about 0.4 s, evaluating a few milliseconds; each benchmark test is
under 3 s on 2 CPUs.

## What the dev set found: a code alone is not a clear payment

Before M4j the dev set had 778 true and **2 false** automatic posts in 7,311 credit rows (precision 99.7%):

| Seed, row | Narration | Truth | Decision |
|---|---|---|---|
| 101, row 1932 | `UPI 427514501575 T08-0101` for 8,628.00 | pays a bill of T03-0101 | AUTO to T08-0101 (`CODE_FOUND`, `AMOUNT_EQUALS_DUE`) |
| 105, row 799 | `UPI 418837001434 T17-0304 maintenance` for 8,617.00 | pays a bill of T28-0206 | AUTO to T17-0304 (`CODE_FOUND`, `AMOUNT_EQUALS_DUE`) |

Both are a payer who names a real flat's code while paying another flat's bill, and the named flat happens to owe exactly the
same amount (53 and 55 flats owed those amounts). Nothing in the narration separates the two flats, so no rule on the
narration can. The matcher followed its rules; the rules were not strict enough for a brief that says an unclear payment is never
posted automatically. A person chose option B (D70): rule **M4j** asks for a second, independent signal, a UPI id on the same
flat as the code, a name, or an amount no other flat owes. The cost is real: recall of automatic posts fell from about 0.44 to
about 0.17, because most payers write a code and nothing else.

Which signal corroborated the 298 true automatic posts on the dev set (a post can have more than one):

| Signal | Posts |
|---|---|
| Name (exact, initial or truncated) | 279 |
| Code and UPI id of the same flat | 38 |
| UPI id of the flat, no code (and a name) | 30 |
| Only the unique amount | 1 |

## Results

"auto" is automatic matches. Every statement is accounted, `alreadyImported` is 0 and `wrongIgnores` is 0.

**Development set (after M4j)**

| Seed | credits | auto | queued | ignored | trueAuto | falseAuto | matchable | recall | autoRate | top1 | top5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 101 | 1463 | 66 | 1365 | 569 | 66 | 0 | 375 | 0.176 | 0.045 | 0.528 | 0.641 |
| 102 | 1453 | 66 | 1355 | 579 | 66 | 0 | 339 | 0.195 | 0.045 | 0.590 | 0.659 |
| 103 | 1476 | 66 | 1389 | 545 | 66 | 0 | 348 | 0.190 | 0.045 | 0.550 | 0.674 |
| 104 | 1469 | 49 | 1381 | 570 | 49 | 0 | 349 | 0.140 | 0.033 | 0.567 | 0.673 |
| 105 | 1450 | 51 | 1363 | 586 | 51 | 0 | 351 | 0.145 | 0.035 | 0.593 | 0.680 |
| All | 7311 | 298 | | | 298 | 0 | 1762 | 0.169 | 0.041 | | |

**Holdout set (run once)**

| Seed | credits | auto | queued | ignored | trueAuto | falseAuto | matchable | recall | autoRate | top1 | top5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 9001 | 1460 | 72 | 1344 | 584 | 72 | 0 | 353 | 0.204 | 0.049 | 0.587 | 0.683 |
| 9002 | 1465 | 58 | 1359 | 583 | 58 | 0 | 351 | 0.165 | 0.040 | 0.563 | 0.700 |
| 9003 | 1477 | 68 | 1385 | 547 | 68 | 0 | 366 | 0.186 | 0.046 | 0.621 | 0.742 |
| 9004 | 1433 | 57 | 1340 | 603 | 57 | 0 | 330 | 0.173 | 0.040 | 0.520 | 0.648 |
| 9005 | 1434 | 57 | 1347 | 596 | 57 | 0 | 344 | 0.166 | 0.040 | 0.589 | 0.690 |
| All | 7269 | 312 | | | 312 | 0 | 1744 | 0.179 | 0.043 | | |

The holdout gives the same picture as the dev set: no false automatic post, and about 4% of credits posted without a person.

**Why queues are where they are** (QUEUE reason codes, each once per queued row, dev / holdout, the ten most common):
`NO_MATCH` 2,427 / 2,435; `CODE_FOUND` 1,724 / 1,706; `NEEDS_SECOND_SIGNAL` 1,392 / 1,357; `MULTIPLE_FLATS_OWE` 1,357 / 1,320;
`NAME_EXACT` 1,173 / 1,139; `NO_OPEN_BILL` 960 / 912; `AMOUNT_MORE` 822 / 766; `ABOVE_THRESHOLD` 723 / 691;
`AMOUNT_EQUALS_DUE` 572 / 551; `NAME_INITIAL` 337 / 324. A row has several reasons, so these do not add up to the number of queued rows.

**The ten most frequent confusions** (truth → decision that is not ideal; dev / holdout):

| Truth → decision | dev | holdout |
|---|---|---|
| `NOT_MAINTENANCE` → queued, no confidence | 2,127 | 2,115 |
| `NOT_MAINTENANCE` → queued, low | 1,101 | 1,086 |
| `PAYS_BILL` → queued, low | 807 | 767 |
| `PAYS_BILL` → queued, medium | 657 | 665 |
| `ADVANCE` → queued, medium | 393 | 379 |
| `PARTIAL` → queued, medium | 287 | 284 |
| `NOT_MAINTENANCE` → queued, medium | 284 | 313 |
| `AMBIGUOUS_INTENT` → queued, medium | 220 | 207 |
| `ADVANCE` → queued, no confidence | 187 | 194 |
| `PARTIAL` → queued, low | 150 | 187 |

Every one of them is a row sent to a person. None is a wrong post. The largest group (more than half of these ten rows) is the
credit that is not maintenance and is queued rather than ignored, because a credit with no identity is never thrown away (M7).
About 1,400 `PAYS_BILL` rows per set reach the queue with a candidate list; the true flat is first in about 55% and in the first five in about 67%.

## The demo sample statement is not the benchmark

`src/domain/matching/sample-statement.ts` makes the 105-row statement of the demo: 14 hand-written cases, 20 well-formed payments from
residents with a registered UPI id (flat code in the note, a clean name, exactly the amount due) and simulated rows chosen so the demo
shows about 27 rows posted automatically, 40 queued and 38 ignored. **That mix is illustrative.** It is made to show the screens and
every kind of row, and it is NOT a measurement: on the benchmark's statements the matcher posts about 4 percent of the credits by itself,
because most real residents do not write their flat code. The matcher and the benchmark fixtures were not touched to make the sample.

## Mutations: does the benchmark itself catch a broken rule?

Each change was made to the matcher, the tests were run, and the change was undone (`git diff` of `src` was empty afterwards).
"Gate" is `gate.test.ts`; it fails at its first failing check, so the table says which check.

| Mutation | Unit tests that fail | Benchmark (dev, holdout, gate) |
|---|---|---|
| **1. NAME evidence counted as identity** (enough for AUTO) | 11: X3 (2), M6 name test, M4j "name of another flat", demo T15-0902, the 2,000-row check, 5 evaluate tests | **Caught, but not by `falseAuto`.** All 10 gate tests, the 5 dev and the 5 holdout snapshot tests fail because the numbers moved. `falseAuto` stayed 0: in these simulated statements a flat's name plus the amount due was always the right payer, so the benchmark has no row on which name-only posting is wrong. The unit tests are what guard X3 |
| **2. Remove M4a, M4b and M4d** | 4: the two M4b tests, the M4d "code not in the society" test, X4 "payer that agrees" | **Weakly caught.** Only dev seeds 101 and 102 change (the gate and the dev snapshot, on the snapshot check); `falseAuto` stays 0 and the holdout does not change at all. The benchmark does not protect these rules; the unit tests do. M4a, M4b and M4d overlap, and a second code or a conflicting payer already gives two identity flats, so they rarely decide alone |
| **3. Remove M4i** (later payment) | 6: two M4i tests, X9, three Z2 chunks | **Caught by `falseAuto`.** All 10 gate tests fail with false automatic posts (a stale row auto-posted before a payment already on its bill), and the 10 dev and holdout snapshot tests |
| 4. Remove M4j (the second signal) | 6: three M4j tests, two demo scenarios, the C26 order test | **Caught by `falseAuto`** on dev seeds 101 and 105 (the two rows above) and holdout seeds 9002, 9003 and 9004, and by the snapshots on the other statements |

Mutation 1 shows what a benchmark can and cannot do: it proves the matcher on the behaviour it simulates, and the unit tests prove each rule.

## Limits

- The population, the weights and the mix of narration styles are the author's choices. A real bank's statements will differ,
  and the recall of about 17% would change with them. The 0 false automatic posts is a result for this mix, not a proof.
- With 7,300 credits per set, a false-post rate below about 1 in 2,000 cannot be seen. The first dev run saw 2 in 7,311 (about 1 in 3,700), which M4j removes in these sets.
- The unique-amount signal of M4j depends on the rows before it (C26): the same row can queue or post depending on the file's order.
  In these sets it corroborated one post that nothing else did.
- Every posted payment still passes the approval threshold (M8) and the ledger rules; the benchmark does not test them.
- The benchmark runs with the matcher's built-in default threshold of ₹25,000 (`defaultMatchSettings`). The demo society's setting is ₹10,000 (D116), so on the demo the matcher queues credits of ₹10,000 or more; the benchmark's fixtures and snapshots are not changed and do not read the society setting.
- To regenerate a set: `BENCHMARK_WRITE=dev npx vitest run tests/domain/matching/benchmark/write-fixtures.test.ts`. Review the diff of
  `expected.json`. A change of the holdout is a new holdout, not a re-run.
