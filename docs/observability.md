# Observability: where to look when something fails (D135, D136)

Written 2026-11-07. The app has three places to look. Only the developer reads the durable one: there is **no page in the app and no
permission** for it.

| Place | What it is good for | How long it lasts |
|---|---|---|
| 1. The **readiness report** `GET /api/health/ready` | Is the deployment set up right (config, tables, database role, seed)? Booleans only, safe to paste. | Live: a fresh answer each time. |
| 2. **Vercel runtime logs** (stdout) | The last hour: every failure as one JSON line with its reference, plus the host's own request log. | **Vercel Hobby keeps runtime logs for 1 hour** (Pro 1 day, Pro with Observability Plus 30 days). Source: https://vercel.com/docs/runtime-logs, page last updated 2026-08-28, read 2026-11-07. A line can be 256 KB and a request 256 lines. |
| 3. The **`error_events` table** in our own Postgres | Everything unexpected since the last prune, searchable by reference, digest, route, request id. | 30 days by default (`npm run db:prune-errors`). |

## What is recorded

One row in `error_events` and one stdout line for:

- an unexpected exception in a **route handler** (the guard's catch-all that answers `SERVER_ERROR`),
- an unexpected exception in a **server component** or a **server action** (`src/instrumentation.ts`, `onRequestError`, which also gives the
  **digest** the browser shows on its error page),
- a small fixed set of **warnings**, each at most once per cooldown per server instance: a classifier provider's breaker opening, a provider
  answering 401 or 403, deadlock retries running out, a statement import whose books did not add up, and the audit address hash being
  unavailable (once per instance),
- the test event of `GET /api/ops/error-test`.

A row holds: a reference (`E-` and 6 characters), time, level (WARN or ERROR), source (ROUTE, PAGE, ACTION, MIDDLEWARE, PROVIDER, JOB, AUDIT,
TEST), route, method, status, digest, request id, error name, error code (a Postgres SQLSTATE or a Prisma code), a redacted message (500
characters at most), a redacted stack (12 frames and 4,000 characters at most), the user id and role when known, the first 7 characters of
the deployed commit, the environment, a fingerprint, and `suppressed_count`.

## What is NEVER recorded

Ordinary 4xx answers, validation errors, rate limits, failed logins and 403 denials are not recorded. A row never holds a request body, a
header, a cookie, complaint text, a bank narration, a phone number, a code, a name, or the query string of a URL. The logger has no field
that could carry them: the only inputs are the route path, the method, a status, two ids and the redacted error.

## Redaction (`redact` in `src/server/log.ts`)

Applied before the text is cut, so a secret that straddles a cut cannot leave a piece behind:

1. the exact values of `DATABASE_URL` (and its password), `OTP_PEPPER`, `PAYMENT_WEBHOOK_SECRET`, `SESSION_SECRET`, `LLM_API_KEY`,
   `LOGS_DATABASE_URL`, `OPS_TEST_TOKEN` and every `JEV_*_KEY` and `JEV_*_URL` that is set become `[secret]`;
2. URLs with credentials and any `postgres://` URL; `Authorization` and `Bearer` values; `token=`, `password=`, `key=` style assignments;
3. e-mail addresses; runs of 10 or more digits (any script, so Devanagari digits too);
4. runs of 32 or more token characters.

Two deliberate exceptions, each tested: in a **stack**, "/" does not extend a token run (otherwise a long file path becomes `[secret].ts`); and
a **digest** (a plain number or word of up to 40 characters) and a **host request id** (exactly the `iad1::sfo1::abcde-1730000000000-0123456789ab`
shape) are kept, because they are the keys a person quotes. The reader redacts every row again before printing.

## The reference workflow

A person sees "Something went wrong." and "Reference: ..." (an `E-XXXXXX` from an API answer, or a digest number on a page). The developer runs:

```bash
npm run logs:errors -- --ref E-XXXXXX --paste        # a reference from an API answer or a log line
npm run logs:errors -- --digest 3175611538 --paste   # the number on an error page
```

`--paste` prints one plain-text block per event (reference, time, level, source, route, method, status, error name, error code, message, stack,
deployment), redacted again, ready to paste to an assistant. Other options: `--since 30m|1h|24h|7d` (default 24h), `--request-id`, `--route`
(contains), `--level warn|error`, `--source`, `--limit` (default 20, at most 200), `--json`.

## Neon SQL editor queries (ready to paste)

Run them in the Neon SQL editor as the owner, or as the logs role.

```sql
-- latest errors
SELECT occurred_at, level, source, ref, route, status, error_name, error_code, left(message, 120) AS message
FROM error_events ORDER BY occurred_at DESC LIMIT 50;

-- by reference
SELECT * FROM error_events WHERE ref = 'E-XXXXXX';

-- by digest (the number on an error page)
SELECT * FROM error_events WHERE digest = '3175611538' ORDER BY occurred_at DESC;

-- by route (contains)
SELECT occurred_at, ref, status, error_name, message FROM error_events
WHERE position(lower('/api/payments') in lower(route)) > 0 ORDER BY occurred_at DESC LIMIT 50;

-- counts per fingerprint in the last 24 hours (suppressed_count adds the events the flood limit skipped)
SELECT fingerprint, min(route) AS route, min(error_name) AS error_name, count(*) AS rows, sum(suppressed_count) AS suppressed, max(occurred_at) AS last_seen
FROM error_events WHERE occurred_at > now() - interval '24 hours'
GROUP BY fingerprint ORDER BY rows + sum(suppressed_count) DESC;
```

## Setting up the read-only logs role (the human, once)

The logs role may CONNECT, see the schema and SELECT `error_events`, nothing else. Create it with SQL, **never in the Neon console, API or CLI**
(a role made there becomes a member of `neon_superuser`; the generated guard refuses it). Type the password at a prompt; never paste it into a chat.

1. In the Neon SQL editor, as the owner: `CREATE ROLE township_logs LOGIN PASSWORD '<a new 32-character password from your password manager>';`
2. In your terminal: `npm run db:print-logs-role-sql -- --role=township_logs --owner=neondb_owner > /tmp/logs-grants.sql` (it connects to nothing and takes no password).
3. Read `/tmp/logs-grants.sql`, then run it in the SQL editor as the owner. Running it again is safe.
4. Build the connection string of this role (the direct or pooled host of the same project, `?sslmode=verify-full`) and keep it **only on your machine**:
   `read -rs LOGS_DATABASE_URL; export LOGS_DATABASE_URL` (paste it at the prompt). **Never set `LOGS_DATABASE_URL` in Vercel.**
5. Verify: `npm run logs:errors -- --since=7d --limit=1` prints "Reading error events from host ..., database ... (read-only)". Then, in the
   editor as `township_logs`, `SELECT 1 FROM users LIMIT 1;` must fail with `permission denied`.

## Limits

- **A database outage cannot be stored in the database.** The stdout line is the only record then (and one line, "error event not stored", names the reference).
- **Flood protection is per server instance** (in memory): at most 20 stored events a minute and 1 per fingerprint per 60 seconds. On serverless every
  instance has its own counters, and a skipped event has a stdout line but **no row** (the count is added to `suppressed_count` of the next row).
- **Stdout lasts 1 hour on Hobby.** Look there first for a reference that has no row.
- The reference shown for a page is the **digest**; the row's own `E-` reference is only in the row and the stdout line. Use `--digest`.
- If the store runs after the response (`after`), a function that is frozen at once can lose it; the stdout line is not affected.

## Next steps (not built)

A log drain or an error service (so history outlives 30 days and does not depend on our database), and alerting (for example on `PROVIDER` warnings or a burst of one fingerprint).
