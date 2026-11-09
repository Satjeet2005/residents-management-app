FACTS ONLY. The human writes the narrative and the reasoning.

# How the coding agent was used: facts

Read from the repository on 2026-11-09. No narrative.

## The protocol, from `CLAUDE.md`

| Rule | Fact |
|---|---|
| Scope | "Do only the task in the current prompt"; record what is missing as risks |
| Plan and report | A short plan before coding; a fixed report format after, with real command output |
| Git | Named files only; no `git add -A`; no push, pull, fetch, merge, rebase, reset, clean, amend, stash or force without asking |
| Commits | Conventional Commits; one logical change per commit; code and its tests together |
| Checks | `npm run check` and `npm run scan:secrets` before every commit |
| Secrets | Never read `.env`; use `.env.example` |
| Databases | A destructive command only on `township_test_*` or `township_seed_scratch`, after printing `SELECT current_database()` |
| Dependencies | Ask before adding any; pin exact versions |
| Stop and ask | Any product, scope, risk or cost decision not in `docs/decisions.md` |

## Things the agent was forbidden to decide

Pushing, pulling, rewriting history, adding a dependency, reading `.env`, touching a database other than the scratch names, and any product, scope, risk or cost decision not already in `docs/decisions.md` (`CLAUDE.md`, "Project Safety Rules" and "Standard task protocol").

## Verification mechanisms that exist

| Mechanism | Where |
|---|---|
| A differential test of a decision change: 2,000 seeded answers against the old logic, only the intended case differs | `tests/domain/complaints/decision.test.ts` ("CP11") |
| Pre-commit hook runs `npm run check` and `npm run scan:secrets` | `.git/hooks/pre-commit` (local, not versioned) |
| Continuous integration | `.github/workflows/ci.yml` |
| Unit and integration split; CI-parity run with no `.env` | `npm run test:ci-parity`, `scripts/test-ci-parity.sh` |
| Mutation evidence in task reports | `docs/overnight-report.md` (11 "Mutation" lines) |
| Independent SQL beside loader figures | `tests/integration/committee-report-v2.test.ts`, `tests/integration/staff-home.test.ts` |
| Frozen benchmark holdouts, with drift tests | `tests/fixtures/benchmark/`, `docs/safety-benchmark.md` |
| Documentation reference check | `npm run docs:verify` |

## Counts (commands run 2026-11-09)

| Fact | Value | Command |
|---|---|---|
| Commits | 419 | `git log --oneline | wc -l` |
| Commits with a co-author trailer | 409 | `git log --format=%B | grep -ci "co-authored-by"` |
| Decision rows whose status says human | 24 | `grep -o "Confirmed (human[^|]*" docs/decisions.md | wc -l` |

## HUMAN TO WRITE

1. What I decided myself.
2. What I rejected from the agent.
3. Where I overruled the agent.
4. What I verified myself.
5. What I would do differently.
