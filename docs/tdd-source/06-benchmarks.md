FACTS ONLY. The human writes the narrative and the reasoning.

# Benchmarks

Numbers copied from fresh output of 2026-11-09 or from committed files. Limits are in each source document.

## Matcher benchmark (`docs/matching-benchmark.md`)

| Item | Fact |
|---|---|
| Method | A simulator makes bank statements from the demo data with a known truth per row; the matcher runs; precision of automatic posts is the gate |
| Dev set | 5 statements of 2,000 rows, seeds 101 to 105, frozen in `tests/fixtures/benchmark/dev/` |
| Holdout | 5 statements of 2,000 rows, seeds 9001 to 9005, run once, frozen in `tests/fixtures/benchmark/holdout/` |
| Dev result (`tests/fixtures/benchmark/dev/expected.json`) | 10,000 rows, 7,311 credits, 298 posted automatically, 298 true, 0 false, recall 0.1691, auto rate 0.0408 |
| Holdout result (`tests/fixtures/benchmark/holdout/expected.json`) | 10,000 rows, 7,269 credits, 312 posted automatically, 312 true, 0 false, recall 0.1789, auto rate 0.0429 |
| Reproduce | `npx vitest run tests/domain/matching/benchmark` (the gate is `tests/domain/matching/benchmark/gate.test.ts`; it also runs in `npm run check`) |
| Limits | The statements are simulated. They say nothing about a real bank file |

## Safety benchmark (`docs/safety-benchmark.md`)

| Item | Fact |
|---|---|
| Method | Spelling damage is applied to known safety phrases and the detector must still hit; benign sentences must not |
| Sets | dev, holdout and holdout2 (5,000 single-operation items and 2,500 double-operation items each) |
| Result, fresh run of `npm run safety:benchmark` | dev single 47.00% (2350/5000), holdout 45.84% (2292/5000), holdout2 46.14% (2307/5000) |
| Result, two damages | dev 20.80%, holdout 20.12%, holdout2 20.80% |
| False alarms on negatives | dev 3.23% (52/1608), holdout 3.01% (48/1595), holdout2 3.39% (54/1594) |
| Check | the command prints "every committed number matches a fresh computation" |
| Limits | There is no pass threshold. The data is synthetic |

## Classifier benchmark (`docs/classifier-benchmark.md`, D195)

| Item | Fact |
|---|---|
| Method | 200 synthetic complaints go once to the primary provider; the production acceptance rule judges the answers; a keyword arm and a production arm are compared |
| Dataset | 200 items, 5 categories x 4 language groups x 10; sample of 60 with seed 42 for the second provider |
| Primary, category | accepted 92.5% (185/200), right among accepted 99.5% (184/185); D87 PASS in every language group |
| Primary, urgency | accepted 83.0%, right among accepted 85.5%; D87 FAIL in every group |
| Keyword baseline | accepted 77.5%, right 92.3%; Marathi 89.7% is a FAIL |
| Production arm | classified automatically 98.5%, right 97.5% |
| Latency, availability | p50 530 ms, p95 975 ms; 198 of 200 answered |
| Second provider | 0 of 60 answered (54 status 400, 4 timeouts, 2 network failures) |
| Reproduce | `npm run classifier:benchmark -- --from-fixture` (no network) |
| Limits | Synthetic, written by the agent, no native-speaker review, 10 items per cell |
