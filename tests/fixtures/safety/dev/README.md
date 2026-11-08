# Safety benchmark: development set

Seeds 301 to 305. Each seed makes 1,000 single-operation items, 500 double-operation items and the benign sentences (the negatives), all
synthetic and fictional, by `src/domain/complaints/safety-benchmark` (generator version `safety-perturb-1`). The detector is measured as it is;
nothing here changes it (D162).

| File | What it is |
|---|---|
| `expected.json` | The seeds, sizes and generator version; a SHA-256 digest of every seed's generated texts and truths; the integer tallies of every seed and of the existing safety-test negatives; the pooled numbers (recall with 95 percent Wilson intervals by category, language form, operation, rule and base phrase, the false-alarm rate, the 25 most fragile rules) |
| `sample.jsonl` | The first 100 single-operation items of each of the 17 operations, one JSON object per line, with `seed`, `kind` and `index` to find it again |

The 7,500 texts are NOT stored: they are rebuilt from the seeds. What "frozen" means: `tests/domain/complaints/safety-benchmark/dev.test.ts`
regenerates each seed and fails if the digest, the counts, a sample item or any metric (recomputed with the current detector) differs.
A change to the generator, the base phrases, the contexts, the negatives or the detector therefore fails that test on purpose, so it shows in review.
Regenerate only when that change is wanted: delete this folder's `expected.json` and `sample.jsonl`, run
`npx tsx scripts/safety-benchmark.ts --write dev`, and review the diff of `expected.json`.

**Use.** This set is for finding bugs in the benchmark. The holdout (`../holdout/`, seeds 9301 to 9305) is generated once, after this set was
frozen, with the same generator, and is never used to tune anything. The method and results are in `docs/safety-benchmark.md`.
