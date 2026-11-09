FACTS ONLY. The human writes the narrative and the reasoning.

# 01 Architecture

## Layers

| Layer | Path | One line |
|---|---|---|
| Domain | `src/domain` | Pure TypeScript: money, late fee, matching, safety rules, state machines. |
| Server | `src/server` | Services, guards (`src/server/auth/guard.ts`) and Prisma access. |
| App | `src/app` | Next.js App Router pages, layouts and route handlers under `src/app/api`. |
| Components | `src/components` | Shared React UI. Presentation only. |
| Lib | `src/lib` | Small framework-neutral helpers that are not business rules. |
| Database | `prisma` | Schema, hand-edited migrations, and `prisma/README.md`. |
| Scripts | `scripts` | Smoke tests, seed helpers, benchmarks, log reader, doc checker. |
| Tests | `tests` | Cross-cutting tests, integration tests on real Postgres, e2e, UI tests. |

Source for the one-line texts: `src/domain/README.md`, `src/server/README.md`, `src/app/README.md`, `src/components/README.md`, `src/lib/README.md`.

## The rules that connect the layers

| Rule | Where it is stated | Where it is enforced |
|---|---|---|
| `src/domain` must not import next, react, `@prisma/client`, `src/server` or `src/app`. | `CLAUDE.md`, `src/domain/README.md` | ESLint `no-restricted-imports` for `src/domain/**` in `eslint.config.mjs`. |
| Same rule, tested. | D65 | `tests/architecture.test.ts` lints sample files and expects errors for `@prisma/client`, `next/server`, `react`, `@/server/db`, `@/app/page`. |
| Domain imports are an allowlist. | D65 | `tests/domain-imports.test.ts` allows only `zod` and relative paths that stay inside `src/domain`. |
| Every route handler is `withPermission(...)` or an allowlisted `publicRoute(...)`. | D81 | `tests/server/route-guards.test.ts` :: "every exported method of every route is wrapped, and no route reads the session or cookies itself" |
| Every non-public page calls `requireUser`. | D81 | `tests/server/page-guards.test.ts` :: "every page that is not on the public allowlist calls requireUser" |
| Public routes are a fixed allowlist. | D81 | `tests/server/route-guards.test.ts` :: "the only public routes are the seven on the allowlist plus nothing else" |
| Guard is at the route, not in middleware. | D81 | Stated in `docs/decisions.md`. |

Facts found while reading:

| Fact | Evidence |
|---|---|
| The domain allowlist permits `zod`. | `tests/domain-imports.test.ts` has `ALLOWED_PACKAGES = ["zod"]`. |
| No file under `src/domain` imports `zod` today. | A grep for `from "zod"` in `src/domain` found nothing. |
| The ESLint domain rule also blocks relative paths such as `../server` and `../../app`. | `eslint.config.mjs`, list `FORBIDDEN_IN_DOMAIN`. |
| The `@/` alias maps to `src`. | `vitest.config.mts` |

## Technology

| Item | Version | Source |
|---|---|---|
| Node | 24.15.0 (`engines.node` is `24.x`) | `.nvmrc`, `package.json` |
| Next.js | 16.4.2 | `package.json` |
| React and React DOM | 19.3.0 | `package.json` |
| TypeScript | 5.9.3 | `package.json` |
| Prisma and `@prisma/client` | 7.10.1 | `package.json` |
| Prisma driver adapter `@prisma/adapter-pg` | 7.10.1 | `package.json` |
| `pg` driver | 8.23.1 | `package.json` |
| Database | Postgres | `docker-compose.yml`, `prisma/schema.prisma` |
| Tailwind CSS | 4.3.3 | `package.json` |
| zod | 4.6.7 | `package.json` |
| ESLint | 9.39.5 | `package.json` |
| Vitest (unit and integration) | 5.0.5 | `package.json` |
| Playwright (browser tests) | 1.64.1 | `package.json` |
| axe-core for Playwright | 4.14.0 | `package.json` |
| tsx (script runner) | 4.23.15 | `package.json` |
| Fonts | IBM Plex Sans 5.3.0 and the Devanagari package 5.3.0, self-hosted | `package.json`, D18 |

All versions in `package.json` are exact, with no `^` or `~`.

## Deployment shape

