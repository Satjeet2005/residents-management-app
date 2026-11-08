# Security notes

Written 2026-11-08 for a reviewer who has not seen the project. It lists what is built, with the file or the test that shows it, and what is NOT built and
what a production system would add. Language: the design is "aligned with" published guidance in the places named; nothing here is a claim of compliance or
certification, and I am not a lawyer. Where a statement could not be verified in the repository it is marked UNVERIFIED with the reason.

This is a take-home demo. Real SMS and a real payment gateway are mocked (`docs/known-limitations.md`), and with `DEMO_MODE=true` the login code is shown on
screen, so the demo is deliberately open to anyone who can reach it (see "The demo's own risk" below).

## What is built

Every row names where to look. A path under `tests/` is a test that fails if the behaviour is removed.

### Login and sessions

| Control | What it does | Where |
|---|---|---|
| One-time codes stored as an HMAC | A code is 6 digits, lives 300 seconds, allows 5 attempts. The database holds only HMAC-SHA256 of `phone:code` under a secret (`OTP_PEPPER`), so a stolen table cannot be brute-forced without it. The comparison is constant time. | `src/server/auth/crypto.ts`, `src/server/auth/otp-service.ts`; `tests/server/auth-crypto.test.ts`, `tests/integration/otp-service.test.ts`, `tests/integration/otp-codes-constraints.test.ts` |
| Rate limits and a generic answer | 30 seconds between codes for a phone, 5 codes per phone and 30 per address per hour, counted in the database. A known phone and an unknown phone get the same answer; a wrong, expired or locked code gets one generic error key. Only the newest code for a phone is valid. The limits apply in demo mode too (D84). | `src/domain/auth/policy.ts`; `tests/domain/auth/`, `scripts/smoke-auth.mjs` (checks the 429, the same-shape answers and the generic key over real HTTP) |
| Database sessions | A session is a row. The cookie holds a 256-bit random token; only its SHA-256 hash is stored (D79), so a database leak gives no working session. Idle and absolute limits are enforced on the server, per role: residents 14 days idle and 30 days overall, staff 30 minutes idle and 12 hours overall (D74, D75). A session can be revoked (`logout`, `logout-all`) and an inactive user is refused on the next request. | `src/server/auth/session-service.ts`, `src/domain/auth/policy.ts`; `tests/integration/session-service.test.ts`, `tests/domain/auth/session.test.ts` |
| Session cookie follows the request scheme | `__Host-session` with `Secure` over https, `session` without `Secure` over plain http (a browser would not store a Secure cookie from `http://localhost`); always `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` (D94). | `src/server/auth/cookie.ts`; `tests/server/cookie.test.ts`, `tests/integration/cookie-scheme.test.ts` |
| CSRF origin checks | A `POST`, `PUT`, `PATCH` or `DELETE` is refused with 403 `CSRF_BLOCKED` if `Sec-Fetch-Site` says cross-site or if `Origin` names another host than the request's `Host` (D83). A request with no `Origin` (a script, curl) is allowed: that is a decision, not an oversight. | `src/server/auth/csrf.ts`; `tests/server/csrf.test.ts`; the smoke checks a cross-site `logout-all` over HTTP |

### Access control

| Control | What it does | Where |
|---|---|---|
| Every route is guarded, and a test enforces it | Every exported route handler is `withPermission(...)` or one of seven allowlisted `publicRoute(...)`s; the guard resolves the session itself, so no route reads the cookie. A test lists the route files and fails if one is unwrapped, if a public route is missing from the allowlist or if the allowlist has a stale entry (D81). | `src/server/auth/guard.ts`; `tests/server/route-guards.test.ts` ("D81 route inventory") |
| 401 versus 403, denials audited | Not signed in is 401 (not audited: anyone can cause one). Signed in but not allowed is 403 and an `ACCESS_DENIED` row in the audit log, even when the address hash cannot be computed (D82, D129). A matrix test runs the guards against a real database with an injected clock. | `src/server/auth/audit.ts`; `tests/integration/guard.test.ts`, `tests/integration/authorization-matrix.test.ts` |
| One permission per staff duty | `payments:match`, `payments:approve`, `reports:view`, `complaints:manage`, `complaints:duty_manager`. A person who requested a manual match cannot approve their own request. | `src/domain/seed/people.ts` (the demo staff); `tests/integration/manual-approval.test.ts` (SELF_APPROVAL), `tests/integration/reconciliation-routes.test.ts` |

### The money and the database

