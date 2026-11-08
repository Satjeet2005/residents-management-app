# Safety benchmark: holdout 2 (the independent run of T10c)

Seeds 9401 to 9405, the same sizes and the SAME generator as the development set and the first holdout (generator version `safety-perturb-1`, asserted by
`tests/domain/complaints/safety-benchmark/holdout2.test.ts`). It was generated AFTER the detector (D168 normalisation, D169 shock context) was frozen in commit
`fe89698`, and it was run ONCE: `npx tsx scripts/safety-benchmark.ts --write holdout2` refuses to overwrite. Its numbers were not used to change the detector,
the generator, the base phrases, the contexts or the negatives. Files are as in `../dev/README.md`.

This is the independent evidence of the improvement. The first holdout (`../holdout/`) was visible before the change and is only reused.
The numbers at the earlier detector states (computed afterwards, from git, on the same texts, to show the before) are in `../history.json`.
