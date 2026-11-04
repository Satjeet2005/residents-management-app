# src/domain

Pure TypeScript only. No imports from `next`, `react`, `@prisma/client`, `src/server` or `src/app`. All money, ledger, late-fee, matching, safety-rule and state-machine logic lives here and is unit tested. Enforced by an ESLint rule and `tests/architecture.test.ts`.