| Item | Fact | Source |
|---|---|---|
| Host | Vercel Hobby plan | `deployment.md`, D89 |
| Database | Neon Free plan, Singapore (`aws-ap-southeast-1`), database `neondb` | `deployment.md` |
| Function region | `sin1`, the same AWS region as the database | `docs/deployment-plan.md` Decision 2 |
| Owner role | `neondb_owner` owns the tables. It is used only on the developer laptop for migrations, seed and grants. | `deployment.md` |
| App role | `township_app` does not own the tables. Its grants come from one matrix. | `deployment.md`, `src/server/db-roles/app-role.ts` |
| App role on append-only tables | SELECT and INSERT only. | `src/server/db-roles/app-role.ts` (`APPEND_ONLY_TABLES`) |
| App role UPDATE | By column only. No DELETE or TRUNCATE on any table. | `src/server/db-roles/app-role.ts` |
| Logs role | `township_logs` is read-only. It reads `error_events` from the developer machine. | `deployment.md`, `src/server/db-roles/logs-role.ts` |
| Logs role secret | `LOGS_DATABASE_URL` is for the developer machine only and is never set in Vercel. | `.env.example`, `deployment.md` |
| App role on `error_events` | INSERT only. | `src/server/db-roles/app-role.ts`, D136 |
| Production `DATABASE_URL` | The pooled `township_app` string. | `deployment.md` |
| Readiness check | `GET /api/health/ready` reports whether the connected role is limited. It answers 503 if the app runs as the owner. | `docs/security.md`, D112 |
| Why no owner role in the app | The owner can switch off the append-only triggers. | D95 |
| Background work | A table `outbox_jobs` exists. Nothing processes it. No cron route exists. | `docs/known-limitations.md`; no `processOutbox` found in `src` or `tests` |
| Demo mode | `DEMO_MODE=true` returns the login code in the API response for demo phones. | D77, D90 |
| Local database | Docker Compose, image `postgres:16`, host port `DB_PORT`, default 5436. | `docker-compose.yml`, D159 |

## Major choices

| Choice | Decision | Reason (from `docs/decisions.md`) | Alternative rejected |
|---|---|---|---|
| Next.js full stack in TypeScript on Postgres | D8 | One language and one deployable unit suit a six-day build. | Not recorded. |
| Prisma as the database layer | D12 | A typed schema and migrations in one tool. | Not recorded. |
| Pure domain layer with an import allowlist | D65 | The domain can be tested without a framework or a database. | Not recorded. |
| Vercel with Neon | D10 | No always-on worker is available on the free tier. | Not recorded in `docs/decisions.md`. |
| Neon-Vercel integration not used | D91 | The integration injects the owner role (see `docs/deployment-plan.md` Decision 10). | The integration, option B of Decision 10. |
| Singapore for database and functions | D91 | Closest Neon region to India, matching Vercel `sin1`. | Mumbai: Neon has no Mumbai region (`deployment.md`). |
| Vercel Hobby with a disclosure | D89 | Hobby is free and needs no card, but may be shut down. | Not recorded. |
| Flat is the billing unit | D6 | The society bills flats, not people, and people change. | Not recorded. |
| Single-entry ledger, one per flat | D11 | A balance per flat is all the society needs. | Double entry (named in the reason only). |
| Unsigned ledger amounts with a direction | D13 | A sign is easy to get wrong, and a stored balance can drift. | Not recorded. |
| Money as BigInt paise, one `Money` formatter | D63 | No floats means no rounding drift. | Not recorded. |
| Late fee computed, never stored | D64 | A stored fee goes stale when a payment or a hold changes. | Not recorded. |
| Rules enforced in SQL | D60 | The database refuses bad rows whatever code writes them. | Not recorded. |
| Append-only triggers | D61 | History must not be rewritten, and corrections are new entries. | Not recorded. |
| Same-flat composite foreign keys | D62 | A ledger entry cannot point at another flat's bill. | Not recorded. |
| One unresolved attempt per bill | D40 | Two attempts in flight on one bill could both post. | Not recorded. |
| Payment posts only on confirmed success | D45 | Posting on an unconfirmed signal can credit money never received. | Not recorded. |
| Mock payment gateway with signed webhook | D100 | The demo goes through the same verify-and-apply path a real one would. | A real provider (out of scope). |
| One advisory lock per bill, shared by gateway and bank | D104 | The second side sees the first one's payment, so a bill is never paid twice. | Not recorded. |
| Hand-built OTP login with database sessions | D16 | An OTP needs no password reset flow, and a session can be ended at once. | Password login (implied only). |
| Non-owner app database role from one matrix | D95 | A role that is not the owner cannot switch off the triggers. | App as owner (see `docs/deployment-plan.md`). |
| Route guard at the route | D81 | A guard that someone can forget is not a guard. | Middleware-only checks. |
| Integration tests on real Postgres | D17 | Most invariants live in SQL, and a mock cannot test SQL. | Mocked database. |
| Tests must not need a developer `.env` | D128 | A green local run that CI cannot reproduce is worth nothing. | Not recorded. |
| Complaint chain: rules, LLM, keyword fallback, triage | D9 | Rules decide dangerous cases before any model runs. | Not recorded. |
| Complaint classification runs inline | D118 | The keyword fallback is instant, so a queue would add a failure mode. | A queue and worker. |
| Auto-close runs lazily, not by cron | D120 | There is no scheduler in the deployment. | A cron job. |
| Cron endpoint deferred | D92 | Hobby cron runs once a day and there is nothing to run yet. | Not recorded. |
| Own error log in Postgres, read by the developer only | D135 | Vercel Hobby keeps runtime logs for 1 hour, and our own table adds no dependency. | Not recorded. |
| Passbook design system, self-hosted fonts | D18 | A ledger-like look suits the subject, and no font request leaves the site. | Not recorded. |
| 360 px baseline | D37 | It is the common small Android width. | Not recorded. |
| Committee report computed live | D131 | One function for every figure cannot disagree with the Home. | A stored total (named in the reason only). |
| Seed is deterministic and guarded | D68 | A seed or reset must never hit the wrong database. | Not recorded. |

UNVERIFIED: whether a Vercel config file exists was not checked.
