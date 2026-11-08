# Live refresh runbook: bring the hosted deployment up to date

For the human (the owner of the Vercel and Neon accounts). It is ONE ordered list. Do the steps in order and stop at the first one that does not give its
expected result. Written 2026-11-08. It goes with `docs/deploy-checklist.md` (the first-time setup) and `docs/observability.md`.

`<LIVE_URL>` is the hosted address, for example `https://residents-management-app.vercel.app` (confirm yours in the Vercel dashboard). The database owner role on Neon is
`neondb_owner`, the application role is `township_app`, the logs role is `township_logs` (the Neon defaults and the names used throughout this repository).

## Rules for the whole runbook

- **Secrets are typed, never pasted into a chat, a file or a command line.** Connection strings are entered with `read -rs` (nothing is echoed) and removed with `unset` afterwards.
- Never put the owner string in Vercel. Never put `LOGS_DATABASE_URL` in Vercel.
- The SQL runs as the owner, either in the Neon **SQL Editor** or with the helper below. Every statement here was run against a freshly migrated and seeded LOCAL scratch
  database (`township_seed_scratch`) in the session that wrote this file; the statements and their results are in `docs/overnight-report.md` ("Phase B: SQL evidence").
  Real Neon was NOT touched: any difference you see on Neon is yours to report.
- `npm run smoke:app` MUTATES data (it pays, imports, raises complaints) and must NEVER be run against the live site. Only `smoke:auth` is safe there.

### The SQL helper (bash, run from the repository root)

`psql` sometimes trips on a connection URL's options; this uses the `pg` package already installed by `npm ci`. Paste it into your terminal once; it reads `DATABASE_URL` from the shell.

```bash
runsql() { node -e '
const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const sql = process.argv[1] === "-f" ? fs.readFileSync(process.argv[2], "utf8") : process.argv[1];
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const out = await client.query(sql);
    for (const r of Array.isArray(out) ? out : [out]) { if (r.command === "SELECT") console.table(r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v])))); else console.log(r.command, r.rowCount ?? ""); }
  } finally { await client.end(); }
})().catch((e) => { console.error(e.code ?? "", e.message); process.exit(1); });
' -- "$@"; }
```

Use: `runsql "SELECT current_user"` for one statement, `runsql -f file.sql` for a file. It prints each statement's command word and the rows of a SELECT.

## The steps

### 1. Push the code and wait for Vercel (terminal, then Vercel dashboard)

```bash
git status --short          # nothing you did not mean to publish
git push
```

Then Vercel > the project > Deployments. **Expected:** a new Production deployment appears and turns "Ready"; its build log ends with the route list and no error.
**If not:** open the Build Logs. A message about the commit author or the team: `docs/deploy-checklist.md`, A2 and D9b. Do not go on until the deployment is Ready, because step 2 must apply migrations the new code expects.
(Pushing is your decision; the agent that wrote this file did not push.)

### 2. Apply the database migrations as the owner (terminal)

```bash
read -rs DATABASE_URL && export DATABASE_URL        # paste "neon-owner-direct", press Enter; nothing is shown
node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.hostname, u.pathname)'
```

**Expected:** a host ending `.neon.tech` with **no** `-pooler`, then `/neondb`. If the host has `-pooler`, you pasted the pooled string: `unset DATABASE_URL` and repeat with the direct one.

```bash
npx prisma migrate deploy
npx prisma migrate status
```

**Expected:** "All migrations have been successfully applied." (or "No pending migrations to apply."), then "Database schema is up to date!". As of 2026-11-08 the repository has 7 migrations, the newest `20261107090000_error_events`.
**If not:** a connection or lock error means the pooled string again. A "migration failed" message: stop, copy the message (never the string) to the agent.
Leave `DATABASE_URL` set for steps 3 and 4.

### 3. Regenerate and re-run the application role grants (terminal, as the owner)

A new table has no grant for the app role, so after any migration the grants are regenerated from `src/server/db-roles/app-role.ts` and run again. Running them again is safe: they start by taking everything back.

```bash
npm run db:print-app-role-sql -- --app=township_app --owner=neondb_owner > /tmp/app-role.sql
head -n 2 /tmp/app-role.sql
runsql -f /tmp/app-role.sql
rm /tmp/app-role.sql
```

**Expected:** the first line starts `-- Grants for the application role "township_app"`, with no password in the file; `runsql` prints `DO`, four `REVOKE`, `DO`, then ten `GRANT` (the counts as of 2026-11-08; a new table adds to the GRANT line, not to this list) and ends without an error.
**If not:** the script stops with a message ("Run this as the owner role", "does not exist", "administrator attributes", "neon_superuser", "owns a table", "No privilege decision for table(s)"). Do not work around it. If the role does not exist, create it first with the SQL in `docs/deploy-checklist.md`, C3.

Verify with one SELECT (as the owner; it asks the catalog about the app role):

