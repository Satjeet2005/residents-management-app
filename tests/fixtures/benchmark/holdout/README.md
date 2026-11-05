# Holdout benchmark set

Five synthetic bank statements of 2,000 rows each, seeds 9001 to 9005, made by the same simulator as the development set
(`../dev/README.md` describes the files and what "frozen" means). Every name, UPI id and number is fictional.

**Rule.** This set was generated and run ONCE, after the development results, and the matcher was not changed afterwards. It is
never used to tune a threshold, a score, a reason or a rule. If it shows a false automatic post, that is reported and decided by a
person; it is not "fixed" until the number is good. The method and results are in `docs/matching-benchmark.md`.

Regenerating it (`BENCHMARK_WRITE=holdout`, see `../dev/README.md`) is only for a change that is wanted in the simulator itself, and the
new numbers must be reviewed like a new holdout, not trusted.