| Control | What it does | Where |
|---|---|---|
| Ledger rules in the database | Amounts are positive integers of paise; the entry type fixes the direction; `UPDATE`, `DELETE` and `TRUNCATE` on `ledger_entries` are refused by a trigger; a reference and an idempotency key are unique; a reversal must name its original and cannot be repeated. The same append-only trigger is on `payment_matches`, `complaint_events`, `classifications` and `audit_log`. At most one unresolved payment attempt per bill is a partial unique index. | `prisma/migrations/*/migration.sql`; `tests/integration/ledger-invariants.test.ts` (I1 to I5 and later), `tests/integration/other-constraints.test.ts` |
| A non-owner application role | The web app connects as a role that does not own the tables, so a bug cannot `ALTER TABLE ... DISABLE TRIGGER` or drop a table. Its privileges are generated from one matrix: `SELECT` and `INSERT` on the append-only tables, column-level `UPDATE` only where the code writes, `error_events` insert-only (it can write an error but not read one), no `CREATE`, nothing on `_prisma_migrations`. A test fails when a table has no decision. | `src/server/db-roles/app-role.ts` (`npm run db:print-app-role-sql`); `tests/integration/app-role.test.ts`, `app-role-matrix.test.ts`, `app-role-flows.test.ts` |
| Readiness proves the role | `GET /api/health/ready` reports `isSuperuser`, `canUpdateLedger`, `canDeleteAuditLog`, `canInsertErrorEvents` and `canReadErrorEvents` for the role the server actually uses, and answers 503 if the app runs as the owner. | `src/server/health/readiness.ts` (D112, D136) |
| Signed payment webhook | The gateway's event is accepted only with a header time within 300 seconds and a hex HMAC-SHA256 of `timestamp.rawBody` under `PAYMENT_WEBHOOK_SECRET`, compared in constant time, before the body is read. In production the secret must be at least 32 characters and not the placeholder. A success posts a ledger entry only once per gateway reference. | `src/server/payments/webhook.ts`; `tests/server/webhook.test.ts`, `tests/integration/payments-webhook.test.ts` |

### Logging, errors, secrets

