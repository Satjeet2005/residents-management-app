# Township: deployment and reviewer guide

Written 2026-11-08 for a reviewer who has never seen the project. Every command, name, number and login below was copied from the repository and checked in the session that wrote
this file; anything that could not be checked is marked **UNVERIFIED** with the reason.

## What this is

1. **Township** is a resident app (an installable web app) and a staff console for a fictional gated township in Pune with 2,400 flats: residents see and pay maintenance dues, raise complaints and see visitors; accounts staff match bank payments to flats; a committee reads a monthly report.
2. It is a six-day take-home. Money is whole paise (BigInt) in an append-only ledger; the safety words of a complaint escalate by fixed rules before any AI runs. All names and numbers are fictional, and the SMS sender and the payment gateway are mocked.
3. **Live app:** `<LIVE_URL>` (the likely address is https://residents-management-app.vercel.app; **confirm with the human**, it is not asserted here).
4. **Repository:** `<REPO_URL>` (`docs/deploy-checklist.md` names the GitHub repository `Satjeet2005/residents-management-app`; confirm).
5. Start with this file, then `docs/walkthrough.md` (a tour of every area), `docs/demo-script.md` (a five-minute demo), `docs/decisions.md` and `docs/assumptions.md`; the other documents are linked from `README.md`.

## Run it locally from a clean clone

### Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node | the version in `.nvmrc` (24.15.0; `package.json` says `engines.node` is `24.x`) | `node -v` prints `v24.15.0` (`nvm use` reads `.nvmrc`) |
| npm | the one that ships with Node 24 (this file was checked with 12.2.0) | `npm -v` |
| Docker with Compose v2 | checked with Docker 29.4.0 and Compose v5.1.1 | `docker compose version` |
| git | any recent version | `git --version` |

Free ports: **5436** for the database (change it with `DB_PORT`, below) and **3000** for the app.

An automatic check of all of this is `scripts/verify-clean-clone.sh` (see "Testing"); the steps below are what it does, by hand.

### Steps

Each step shows what you should see. The outputs were taken from a real run of `scripts/verify-clean-clone.sh` on a copy of this repository on 2026-11-08 (Node 24.15.0), with a free database port in place of 5436.

1. **Clone.**
   ```bash
   git clone <REPO_URL> township && cd township
   ```
   Expected: `Cloning into 'township'...` and no error. **UNVERIFIED:** this exact `git clone` was not run in the session that wrote this file (it was told not to clone anything); the script's `--local-copy` form, which copies the working tree instead, was run, and its `git clone` branch was only read.

2. **Use the right Node.**
   ```bash
   nvm use          # or install Node 24.15.0 any other way
   node -v
   ```
   Expected: `v24.15.0`.

3. **Install the dependencies.**
   ```bash
   npm ci
   ```
   Expected: `✔ Generated Prisma Client (7.10.1) to ./generated/prisma` (the project's `postinstall` runs `prisma generate`), then `added 534 packages in 8s` (the seconds vary), and a warning `npm warn install-scripts ... blocked because they are not covered by allowScripts` for three packages (`@prisma/engines`, `esbuild`, `prisma`). The warning is expected with this npm; nothing in the later steps needed those scripts.

4. **Create `.env` from the example, and set the secrets without printing them.** `.env` is ignored by git; never commit it.
   ```bash
   cp .env.example .env
   node -e '
   const fs = require("fs"), c = require("crypto");
   let t = fs.readFileSync(".env", "utf8");
   for (const n of ["OTP_PEPPER", "PAYMENT_WEBHOOK_SECRET"]) t = t.replace(new RegExp("^" + n + "=.*$", "m"), n + "=" + c.randomBytes(32).toString("hex"));
   fs.writeFileSync(".env", t);
   '
   ```
   Expected: no output. The names you must have set: `OTP_PEPPER` and `PAYMENT_WEBHOOK_SECRET` (both at least 32 characters in a production build, and not the `replace-with...` placeholders: the app refuses those), `DEMO_MODE=true` (already in the example), `DATABASE_URL` (already points at the local database on `DB_PORT`). Leave `DEMO_AS_OF` commented out (see "Demo logins"), `LOGS_DATABASE_URL` and `OPS_TEST_TOKEN` unset, and the `JEV_*` lines commented (without them a keyword fallback classifies complaints). `SESSION_SECRET` and `LLM_API_KEY` are in the example but unused.
   If port 5436 is taken, set `DB_PORT=<free port>` in `.env` and use the same port inside `DATABASE_URL`.

5. **Start the database.**
   ```bash
   docker compose up -d db
   docker compose ps
   ```
   Expected: `Container ...-db-1 Started`, and within a few seconds the container's status is `(healthy)`.

6. **Apply the migrations.**
   ```bash
   npx prisma migrate deploy
   ```
   Expected: `7 migrations found in prisma/migrations`, one `Applying migration` line per migration, `All migrations have been successfully applied.`; `npx prisma migrate status` then says `Database schema is up to date!`.

7. **Seed the demo data** (an empty database only; it needs `DEMO_MODE=true`, which `.env` holds).
   ```bash
   npm run db:seed -- --yes
   ```
   Expected: `Target: host localhost:5436, database township`, then the row counts (`users 3434`, `flats 2400`, `bills 11999`, `ledger_entries 25579`, `complaints 3450`, ...) ending `total 78091` and `Time: 3.0 s. Database size: 29.1 MB.` (the time varies).

8. **Build and start the app.**
   ```bash
   npm run build
   npm run start
   ```
   Expected: `Compiled successfully` and a route table, then `▲ Next.js 16.4.2`, `- Local: http://localhost:3000` and `✓ Ready in ...`. Leave it running. (For a quick look without a build, `npm run dev` also works, but the build is what the review ran.)

9. **Open the app:** http://localhost:3000/login . Expected: the login page, with a note that demo mode is on.

10. **Check readiness:** `curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/health/ready`. On a local machine the server connects as the database OWNER (the container's `township` user), so the answer is **HTTP 503 and `"status":"degraded"`**, with these four checks failing: `isSuperuser` true, `canUpdateLedger` true, `canDeleteAuditLog` true, `canReadErrorEvents` true (an owner can do all of them). That is expected locally and is the reason the next step passes `--allow-owner-role`. On the hosted deployment the app connects as a restricted role and the report is HTTP 200 and `"status":"ok"` (see "How it is deployed").

11. **Smoke-test the login over real HTTP.**
    ```bash
    npm run smoke:auth -- http://localhost:3000 5000000006 --allow-owner-role
    npm run smoke:auth -- http://localhost:3000 5000000001 --allow-owner-role
    ```
    Expected, for each: the readiness table (four `FAIL` lines for the owner's checks, then `!!! WARNING: --allow-owner-role is set`), then 13 `PASS` lines and `ALL 13 CHECKS PASSED`. The flag is for localhost only; the script refuses it for any other address. Stop the app with Ctrl+C and the database with `docker compose down` (add `-v` to delete its data).

### Common problems

| Symptom | Cause | What to do |
|---|---|---|
| `docker compose up` says the port is already allocated, or the app says `EADDRINUSE` (address already in use) | Another program holds 5436 or 3000. (These are the usual messages of Docker and Node; this file did not provoke them.) | Database: set `DB_PORT` in `.env` and the same port in `DATABASE_URL`. App: `npm run start -- -p 3100` and use that port in the URLs. |
| `prisma migrate deploy` or the seed cannot reach the database (`P1001`, "Can't reach database server") | The container is not healthy yet, or `DATABASE_URL` has the wrong port | `docker compose ps` until `(healthy)`; compare the port in `DATABASE_URL` with `DB_PORT` |
| Login fails with a server error, or `config.otpPepper` / `config.webhookSecret` is `false` in the readiness report | `OTP_PEPPER` or `PAYMENT_WEBHOOK_SECRET` is missing, shorter than 32 characters, or still starts `replace-with` | Re-run the secret command of step 4 and restart the app (`.env` is read at start) |
| The seed says `DEMO_MODE is not "true", so nothing was changed`, or the login page shows no code | `DEMO_MODE` is not exactly `true` | Set `DEMO_MODE=true` in `.env`, restart |
| The seed says `The database is not empty` | It was seeded already | Use it as it is, or start over: `npm run db:reset-demo -- --yes --confirm-database=township` (local only; destroys the local data) |
| Dues, overdue days and replies look frozen at 27 October 2026 | `DEMO_AS_OF` is set in `.env` (it freezes the business date) | Remove or comment the line and restart. It belongs only to local runs that want the brief's sample numbers, never to the live site |
| `smoke:auth` stops with `FAIL appRole.isSuperuser` and no login is tried | The server connects as the owner, as it does locally | Add `--allow-owner-role` (localhost only). On the hosted site, never: fix the grants instead (`docs/live-refresh-runbook.md`) |
| `smoke:auth` says 429 | One code per 30 seconds and 5 per hour per phone | Use another demo phone from the table below |

## Demo logins

Login is a one-time code. With `DEMO_MODE=true` and a demo phone (ten digits, starting with 5; real mobile numbers do not start with 5), the code appears **on the login screen in a banner** ("Demo mode: your code is ...") and in the `demoCode` field of the API's answer, and nothing is sent. Without demo mode no code is shown and nobody can sign in.
The numbers below are read from `src/domain/seed/people.ts`.

| Phone | Name | Role and permissions | Good for |
|---|---|---|---|
| 5000000001 | Priya Nair | staff: `payments:match` | Import the sample bank statement, review a row, post a manual match, ask for a second approver |
| 5000000002 | Rahul Menon | staff: `payments:match`, `payments:approve` | The second approver of a large manual match (never the one who asked) |
| 5000000003 | Meera Kapoor | staff: `reports:view` | The committee report |
| 5000000004 | Kavita Rao | staff: `complaints:manage` | The complaints board: assign, comment, resolve; has no "I have seen this" on a safety complaint |
| 5000000005 | Sanjay Pawar | staff: `complaints:manage`, `complaints:duty_manager` | The duty manager: acknowledges a safety complaint ("I have seen this") |
| 5000000006 | Neeraj Kulkarni | resident, flat T07-1203 (owner) | A resident with the plain Home; raising an ordinary complaint |
| 5000000007 | Swati Joshi | resident, flat T12-0408 (tenant) | Overdue dues with a late fee; paying on the demo page; raising a danger complaint |
| 5000000008 | Anil Joshi | resident, flat T12-0408 (owner) | The second person of Swati's flat |
| 5000000009 | Aamir Shaikh | resident, flat T21-1601 (owner) | A part-paid flat; the late fee that stays due after a principal-only bank payment |
| 5000000010 | Rohit Deshmukh | resident, flat T15-0902 (owner) | The "Copy payment note" button |

**Limits.** The app asks for one code per phone every **30 seconds** and at most **5 per hour per phone** (and 30 per hour per address). If you see "Try again in N seconds" wait, or use another demo phone. Staff sessions end after 30 minutes idle (12 hours overall); residents' after 14 days idle (30 days overall).

**The date.** The app uses TODAY's date, while the seed was made as of **27 October 2026**. So overdue days, late fees and reply times are larger than the client brief's sample table (for example T12-0408: 57 days overdue on 6 November 2026, from `tests/integration/home.test.ts`; the brief says 47 on 27 October). To reproduce the brief's numbers on your own machine set `DEMO_AS_OF=2026-10-27` in `.env` and restart. The live site leaves it unset.

## A five-minute reviewer path

At a phone width (Chrome: F12, then Ctrl+Shift+M, choose Responsive, 360 x 800) for the resident steps, and at 1280 x 800 for the staff steps. Each step was taken from the walkthroughs in `README.md` and from the click sequences of the browser tests (`tests/e2e/flows/*.spec.ts`, `tests/e2e/screens/*.spec.ts`, which passed 79 of 79 at the end of Phase A: see `docs/overnight-report.md`). **I did not click through the site by hand in this session**; where a label is read from the page source, not a test, it is marked (source).

Order matters for the numbers: a payment changes what the bank import sees. The import figures below (25 posted, 43 need you) assume Swati has NOT paid yet; after she pays through the demo gateway they read 24 and 44 (`docs/statement-import-design.md`, S9).

1. **A resident, dues and paying.** Open `/login`, type `5000000007`, press **Send code**, type the code from the banner into **Code**, press **Log in**. The Home shows the amount owed. Press the filled **Pay ₹...** button (or open "See what makes up this amount" for the breakdown and its **Copy payment note** button). On the **Demo payment page (mock gateway)** press **Pay successfully** (or **Payment fails, no money taken** to see the failure strip). You return to the Home, which now says **No dues**. Nothing is charged; on the live site this consumes demo data for good (the ledger is append-only).
2. **Staff: import, review, post.** Log out (Profile, **Sign out**), log in as Priya Nair `5000000001` (the staff landing page `/staff` opens), open **Bank reconciliation**, press **Use the sample statement**, then **Open this import**. The summary says "All 106 rows accounted for". In **Needs you** press **Review** on the principal-only payment of T21-1601 (₹5,660): the panel shows the narration and why it needs a person. Choose T21-1601, write a reason in **Reason**, press **Post to T21-1601**; it says what was posted and that ₹38 of late fee is still due. (Source: README "Walking the reconciliation", step 3; the e2e spec does the same through `Post`.)
3. **Staff: a large payment needs a second person.** Review one of the three credits of about ₹10,660 (a flat code and a name), choose the flat, write a reason, post: the panel says it needs a second approver and the row moves to **Awaiting approval**, where Priya sees "Waiting for another approver" and no Approve button. (On a hosted database the threshold is ₹10,000 only after the setting of `docs/live-refresh-runbook.md`, step 4.) In a second browser profile log in as Rahul Menon `5000000002`, open **Awaiting approval**, press **Approve** then **Confirm approval**: the row appears in **Posted** as "Manual by Priya Nair, approved by Rahul Menon".
4. **A danger complaint and its alert.** As Swati (log in again as `5000000007` after the code wait), press **Complaints** in the bottom bar (source), **Raise a complaint**, write "A railing on the third floor stairs has come loose", answer **Yes** to "Is anyone in danger right now?" (a **Call duty manager** link appears), press **Send complaint**. It says "Your report has gone to the duty manager." and the Home shows the same alert above the dues.
5. **The staff complaints board.** Log in as Sanjay Pawar `5000000005`, open **Complaints** from `/staff`: it opens on **Needs action** with a strip about safety complaints waiting, and Swati's report first. Open it and press **I have seen this**: "Seen by the duty manager" appears. Back as Swati, the Home now says "The duty manager has seen your report". As Kavita Rao `5000000004` the same complaint has no **I have seen this** button.
6. **The committee report at phone and laptop width.** Log in as Meera Kapoor `5000000003`, open **Committee report** from `/staff`. At 360 px: one column, four cards, five closed sections (tap one to open it); at 1280 px: four cards in a row, sections in two columns, the first two open. Every chart has **Show as a table**. Screenshots: `docs/screenshots/committee-report-360.png` and `committee-report-1280.png`.

## How it is deployed

| Piece | Choice |
|---|---|
| App hosting | **Vercel, Hobby plan**, one function region, Singapore (`sin1`), Node 24.x, production branch `master` |
| Database | **Neon, Free plan**, Postgres, region AWS Asia Pacific 1 (Singapore, `aws-ap-southeast-1`), database `neondb` (the region cannot be changed later) |
| Why Singapore | Neon has no Mumbai region; the function sits in the same AWS region as the database (`docs/deployment-plan.md`, Decision 2) |
| Two database roles | **`neondb_owner`** owns the tables and is used only on the developer's laptop, for migrations, the seed and the grants: it can switch off the append-only triggers, so it is never given to the app. **`township_app`** is what the app uses: it does not own the tables and has only the privileges generated from one matrix (`src/server/db-roles/app-role.ts`), so a bug or an attack in the web app cannot rewrite the ledger or the audit log. A third, read-only role `township_logs` reads the error log from the developer's machine |
| Environment variables (names only) | Secrets, set only in the Vercel dashboard (Production): `DATABASE_URL` (the pooled `township_app` string ending `?sslmode=verify-full`), `OTP_PEPPER`, `PAYMENT_WEBHOOK_SECRET`, `OPS_TEST_TOKEN` (optional), and `JEV_PRIMARY_KEY` / `JEV_SECONDARY_KEY` (optional classifier keys). Not secret: `DEMO_MODE`, `SHOW_DESIGN_PAGE`, `JEV_*_URL`, `JEV_*_MODEL`, `DB_POOL_MAX`. Never in Vercel: the owner's string and `LOGS_DATABASE_URL` (laptop only). Must be unset on the live site: `DEMO_AS_OF` |
| Demo mode | `DEMO_MODE=true` during the review window so a reviewer can sign in with the code shown on screen. **Kill switch:** set `DEMO_MODE=false` in the Vercel dashboard and Redeploy (variables apply only to new deployments); nobody can sign in then |
| Terms and disclosure | Vercel's Hobby plan is for **non-commercial use**; this is an unpaid take-home demo, with fictional data, and the site **may be paused**. Vercel's terms (as read on 2026-11-06, `docs/deployment-plan.md`, Decision 11) say Hobby content may be used to train AI models; only the code and fictional data are there |
| The live ledger is append-only | Paying on the live site settles a sample bill for good, so reviewers consume demo data |
| Restoring the data | `docs/hosted-reset-procedure.md` (owner only; destroys everything; run it last). Bringing a deployment up to date: `docs/live-refresh-runbook.md` |

The hosted readiness report (`<LIVE_URL>/api/health/ready`) should read HTTP 200 and, as captured from a local server connecting as a non-owner role (the same shape the hosted one has):
`{"status":"ok","checks":{"config":{"otpPepper":true,"webhookSecret":true,"demoMode":true,"opsTestEnabled":false,"vercelSystemVars":false,"nodeMajor":24},"database":"ok","schema":{"missingTables":[]},"appRole":{"isSuperuser":false,"canInsertOtp":true,"canUpdateLedger":false,"canDeleteAuditLog":false,"canInsertErrorEvents":true,"canReadErrorEvents":false},"data":{"seeded":true}}}`
On Vercel `vercelSystemVars` is `true`; `opsTestEnabled` is `true` once `OPS_TEST_TOKEN` is set. **UNVERIFIED:** the hosted deployment itself was not reached from the session that wrote this file.

## Install it on a phone

Open `<LIVE_URL>` over HTTPS. Chrome on Android: menu, **Install app** (or **Add to Home screen**). iPhone: Safari, Share, **Add to Home Screen**. It opens without the browser bars. Only the **offline page** works without a network ("You're offline. You can't pay right now."): the money and the complaints always come from the server, and the service worker stores only that page and the icons, never anything after login (`docs/installable-app.md`). Over plain HTTP on a LAN address Chrome will not install it; `localhost` does.

## Testing

Counts are from this session on 2026-11-08 unless marked.

| Command | What it proves | Result |
|---|---|---|
| `npm run check` | lint, TypeScript strict and every unit test: the money, ledger, late-fee, matching, safety-rule and state-machine logic and the UI markup | 197 test files passed, **4,641 tests passed, 1 skipped** |
| `npm run test:ci-parity` | the unit and integration tests the way CI runs them: no `.env`, only `DATABASE_URL`; the integration tests use a real Postgres, the app role and the database triggers | unit 4,641 passed, 1 skipped; integration **74 files, 1,105 tests passed** (258 s), run by `scripts/verify-clean-clone.sh` on a clean copy |
| `npm run test:integration` | the integration tests alone (needs the database running) | the 1,105 above |
| `npm run e2e` | the real-browser checks (Playwright, Chromium only) on the built app and a scratch database, at 360, 768 and 1280 px, with accessibility checks (axe) | **79 passed (3.3 min) at the end of Phase A: carried from `docs/overnight-report.md`, NOT re-run in this session** (it rewrites tracked screenshots). Needs `npx playwright install chromium` once |
| `npm run smoke:auth -- <BASE_URL> <phone>` | login over real HTTP: the readiness report, the 30-second wait, a generic answer for an unknown phone, the cookie flags, `/api/me`, a refused cross-site `logout-all` | 13 of 13 passed, as a resident and as staff, against a clean-clone build (owner role, `--allow-owner-role`) and against a build using a restricted role (no flag). Safe on the live site |
| `smoke:app` (retired) | RETIRED. It checked screens as they were before the redesigns of the committee report, the staff home, the reconciliation workspace and the complaints board, and failed 34 of 166 checks. Use `npm run e2e` (browser tests on a scratch database), the unit and integration suites, `npm run smoke:auth` and `scripts/verify-clean-clone.sh` instead. Do not run the old script against any deployment: it mutates data | Not part of the reviewer path |
| `npm run llm:check` | that your own classifier keys answer (three fictional complaints per provider) | **Not run: it needs your keys and uses the free quota** |
| `npm run scan:secrets` | no secret pattern in the tree | `scan:secrets: no secrets found` |
| `scripts/verify-clean-clone.sh <REPO_URL> [--quick]` | the whole path above, from an empty directory, with its own database container | 12 of 12 steps PASS on a copy of the working tree (`--local-copy`); the `git clone` branch is UNVERIFIED |

## When something breaks

`docs/observability.md` is the guide. There are three places to look:

1. **Vercel live logs** (Project > Logs): every failure is one JSON line with its reference; **Vercel Hobby keeps only the last hour**.
2. **The error log** in our own database, read from the developer's machine: `npm run logs:errors -- --ref=E-XXXXXX --paste` (the `E-XXXXXX` reference is in the "Something went wrong" answer; the number on an error page is a digest: `--digest=N`). It needs `LOGS_DATABASE_URL`, the read-only role, on that machine only. Options are written `--name=value`.
3. **The readiness page** `<LIVE_URL>/api/health/ready`: booleans and table names only, safe to paste.

| Failing readiness check | Likely cause | First fix |
|---|---|---|
| `config.otpPepper` or `config.webhookSecret` false | The variable is missing, short or a placeholder | Set it in Vercel (Production), Redeploy |
| `database: unreachable` or `timeout` | Wrong `DATABASE_URL`, or Neon waking up | Check the variable; wait 10 seconds and reload |
| `schema.missingTables` not empty | Migrations not applied | `docs/live-refresh-runbook.md`, steps 2 and 3 |
| `appRole.isSuperuser` / `canUpdateLedger` / `canDeleteAuditLog` true | The app connects as the owner | `DATABASE_URL` must be the `township_app` string |
| `appRole.canInsertOtp` or `canInsertErrorEvents` false | Grants not run after the last migration | Runbook, step 3 |
| `appRole.canReadErrorEvents` true | The app role was given SELECT on the error log | Runbook, step 3 |
| `data.seeded` false | Database empty | Seed, or `docs/hosted-reset-procedure.md` |

## Security notes

Short: one-time codes stored as an HMAC, database sessions with idle and absolute limits, CSRF origin checks, every route guarded and a test that fails if one is not, a ledger the database itself keeps append-only, a non-owner application role, a signed payment webhook, redacted logs, secret scanning, and safety rules that run before any AI. What is not built (real SMS, passkeys for staff, encryption of phone numbers, retention jobs, monitoring, tested backups, a penetration test) is listed in `docs/security.md`, with the files and tests behind each claim. The design is "aligned with" the guidance named there; nothing here is a claim of compliance.

## Known limitations

The candid list, with why, impact, fix and effort for each, is `docs/known-limitations.md`. The ones a reviewer meets first: SMS and the payment gateway are mocked; payment hold and release states, fee waivers, undo, duplicate-complaint linking, the notifications bell, the ledger page, receipts and the Hindi and Marathi screens are not built; the Hindi and Marathi safety words are not yet reviewed by a native speaker; the classifier's accuracy is not benchmarked; breakers and caps are per serverless instance; only Chromium was tested.

## Placeholders for the human

- [ ] `<LIVE_URL>`: the hosted address (likely https://residents-management-app.vercel.app; confirm in the Vercel dashboard). Fill it in this file (the first lines, "Install it on a phone", "How it is deployed"), in `README.md`, and in `docs/submission-checklist.md`.
- [ ] `<REPO_URL>`: the public repository address (the checklist names `Satjeet2005/residents-management-app`; confirm). Same places, and the clone step above.
- [ ] Run `grep -rn "<LIVE_URL>\|<REPO_URL>" README.md deployment.md docs` before submitting and decide for each hit whether it should stay.

## Checking the documents

`npm run docs:verify` checks that every file path, test citation and `npm run` name in the Markdown files of `docs/`, `README.md` and this file exists and is committed (a file that is only on your disk fails, as it would on GitHub). Run it before a release; it prints one line per problem and exits 1 when there is one.

Developer note: `bash scripts/verify-clean-clone.sh --local-copy <repo> --tracked-only` (from an empty directory) copies only the files `git ls-files` lists, which is what CI has; use it before a push.
