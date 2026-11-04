# src/domain

Pure TypeScript only. No imports from `next`, `react`, `@prisma/client`, `src/server` or `src/app`. All money, ledger, late-fee, matching, safety-rule and state-machine logic lives here and is unit tested. Enforced by an ESLint rule and `tests/architecture.test.ts`.

## Modules

- `money/money.ts`: integer-paise `bigint` helpers, Indian rupee formatting and parsing, half-up rounding.
- `time/calendar.ts`: `YYYY-MM-DD` calendar arithmetic and India Standard Time day boundaries.
- `billing/late-fee.ts`: the late-fee calculation. The rules and worked examples are in `docs/late-fee-policy.md`.
- `seed/`: a deterministic generator for the fictional demo dataset (`generateDemoDataset`): flats, people, bills, ledger entries, settings, complaints (with events, classifications, duplicate clusters), visitors, known payers and notifications from a seeded random generator. See `docs/seed-data.md`.

Tests live in `tests/domain`, because a test file here may not import `vitest` under the import allowlist.