```sql
SELECT has_table_privilege('township_app', 'error_events', 'INSERT') AS can_insert_errors,
       has_table_privilege('township_app', 'error_events', 'SELECT') AS can_read_errors,
       has_table_privilege('township_app', 'ledger_entries', 'UPDATE') AS can_update_ledger,
       has_table_privilege('township_app', 'audit_log', 'DELETE') AS can_delete_audit;
```

**Expected:** `true`, `false`, `false`, `false`. Any other result: re-run this step; if it persists, stop and tell the agent which column.

### 4. The two settings the app role cannot write (Neon SQL Editor, or `runsql`, as the owner)

`society_settings` is writable by the owner only. Both statements are safe to run twice. (They are the same texts as E7 and E8 of `docs/deploy-checklist.md`.)

```sql
UPDATE society_settings SET value = '1000000'::jsonb WHERE key = 'approval_threshold_paise';
SELECT key, value FROM society_settings WHERE key = 'approval_threshold_paise';
```

**Expected:** `UPDATE 1` (the same in the SQL Editor and in `runsql`), then one row with value `1000000` (the demo's second-approver threshold, 10,000 rupees). `UPDATE 0` means the key is missing: stop and tell the agent.

```sql
INSERT INTO society_settings (key, value) VALUES ('committee_goals', '{"onTimeCollectionPercent": 90, "firstReplyWithinSlaPercent": 90, "reopenedPercentMax": 8}'::jsonb) ON CONFLICT (key) DO NOTHING;
SELECT key, value FROM society_settings WHERE key = 'committee_goals';
```

**Expected:** `INSERT 0 1` in the SQL Editor (`INSERT 1` in `runsql`), or `INSERT 0 0` (`INSERT 0` in `runsql`) if the row existed, then one row whose value holds `onTimeCollectionPercent` 90, `firstReplyWithinSlaPercent` 90 and `reopenedPercentMax` 8 (key order may differ).

Now `unset DATABASE_URL`. **Expected:** `echo "${DATABASE_URL:-unset}"` prints `unset`.

### 5. Vercel environment variables, by NAME, then Redeploy (Vercel dashboard)

Vercel > the project > Settings > Environment Variables. Scope every row to **Production** only. Variables apply only to NEW deployments, so the last action is a Redeploy.

| Name | What to check | Secret? |
|---|---|---|
| `DATABASE_URL` | The pooled string of the role `township_app` (host contains `-pooler`), ending `?sslmode=verify-full`. Not the owner. | Secret |
| `OTP_PEPPER` | Set, at least 32 characters, not starting `replace-with`. Generate with `openssl rand -hex 32` if missing. | Secret |
| `PAYMENT_WEBHOOK_SECRET` | Set, at least 32 characters, a different value from the pepper. | Secret |
| `OPS_TEST_TOKEN` | Set, at least 32 characters (`openssl rand -hex 32`); it enables the error-test route. Dashboard only. | Secret |
| `DEMO_MODE` | `true` during the review window (the login code is shown on screen); `false` is the kill switch. | Config |
| `SHOW_DESIGN_PAGE` | `false`. | Config |
| `DEMO_AS_OF` | Must be **UNSET**: if the name is in the list, delete it, so the live site uses today's date. | n/a |
| `LOGS_DATABASE_URL` | Must **not** exist in Vercel, ever. | n/a |
| "Enable access to System Environment Variables" | Ticked (without it the address limit breaks). | n/a |

Then Deployments > the latest > the "..." menu > **Redeploy**. **Expected:** the new deployment turns Ready.
**If not:** see the readiness table in step 6 and `docs/deploy-checklist.md`, D2 and D3.

### 6. Open the readiness report and read each check (browser or terminal)

```bash
curl -s "<LIVE_URL>/api/health/ready"
```

**Expected:** HTTP 200 and `"status":"ok"`. HTTP 503 means a check failed. Read the checks (booleans and fixed words only; safe to paste into a chat):

| Check | Expected | If it is not | Fix |
|---|---|---|---|
| `config.otpPepper` | `true` | Login fails with a 500 | Step 5, `OTP_PEPPER`, Redeploy |
| `config.webhookSecret` | `true` | Payments cannot be verified | Step 5, `PAYMENT_WEBHOOK_SECRET`, Redeploy |
| `config.demoMode` | `true` while reviewers use the site | No demo code is shown | Step 5, `DEMO_MODE`, Redeploy |
| `config.opsTestEnabled` | `true` after step 5 | The error-test route is a 404 | Step 5, `OPS_TEST_TOKEN`, Redeploy |
| `config.vercelSystemVars` | `true` on Vercel | The address limit breaks | Tick the System Environment Variables box, Redeploy |
| `config.nodeMajor` | `24` | Another Node version | Settings > Build and Deployment > Node.js Version 24.x, Redeploy |
| `database` | `"ok"` | `"unreachable"` or `"timeout"` | Check `DATABASE_URL`; wait 10 seconds if Neon was asleep; `docs/deploy-checklist.md` readiness table |
| `schema.missingTables` | `[]` | Names a table | Step 2, then step 3 |
| `appRole.isSuperuser`, `canUpdateLedger`, `canDeleteAuditLog` | all `false` | The app connects as the owner | `DATABASE_URL` must be the `township_app` string; step 3; Redeploy |
| `appRole.canInsertOtp`, `canInsertErrorEvents` | `true` | Grants missing | Step 3 |
| `appRole.canReadErrorEvents` | `false` | `true` makes the report degraded: the app role was given SELECT | Step 3 |
| `data.seeded` | `true` | Database is empty | `docs/deploy-checklist.md`, C5 (or the reset in `docs/hosted-reset-procedure.md`) |

### 7. Create and verify the read-only logs role (SQL only, never the Neon console)

A role made in the console, API or CLI becomes a member of `neon_superuser`, and the generated guard refuses it. Skip to step 8 if the role already exists and step 7d passes.

**7a. Create the role (Neon SQL Editor, as the owner).** Type a new 32-character password from your password manager in place of `<password>`:

```sql
CREATE ROLE township_logs LOGIN PASSWORD '<password>';
```

**Expected:** `CREATE ROLE` (the SQL Editor's words).

**7b. Print and run its grants (terminal; owner string again):**

```bash
read -rs DATABASE_URL && export DATABASE_URL
npm run db:print-logs-role-sql -- --role=township_logs --owner=neondb_owner > /tmp/logs-grants.sql
head -n 2 /tmp/logs-grants.sql
runsql -f /tmp/logs-grants.sql
rm /tmp/logs-grants.sql
unset DATABASE_URL
```

**Expected:** the first line starts `-- Grants for the READ-ONLY logs role "township_logs"`; `runsql` prints `DO`, two `REVOKE`, `DO`, two `GRANT` and ends without an error.

**7c. Put the logs string on YOUR MACHINE ONLY** (the direct or pooled host of the same project, user `township_logs`, `?sslmode=verify-full`):

```bash
read -rs LOGS_DATABASE_URL && export LOGS_DATABASE_URL
npm run logs:errors -- --since=7d --limit=1
```

**Expected:** a line "Reading error events from host ..., database ... (read-only)" and then either "No error events matched" or one event. **If not:** a password or host error: rebuild the string.

**7d. Prove it is read-only:** with `DATABASE_URL` set to the logs string (`read -rs DATABASE_URL && export DATABASE_URL`), run

```bash
runsql "SELECT 1 FROM users LIMIT 1"
```

**Expected:** an error containing `permission denied for table users` (printed with the code `42501`). If it prints a row, the role has too much: stop and tell the agent. Then `unset DATABASE_URL`.

### 8. Call the ops test route and find the reference (terminal)

```bash
read -rs T && curl -s -H "x-ops-token: $T" "<LIVE_URL>/api/ops/error-test"; unset T
```

**Expected:** `{"ref":"E-XXXXXX"}` (six characters after `E-`). Without the header the route is a plain 404. At most 5 calls an hour per server instance.
Then, with `LOGS_DATABASE_URL` still set from step 7c:

```bash
npm run logs:errors -- --ref=E-XXXXXX --paste
```

**Expected:** one WARN block, source TEST, message "ops test". **If not:** the event was not stored: read `docs/observability.md`, then check readiness `appRole.canInsertErrorEvents`.

### 9. Smoke test the login over HTTPS (terminal)

```bash
node scripts/smoke-auth.mjs <LIVE_URL> 5000000006      # a resident
node scripts/smoke-auth.mjs <LIVE_URL> 5000000001      # a staff member
```

**Expected:** it prints the readiness table (every line PASS or INFO), then `ALL 13 CHECKS PASSED` for each (the cookie checks expect `__Host-session` with `Secure` over https). Each run asks for one code per phone: the app allows one code per 30 seconds and 5 an hour per phone, so use another demo phone if you see "429".
**If not:** a readiness line marked FAIL stops the script before any login: fix that check first (step 6). Do NOT run `npm run smoke:app` against the live site: it mutates data.

### 10. Check installability and the offline page (phone or Chrome)

In Chrome open `<LIVE_URL>/manifest.webmanifest`. **Expected:** JSON with name "Township". In Chrome on Android use "Install app" (menu); on iPhone use Safari > Share > Add to Home Screen. Then turn the network off and reload.
**Expected:** the page "You're offline." (the only thing the service worker keeps, besides the icons).

### 11. If a readiness check is degraded

Use the table in step 6. In short: a `config.*` or `appRole.*` problem is fixed in the Vercel dashboard or by step 3, then Redeploy; `schema.missingTables` by steps 2 and 3; `database` by the connection string; `data.seeded: false` by the seed or the reset. Whatever you see, the report holds only booleans and table names, so pasting it to the agent is safe.

## When the review is over or something goes wrong

`DEMO_MODE=false` and Redeploy closes the demo login at once. Roll back the code with Deployments > the previous production deployment > Instant Rollback. To put the demo data back to a clean seeded state, use `docs/hosted-reset-procedure.md` (owner only; destroys all data).
