# Development benchmark set

Five synthetic bank statements of 2,000 rows each, made by `simulateStatement` (`src/domain/matching/benchmark/simulate.ts`)
from the demo dataset as of 2026-10-27. Every name, UPI id and number is fictional.

| File | What it is |
|---|---|
| `statement-<seed>.csv` | The statement in the canonical CSV schema (`Txn Date,Narration,Credit,Debit`), seeds 101 to 105 |
| `statement-<seed>.truth.json` | What each row really is, one `{rowNumber, truth}` per line. The truth is decided before the narration is written |
| `expected.json` | The metrics the matcher must give today, per statement and pooled, and a digest of each seed's population |

**What "frozen" means.** The CSV and truth files are byte-for-byte what the generator makes for each seed, and a drift test
(`tests/domain/matching/benchmark/dev.test.ts`) regenerates them and fails on any difference. The flats (who lives where, who has a
UPI id) are not stored: they are rebuilt from the seed, and `populationDigests` in `expected.json` catches a change to them.
A change to the simulator or the dataset therefore fails the drift test on purpose. Regenerate only when that change is wanted:

    BENCHMARK_WRITE=dev npx vitest run tests/domain/matching/benchmark/write-fixtures.test.ts

and review the diff of `expected.json` before committing it.

**Use.** This set is for finding bugs. The holdout set (`../holdout/`, seeds 9001 to 9005) is never used for tuning.
The method, the metric definitions and the results are in `docs/matching-benchmark.md`.
