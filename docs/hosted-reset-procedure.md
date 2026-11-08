# Hosted reset procedure (owner only)

Restores the HOSTED demo database to a clean, freshly seeded state. Written 2026-11-08. It is for the owner of the Neon project only, and it is on purpose NOT a
command of the app: the app's own guards (`src/server/seed/guards.ts`) refuse any reset on a remote host, so a mistake or an attacker cannot wipe the live data
with the repository's tools. This procedure uses the owner's own connection instead.

`<LIVE_URL>` is the hosted address. Names used: owner role `neondb_owner`, database `neondb`, application role `township_app`, logs role `township_logs`.

## What it DESTROYS

**Everything in the database's `public` schema**: every flat, user, bill, ledger entry, payment attempt, statement import, bank row, complaint and its events, session,
one-time code, the **audit log** and the **error log** (`error_events`), and the migration history. Nothing can be undone from the app (the ledger is append-only).
It does not remove the Neon project, the roles themselves, the Vercel project or any Vercel variable. After it, the roles have no privileges until steps 5 and 6 run.

## When NOT to use it

- Not while real people are using the site: the live site returns errors from step 3 until step 8 ends (steps 1 to 8 took 7 seconds in the local rehearsal, the seed itself 3 seconds; allow a few minutes on Neon, where each command crosses the internet and the database may be asleep).
- Not if you want to keep the audit or error history (copy what you need first: `npm run logs:errors -- --since=30d --json`).
- Not to fix a failed migration or a missing grant: use `docs/live-refresh-runbook.md` for that.
- Not against any database that is not the demo. Step 2 prints the database name; stop if it is not `neondb`.

## When to use it

**Run it LAST before submission** if reviewers or you consumed the demo data (the live ledger is append-only, so every payment settles a sample bill for good). Do not run anything that
pays or imports on the live site after it. If you must check the site afterwards, use `smoke:auth` only (it changes sessions and one-time codes, not money).

## Before you start

- A terminal in the repository root, Node 24, `npm ci` done, and the **direct owner connection string** of Neon in your password manager ("neon-owner-direct": host without `-pooler`).
- The `township_app` and `township_logs` roles already exist (they survive the reset). If they do not, create them first with `docs/deploy-checklist.md` C3 and `docs/live-refresh-runbook.md` step 7a.
- The `runsql` helper from `docs/live-refresh-runbook.md` pasted into the terminal.
- Nobody else is changing the database.

## The procedure

### 1. Enter the owner string without showing it

```bash
read -rs DATABASE_URL && export DATABASE_URL
node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.hostname, u.pathname)'
```

**Expected:** a host ending `.neon.tech` with no `-pooler`, then `/neondb`. If not, `unset DATABASE_URL` and start again.

### 2. Print where you are and STOP if it is wrong

```bash
runsql "SELECT current_database() AS database, current_user AS role"
```

**Expected:** `neondb` and `neondb_owner`. If the database is not `neondb`, or the role is not the owner, run `unset DATABASE_URL` and do not continue.

### 3. Drop and recreate the schema (one transaction)

```bash
runsql "BEGIN; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION neondb_owner; GRANT USAGE ON SCHEMA public TO PUBLIC; COMMIT;"
```

**Expected:** the commands `BEGIN`, `DROP`, `CREATE`, `GRANT`, `COMMIT`. The owner owns the new schema; `USAGE` for everyone restores the Postgres default of the `public` schema (the grants of step 5 give the app roles their own `USAGE`, and never `CREATE`).
**If it waits a long time:** a connection of the live app holds a lock; wait a minute and it proceeds. **If it is refused:** the owner may not drop `public` on this Neon project: UNVERIFIED on real Neon (the procedure was rehearsed only on a local Postgres 16). Fall back to deleting the database in the Neon console and creating `neondb` again, then continue from step 4.

### 4. Apply the migrations

```bash
npx prisma migrate deploy
npx prisma migrate status
```

**Expected:** every migration applied (7 on 2026-11-08), then "Database schema is up to date!".

### 5. Re-run the application role grants

```bash
npm run db:print-app-role-sql -- --app=township_app --owner=neondb_owner > /tmp/app-role.sql
runsql -f /tmp/app-role.sql
rm /tmp/app-role.sql
```

**Expected:** `DO`, four `REVOKE`, `DO`, ten `GRANT` (as of 2026-11-08), no error.

### 6. Re-run the logs role grants

```bash
npm run db:print-logs-role-sql -- --role=township_logs --owner=neondb_owner > /tmp/logs-grants.sql
runsql -f /tmp/logs-grants.sql
rm /tmp/logs-grants.sql
```

**Expected:** `DO`, two `REVOKE`, `DO`, two `GRANT`, no error.

### 7. Seed the demo data

```bash
export DEMO_MODE=true
npm run db:seed -- --yes --allow-remote --confirm-database=neondb
unset DEMO_MODE
```

**Expected:** the first line `Target: host <endpoint>.neon.tech, database neondb`, then a table of row counts ending with `total 78091` and `Database size: ... MB` (about 29 MB; compare with the 1 GB free limit). The seed refuses a database that is not empty, a remote host without `--allow-remote`, and a name that does not match `--confirm-database`.

### 8. Re-apply the two settings

```bash
runsql "UPDATE society_settings SET value = '1000000'::jsonb WHERE key = 'approval_threshold_paise'"
runsql "INSERT INTO society_settings (key, value) VALUES ('committee_goals', '{\"onTimeCollectionPercent\": 90, \"firstReplyWithinSlaPercent\": 90, \"reopenedPercentMax\": 8}'::jsonb) ON CONFLICT (key) DO NOTHING"
runsql "SELECT key, value FROM society_settings WHERE key IN ('approval_threshold_paise', 'committee_goals') ORDER BY key"
```

A fresh seed already writes both (D116 and the goals), so the statements change nothing (`UPDATE 1` and `INSERT 0` in `runsql`, `INSERT 0 0` in the SQL Editor); they are here so the procedure ends in the state `docs/live-refresh-runbook.md` step 4 describes.
**Expected:** the SELECT shows `approval_threshold_paise` = `1000000` and `committee_goals` with the three numbers. Then `unset DATABASE_URL`.

### 9. Readiness and a login smoke test

```bash
curl -s "<LIVE_URL>/api/health/ready"
node scripts/smoke-auth.mjs <LIVE_URL> 5000000006
```

**Expected:** `"status":"ok"` with `"data":{"seeded":true}` and `canInsertErrorEvents: true`, `canReadErrorEvents: false`; then `ALL 13 CHECKS PASSED`. If `appRole` shows false for `canInsertOtp`, step 5 did not run. Open the site and sign in as `5000000007` to see Home dues: the app uses today's date, so the figures differ from the brief's sample (see `deployment.md`).
Sessions in the browsers of anyone who was signed in are gone with the data; they sign in again.

## Rehearsal

This whole procedure, with the connection changed only to a local scratch database named `township_seed_scratch` and the roles named `app_t_*`, was run in the session that wrote it. The output is in `docs/overnight-report.md` ("Phase B: hosted reset rehearsal"). It was NOT run on Neon.
