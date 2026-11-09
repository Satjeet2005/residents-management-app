# tests

Cross-cutting tests: architecture rules and integration tests (`tests/integration`, run against a real Postgres with `npm run test:integration`). Unit tests for a module sit beside it as `*.test.ts`.

## Time-bounded tests

A test that asserts an elapsed time measures the best of five runs after one untimed warm-up (`tests/helpers/best-of.ts`, tested in `tests/helpers/best-of.test.ts`). A real slowdown makes every run slow, so the best still crosses the limit; a scheduler pause on a loaded two-CPU runner hits one run only. A limit, timeout or tolerance is never raised to make a test pass (D242). Measured: pinned to 2 CPUs with nothing else running, the committee report loads in about 1.5 s against its 3 s limit; with the whole unit suite running on the same 2 CPUs, even the best run was 3.0 to 3.3 s in 8 of 20 runs, because the machine was starved for the whole window (not noise).
