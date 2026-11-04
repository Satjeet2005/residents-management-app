# CLAUDE.md

## Project Safety Rules

- Local git is allowed: `git status`, `git diff`, `git log`, `git show`, `git add <named files>`, `git restore --staged <files>`, `git commit`, and creating a new local branch.
- Ask first, every time, before: `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git reset`, `git clean`, `git commit --amend`, `git stash`, any `--force` flag, deleting or creating branches or tags beyond a new local branch, editing remotes or git config, and `git init`.
- Never rewrite or delete history that has been pushed.
- Never stage with `git add -A` or `git add .`. Stage named files only, and review `git diff --staged` before every commit.
- Before every commit run `npm run check` and `npm run scan:secrets`, and paste the output in the report. Never commit if either fails.
- Never read the `.env` file. Instead, use `.env.example` as the reference for any environment-related activities.

## Commits

- Use Conventional Commits: `type(scope): imperative summary` with types feat, fix, test, docs, chore, ci, refactor, style, perf. Summary at most 72 characters.
- One logical change per commit. Code and its tests go in the same commit. A decision record goes with, or right after, the code it explains.
- Add a body (why, not what) for any non-trivial change, and name the invariant or decision it implements (for example I6 or D41).
- Every commit must pass `npm run check`. No "WIP", "fix" or "update" messages.
- Commit as the configured git user. Never change git config. If no identity is configured, stop and ask.
- Do not push. List each commit hash and message in the report, with the output of `git log --oneline`.

## What we are building
A resident app (installable web app) and staff console for a gated township in
Pune (2,400 flats). Residents pay maintenance, raise complaints and see
visitors; accounts staff match bank payments to flats; a committee reads a
monthly report. This is a 6-day take-home. A human reviewer will read the code,
tests and history. Correct money and clear structure beat feature count.

## How we work
- Do only the task in the current prompt. Do not add features, libraries or
  files it does not need. Record anything missing under "Risks" in your report.
- Write a short plan (max 10 lines) before coding. After coding, run the checks
  and paste the real output tail in your report. Never claim a check passed
  without running it.
- Label every assumption. List all of them in the report.
- Small, readable files; pure functions; no commented-out code or dead code.
- Pin exact dependency versions. Prefer stable releases. Check current docs
  before using an API you are unsure of.
- Run NO git command at all, including read-only ones (status, diff, log,
  check-ignore). To check what is ignored, read `.gitignore` instead.
- Dependency policy: ask before adding any dependency. Prefer exact versions
  published at least 14 days ago, and report each new dependency's version,
  publish date and age. Run `npm audit` before choosing an older version; keep a
  newer one only if an older one has a known vulnerability, and say so.

## Stack and architecture
- Next.js (App Router), TypeScript strict, Tailwind, Postgres via Prisma,
  Vitest (unit and integration), Playwright (e2e, later).
- `src/domain/**` is PURE TypeScript: no imports from next, react,
  @prisma/client, src/server or src/app. All money, ledger, late-fee, matching,
  safety-rule and state-machine logic lives here and is unit tested. An
  architecture test and an ESLint rule enforce it.
- `src/server/**` orchestrates domain + Prisma. Every route handler and server
  action goes through `withPermission(permission, handler)`; a test fails if
  one is exported without it.
- Validate all inputs with zod. No secrets in code; variable names only in
  `.env.example`.
- Background work: a Postgres outbox and one idempotent `processOutbox()`.

## Money and ledger rules
- Money is integer paise (BigInt). Never floats. Display Indian grouping
  (₹1,23,456), whole rupees. One `Money` helper does all conversion/formatting.
- The flat is the billing unit. The ledger is append-only (a database trigger
  forbids UPDATE and DELETE). Amounts are unsigned with a direction (CHARGE or
  PAYMENT). Balance due = charges minus payments. Corrections are new entries.
- Late fee (computed, never stored): simple interest, 12% a year
  (configurable, capped at 21%), daily balance, 365-day year, bills due on the
  10th, a payment reduces the balance from the day after its date, rounded once
  on the total. Days that begin while a payment attempt on that bill is
  unresolved are skipped.
- Payment attempts: initiated, processing, succeeded, failed, released. At most
  ONE unresolved attempt per bill (database constraint). Ledger entries post
  only on confirmed success, keyed by a unique gateway or bank reference.
- Bank statements: canonical CSV schema with the raw narration kept, a parser
  layer, idempotent row keys, every row ends in exactly one state, never
  auto-post an unclear match, manual matches need a reason, amounts of
  ₹25,000 or more need a second approver.
- Safety words (fire, gas, lift stuck, shock; also Hindi and Marathi) always
  escalate by rule before any AI runs.

## Quality bar
- `npm run check` (lint + typecheck + unit tests) passes. Integration tests run
  against a real Postgres.
- Every invariant above has a named test. New behaviour ships with tests.
- No secrets. No real personal data: every name and number is fictional.
- UI: 360px baseline; targets at least 48px with at least 8px between them;
  body 16px, captions 14px; no uppercase or letter-spacing on Hindi or
  Marathi; line height 1.5 (Latin) and 1.6 (Devanagari); loading, empty and
  error states; every affordance is either built or absent.

## Out of scope
Gate visitor flow, amenity booking, staff admin UI, multi-flat residents,
executing refunds. Receipts, ledger page, notices list and Hindi/Marathi UI are
optional and sit behind feature flags.

## Report format
End every task with the report format given in the prompt.