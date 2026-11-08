# Safety benchmark: holdout set

Seeds 9301 to 9305, the same sizes and the SAME generator as the development set (`../dev/`, generator version `safety-perturb-1`, unchanged
since the dev set was frozen in commit `fe9f75a`). It was generated and run ONCE, after the dev freeze, and its numbers were not used to change the
generator, the base phrases, the contexts, the negatives or the detector (D163). Files are as in `../dev/README.md`:
`expected.json` (digests, tallies, pooled metrics) and `sample.jsonl` (100 items per operation).

`tests/domain/complaints/safety-benchmark/holdout.test.ts` regenerates the set and fails on any difference in digest, counts, sample or
metric (recomputed with the current detector). Do not regenerate this set to "improve" a number: a set that has been tuned against is no longer a holdout.
The method and results are in `docs/safety-benchmark.md`.