| Control | What it does | Where |
|---|---|---|
| Redacted logging | One `redact` function runs before text is cut: the exact values of the configured secrets, URLs with credentials, `Bearer` values, `key=value` secrets, e-mail addresses, runs of 10 or more digits and long token runs become `[secret]`. The logger has no field for a request body, header, cookie, phone number or code. | `src/server/log.ts`; `tests/server/redact.test.ts`, `tests/server/log.test.ts`; `docs/observability.md` |
| A developer-only error log | Unexpected failures are stored in `error_events` (30 days) with a reference such as `E-XXXXXX`; there is no page and no permission in the app. It is read with a separate read-only database role (`LOGS_DATABASE_URL`, on the developer's machine only, never in Vercel). The test route `GET /api/ops/error-test` is a plain 404 unless `OPS_TEST_TOKEN` is set, and a wrong token is also a 404 (constant-time comparison; D138). | `src/server/error-log.ts`, `src/server/db-roles/logs-role.ts`, `scripts/logs.ts`, `src/server/ops/error-test.ts`; `tests/server/error-log.test.ts`, `tests/integration/error-events.test.ts`, `tests/integration/logs-role.test.ts`, `tests/integration/ops-error-test.test.ts` |
| Secret scanning | `npm run scan:secrets` runs on every commit through the pre-commit hook, and CI also runs gitleaks 8.24.3 over the full history with a binary whose SHA-256 checksum is verified before it runs (D67). `.env` is ignored; `.env.example` holds names and placeholders only. | `scripts/scan-secrets.mjs`, `src/server/secret-rules.ts`, `.github/workflows/ci.yml` |
| Dependency age policy | Exact versions in `package.json`, each published at least 14 days before use, with `npm audit` before choosing an older one (D66). A new dependency needs the owner's approval. | `CLAUDE.md`, `package.json` (no `^` or `~`) |
| Destructive-command guards | The seed and reset refuse a non-empty database; a reset works only on `localhost` and only on `township`, `township_seed_scratch` or `township_test_*`, and the exact name must be typed; a remote seed needs `--allow-remote` and `--confirm-database`; the demo seed needs `DEMO_MODE=true`. The hosted database therefore cannot be reset by the app's tools: that is the owner-only procedure in `docs/hosted-reset-procedure.md`. | `src/server/seed/guards.ts`; `tests/server/seed-guards.test.ts`; `CLAUDE.md` ("Project Safety Rules") |

### The safety path for complaints

A complaint about fire, gas, a stuck lift or electric shock (and a fifth, human-added category for medical emergency or violence, D153), in English, Hindi,
Marathi or those typed in Latin letters, is escalated by fixed rules before any model sees the text:

- **Rules first.** `SAFETY_RULES` read the original text; a hit gives urgency CRITICAL, source RULE, and escalation to the duty manager (`src/domain/complaints/safety.ts`, `decision.ts`; `tests/domain/complaints/safety.test.ts`, `decision.test.ts`, `tests/integration/complaints-safety.test.ts`).
- **A model can never produce CRITICAL.** An answer that includes CRITICAL is refused as invalid; a model cannot lower a rule's urgency (`decision.ts`, rules R1 and R2).
- **Declared danger.** The resident's "Is anyone in danger right now?" answer is mandatory, and Yes escalates even with no safety word (`tests/integration/complaints-create.test.ts`).
- **De-identification.** Only de-identified text is ever sent to a provider, and never for a safety complaint (D88, D119, D140; `src/domain/complaints/deidentify.ts`, `tests/domain/complaints/deidentify.test.ts`).
- **The duty manager's own acknowledgement.** "Seen" means the duty manager pressed "I have seen this"; a plain complaints manager's first reply does not count as a sighting (D149; `tests/integration/safety-acknowledgement.test.ts`).

The Hindi and Marathi word lists were written by the agent and are NOT yet reviewed by a native speaker (`docs/safety-words-review.md`).

## The demo's own risk

With `DEMO_MODE=true` the API returns the login code for a demo phone (a number beginning with 5), so anyone who finds the URL can sign in as any seeded user,
including staff who can post and approve payments. The data is fictional and the secrets are not in the app. The kill switch is `DEMO_MODE=false` in the Vercel
dashboard, then Redeploy; nobody can then sign in (there is no SMS sender). The decision and its limits are in `docs/deployment-plan.md` (Decision 7).

## What is NOT built, and what production would add

| Not built | What production would add | Why it is not here |
|---|---|---|
| Real SMS and strong staff authentication | Passkeys or authenticator-app codes for staff, and a fresh step-up code before approving a large payment (`docs/auth-design.md`, R23). | The brief says SMS may be mocked. The reasoning carried from the task brief: NIST SP 800-63B treats a code sent by SMS as a "restricted" authenticator, so a system that moves money should not rely on it alone. UNVERIFIED here: the repository records the NIST guidance only for the session limits (D74, D75) with no publication date, and this run fetched nothing. |
| Data-protection obligations | A named data owner, a notice and consent record, retention rules, a breach process. The brief records that India's Digital Personal Data Protection Rules were notified on 13 November 2025, with the main obligations (security safeguards, breach reporting within 72 hours) phased in about 18 months later. | UNVERIFIED: no document in the repository records this source, and this run did not fetch the web; confirm with a lawyer before relying on a date. The design is aligned with the ideas (minimal data, redaction, a developer-only log) but is not a compliance claim. |
| Encryption at rest and of fields | The database host's disk encryption, and application-level encryption of phone numbers and narrations. | Phone numbers are fictional and begin with 5; a real deployment would store real ones. |
| Retention jobs | Scheduled deletion of OTP rows, audit rows, error rows (the error log has `npm run db:prune-errors`, run by hand) and old sessions. | No cron route exists (`docs/deploy-checklist.md`, D8). |
| Row-level security | A second wall in the database so a missing `WHERE` in the app cannot show another flat's rows. | The app role plus the permission guard are the two walls built. |
| Monitoring and alerting | Alerts on error bursts, on a classifier provider's warnings, on a failed readiness check; a log drain so history outlives 30 days and one hour on Vercel Hobby. | Free tier, one developer (`docs/observability.md`, "Next steps"). |
| Backups with tested restores | Scheduled backups and a rehearsed restore. | The host's point-in-time restore exists (`docs/deploy-checklist.md`, Part G) but no restore was rehearsed here. |
| Penetration testing | An independent test of the deployed system. | Not done. |
| Global rate limit, bot protection | A limit on all routes, not only login, and a web application firewall. | Only the login path is limited (`docs/auth-design.md`, "Not covered"). |

## Sources recorded in the repository

| Source | Where it is recorded | Date |
|---|---|---|
| NIST SP 800-63B (session length and authenticator levels) | `docs/decisions.md` D74, D75; `docs/auth-design.md` | None recorded ("the sources were named by the human who decided; this task did not re-read them"). |
| OWASP session management guidance | the same | None recorded. |
| Vercel runtime logs: Hobby keeps 1 hour | `docs/observability.md` | Page last updated 2026-08-28, read 2026-11-07. |
| Vercel and Neon limits and terms | `docs/deployment-plan.md` ("Sources fetched on 2026-11-06") | Fetched 2026-11-06. |
| Digital Personal Data Protection Rules, 2025 (India) | Only the task brief of this documentation phase | None recorded in the repository. UNVERIFIED. |
