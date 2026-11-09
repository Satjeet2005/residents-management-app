# Township

A resident app (an installable web app) and a staff console for a fictional gated township in Pune with 2,400 flats: residents see and pay maintenance dues, raise complaints and see visitors; accounts staff match bank payments to flats; a committee reads a monthly report. Money is whole paise in an append-only ledger, and the safety words of a complaint escalate by fixed rules before any AI runs. Everything is demo data, and the SMS sender and the payment gateway are mocked. See `CLAUDE.md` for the rules this repo follows.

**Live app:** `<LIVE_URL>` (placeholder: the hosted address, to be filled in by the owner). **Repository:** `<REPO_URL>` (placeholder). The list of placeholders is at the end of [deployment.md](deployment.md).

## Start here

- [deployment.md](deployment.md): run it from a clean clone, the demo logins, a five-minute reviewer path, how it is deployed, testing, what to do when something breaks.
- [docs/walkthrough.md](docs/walkthrough.md): a tour of every core area. [docs/demo-script.md](docs/demo-script.md): the five-minute demo with fallbacks.
- [docs/interview-prep.md](docs/interview-prep.md) and [docs/numbers-to-know.md](docs/numbers-to-know.md): the hard questions and the numbers an interviewer may ask for.
- [docs/decisions.md](docs/decisions.md) and [docs/assumptions.md](docs/assumptions.md): every decision and every labelled assumption.
- [docs/security.md](docs/security.md) and [docs/known-limitations.md](docs/known-limitations.md): what is built and what is not, candidly.
- [docs/observability.md](docs/observability.md): where to look when something fails.
- [docs/live-refresh-runbook.md](docs/live-refresh-runbook.md) and [docs/hosted-reset-procedure.md](docs/hosted-reset-procedure.md): bring the hosted deployment up to date, or restore its demo data (owner only).
- [docs/submission-checklist.md](docs/submission-checklist.md): the final checklist. [docs/screenshots](docs/screenshots): the pictures from the browser checks.

## Run

Requires Node 24+ and Docker.

```bash
npm install
cp .env.example .env        # local values; never commit .env
docker compose up -d        # Postgres 16 on localhost:5436
npx prisma migrate deploy   # apply database migrations
npm run db:seed -- --yes    # optional: load the demo data into the empty local database
npm run dev                 # http://localhost:3000, health at /api/health
```

## Checks

```bash
npm run check               # lint + typecheck + unit tests
npm run test:integration    # needs the database running
npm run test:ci-parity      # unit and integration tests as CI runs them: no .env, only DATABASE_URL
npm run build
npm run scan:secrets
npm run submission:zip -- <tdd.pdf|tdd.docx> [--with-screenshots]  # builds submission/township-submission-<date>.zip (the TDD file and deployment.md) after checking placeholders and the links at the top; see scripts/build-submission-zip.sh
npm run docs:verify          # every file path, test citation and npm script named in the documents must exist (scripts/verify-doc-references.mjs); exits 1 on a problem
npm run llm:check            # one request to each configured classifier provider (names, statuses and timings only; never a key)
npm run jev:e2e              # raise eight complaints through the real service on a scratch database, with the real providers if configured (docs/jev-integration.md)
npm run classifier:benchmark # the classifier benchmark on 200 synthetic complaints; --dry-run needs no network; --from-fixture recomputes docs/classifier-benchmark.md
npm run safety:benchmark      # recompute the safety-detection benchmark (dev, the reused holdout and holdout2), print the headline numbers, fail if they differ from the committed ones (docs/safety-benchmark.md; single-operation recall 46.1% on the independent holdout)
```

## Browser checks and installing the app

```bash
npx playwright install chromium   # once; the browser is not in the repository
npm run e2e                       # builds on a scratch database, runs every real-browser spec at 360px and 1280px, tears down
```

`npm run e2e` is not part of `check` or `test:ci-parity` (it needs a browser and a build). The method, the checks and what it found are in `docs/browser-verification.md`; screenshots are written to `docs/screenshots/`.

To install the app on a phone, open the site over HTTPS and use "Install app" (Chrome on Android) or "Add to Home Screen" (Safari); `docs/installable-app.md` says what the service worker keeps (only the offline page and the icons, never a page after login).

## Before you push

Run `npm run test:ci-parity`. CI has no `.env` and only `DATABASE_URL` in its environment, and a test that passes only with your `.env` is a bug (D128).
The script runs `npm run test:unit` and `npm run test:integration` under `env -i` with `IGNORE_DOTENV=true` and nothing else but `PATH`, `HOME`,
`NODE_OPTIONS` and `DATABASE_URL` (yours if set, else the local value of `.env.example`). Test-only defaults for `OTP_PEPPER` and `PAYMENT_WEBHOOK_SECRET`
live in one file, `tests/setup/env-defaults.ts`, and apply only when the variable is unset; a test about a missing secret removes it itself.

## Demo data

```bash
npm run db:seed -- --yes                                    # seed an empty local database
npm run db:reset-demo -- --yes --confirm-database=township  # recreate the schema, then seed
```

Both need `DEMO_MODE=true`. A reset works only on localhost, and only on the
databases `township`, `township_seed_scratch` and `township_test_*`, and you must
type the exact database name; a remote seed needs `--allow-remote` as well. The
guards and the reasons for them are in `docs/seed-data.md`.

## Errors and logs (D135)

An unexpected failure is written to stdout and stored in the `error_events` table, with a reference (`E-XXXXXX`, or the digest of a page error).
Only the developer reads it: no page, no permission. `npm run logs:errors -- --ref=E-XXXXXX --paste` (needs `LOGS_DATABASE_URL`, a read-only role, on
your machine only), `npm run db:print-logs-role-sql -- --role=<name> --owner=<name>`, `npm run db:prune-errors -- --days=30 --yes --confirm-database=<name>`.
See `docs/observability.md`. On a developer's machine whose server connects as the database owner, add `--allow-owner-role` to the smoke scripts (local only).

## Smoke test (login over real HTTP)

With the app running in demo mode (`DEMO_MODE=true`, an `OTP_PEPPER`, a database that holds the seed):

```bash
npm run build && npx next start -p 3100            # in one terminal, with DATABASE_URL, DEMO_MODE and OTP_PEPPER set
npm run smoke:auth -- http://localhost:3100 5000000006    # a resident
npm run smoke:auth -- http://localhost:3100 5000000001    # a staff member
```

It checks: request code, the 30-second refusal (429), an unknown phone looks like a known one, a wrong code gets the generic
key, login, the cookie flags, `GET /api/me`, a cross-site `logout-all` refused, `logout-all`, and `/api/me` then 401. It
prints PASS/FAIL lines (lengths only, never the code or cookie) and exits non-zero on failure. To try it safely, use a
scratch database such as `township_seed_scratch` (see Demo data) and drop it afterwards.

## Paying in the demo

With the app running in demo mode (`DEMO_MODE=true` and a `PAYMENT_WEBHOOK_SECRET` in `.env`). With `npm run dev` the placeholder in `.env.example` is enough; with `npm run build && npm run start` (a production build) the app refuses the placeholder and any secret under 32 characters, so set your own:

1. Log in as Swati Joshi (`5000000007`) at `/login`; the code is shown in the banner.
2. On the Home, tap **Pay ₹X** (or open "See what makes up this amount" and tap Pay in the sheet's footer).
3. On the **Demo payment page (mock gateway)**, tap **Pay successfully**. You land on the Home, which now says "No dues" and lists the late fee and the payment.
   Tap **Payment fails, no money taken** instead to see the strip "That payment didn't go through" and Pay still available.

The page stands in for a real provider and charges nothing. In `DEMO_MODE` other than `true` there is no payment at all (503 and a 404). More in `docs/payments-design.md`;
the whole flow over real HTTP is `scripts/smoke-app.mjs`.

## The app

```bash
npm run dev                  # http://localhost:3000, development build, plain http
npm run build && npm run start   # the production build, also over plain http on localhost
```

Over plain http the session cookie is `session` (a browser will not store a Secure or `__Host-` cookie from `http://localhost`); over
https it is `__Host-session` (D94), so both work.

- `/login`: log in with a demo phone (below). With `DEMO_MODE=true` the code is shown in a banner.
- `/` is the resident Home (dues, complaint, visitors, recent activity). A staff member is sent to `/staff`.
- `/profile` is the resident's profile; `/staff` is the staff landing page; a resident who opens `/staff` ends at `/forbidden`.
- The Home works out "today" with the real India date. The demo data was created as of 27 October 2026, so overdue days and late fees are
  higher than in the client brief's sample table, and some replies show as overdue. **To reproduce the brief's numbers locally** (T12-0408 owes
  ₹6,468, 47 days overdue), set `DEMO_AS_OF=2026-10-27` in `.env` (it is in `.env.example`, commented out) and restart. Leave it unset on a live deployment.
  When `DEMO_MODE=true` a note on the login page and on Profile says this too.
- `npm run smoke:app -- http://localhost:3100 --as-of=2026-10-27 --demo=true` (or `--as-of=real`) checks the pages over HTTP against a running server.
  Design notes: `docs/ui-architecture.md`.

## Walking the reconciliation (staff)

The bank reconciliation screens are in `docs/staff-ui.md`. With a seeded database and the app running in demo mode (`DEMO_MODE=true`, see Run and
Demo data above; `DEMO_AS_OF=2026-10-27` reproduces the numbers below):

```bash
npm run db:seed -- --yes && npm run build && npm run start     # http://localhost:3000
```

1. Log in as **Priya Nair** (`5000000001`, `payments:match`; the code is in the banner). `/staff` lists **Bank reconciliation**.
2. Open it and press **Use the sample statement** (or upload any .csv with the columns Txn Date, Narration, Credit, Debit). You land on the recent
   imports; open the new one. The summary bar reads 25 posted automatically, 43 need you, 0 awaiting approval, 38 not maintenance, and "All 106 rows accounted for" (one fewer posted and one more needing you if Swati Joshi has paid through the demo gateway first).
3. In **Needs you** the biggest credits are first. Press **Review** on the principal-only payment of T21-1601 (₹5,660): the panel shows the full
   narration, why it needs a person, the candidates and "Equals the unpaid bill, ₹38 of late fee would still be due". Choose T21-1601, write a
   reason, **Post to T21-1601**. It says what was posted ("Late fee ₹38", "Payment ₹5,660", "₹38 late fee still due"). Log in as the resident
   Aamir Shaikh (`5000000009`): the Home says "Late fee due ₹38".
4. Review one of the three credits of about ₹10,660 (a flat code and a name, queued because the demo's second-approver threshold is ₹10,000, D116) and
   match it: the panel says it needs a second approver, and the row moves to **Awaiting approval**, where Priya sees "Waiting for another approver".
5. In a second browser profile log in as **Rahul Menon** (`5000000002`, `payments:approve`): Awaiting approval shows **Approve** and **Reject**.
   Approve it; it appears in **Posted** as "Manual by Priya Nair, approved by Rahul Menon".
6. **Posted** and **Not maintenance** are read only. There is no undo, no accept-all, no advance credit and no waiver (docs/staff-ui.md).

To look at it at 1280px and at 360px, open the page in Chrome or Firefox, press F12 and then Ctrl+Shift+M (device toolbar), choose Responsive and
type 1280 x 800, then 360 x 800. At 1280px the review panel is docked at the right and the rows are a table; at 360px the rows are cards and the panel
is a full-screen sheet (Escape or Close returns to the row). Tab through the page: every control shows a ring, and the tabs move with the arrow keys.

## Walking the complaints board (staff)

The staff complaint screens are in `docs/staff-complaints-ui.md` (decisions D130, D151, D152 and D153). With a seeded database and the app running in demo mode (see
Run and Demo data above), first raise a danger report as a resident so there is a safety complaint nobody has seen:

1. Log in as **Swati Joshi** (`5000000007`), press **Complaints**, **Raise a complaint**, answer **Yes** to "Is anyone in danger right now?" and send. Try also a
   plain "Killed someone" with **No**: the safety words catch it (CRITICAL, sent to the duty manager). Log out.
2. Log in as **Sanjay Pawar** (`5000000005`, the duty manager: `complaints:manage` and `complaints:duty_manager`). `/staff` lists **Complaints**. Open it: it opens
   on **Needs action**, with a strip "<n> safety complaints waiting for the duty manager." above the rows, and your report is the first row, with the Critical and
   Safety chips. At 360px press **View** to choose among the eight views and **Filters** to filter by category, assignee, urgency or flat code (`T12`, `t12-04`).
   Press the title of your report.
3. The page has the title, chips (flat, urgency, status, reply clock), the line "The duty manager has not seen this yet." and two tabs: **Details** and **Timeline**.
   On a phone **I have seen this** is the one filled button, pinned at the bottom, with **More**; from 1024px it is in the panel on the right. Press it: "Marked as
   seen." appears and the banner says when. Log in as Swati again: the Home alert says "The duty manager has seen your report".
4. Log in as **Kavita Rao** (`5000000004`, `complaints:manage` only) and open the same complaint: the bar says **Update** and there is no **I have seen this**, no
   **Close this safety complaint** and no **Mark resolved**. Open any ordinary complaint from **Needs triage** or **Open**: press **Update**, assign it, mark it in
   progress, add a comment with the **Visible to the resident** box off (the resident's page does not show it) and another with it ticked (it does), mark it resolved
   with a note and find it in **Waiting for resident**.

To look at it at 1280px, 768px and 360px, open the page in Chrome or Firefox, press F12 and then Ctrl+Shift+M (device toolbar), choose Responsive and type 1280 x 800,
then 768 x 1024, then 360 x 800. From 1024px the views are a sidebar and the actions a panel on the right; at 768px the board is a table and the actions are the bar and
sheet; at 360px the rows are compact cards. Tab through the page: every control shows a ring, the Details and Timeline tabs move with the arrow keys, Escape closes a
sheet and returns the focus to the button that opened it. `npm run e2e` checks all of this in a real browser at the three widths. In demo mode the board says that the
demo data is dated 27 October, so replies can look overdue.

## Reading the committee report (staff)

The report is described in `docs/committee-report.md` (decisions D131 to D133, and D171 to D183 for the version that applied the committee audit; what was done with every audit finding is in `docs/committee-audit-disposition.md`). With a seeded database and the app running in demo mode (see Run and Demo data above; `DEMO_AS_OF=2026-10-27` reproduces the
numbers below):

```bash
npm run db:seed -- --yes && npm run build && npm run start     # http://localhost:3000
```

1. Log in as **Meera Kapoor** (`5000000003`, `reports:view`; the code is in the banner). `/staff` lists **Committee report**; open it. A resident, or staff without `reports:view`, ends at `/forbidden`.
2. The top says "As of 27 October 2026 · read only", and the month box changes the page as soon as you choose a month. Under it are four cards, each naming its period: **Money collected for October** (82%, "₹1.48 crore of ₹1.81 crore billed", October within 20 days and September at the same age), **Total still owed, all months**, **Bills paid by the due date** and **Complaints answered in time** (each against its goal with the gap in points, Met or Not met in words with an icon, and a small six-month line you can open as a table). A strip above them appears only while a safety complaint is open and not yet seen by the duty manager. "What these words mean" under the cards leads to About.
3. Below the cards are five sections; each title has a one-sentence summary that adds something the cards do not say. At 360px they start closed: tap one to open it. At 768px and wider the first two (**Billed and collected**, **What is owed**) start open.
   **Billed and collected**: Billed = Collected + Still unpaid, the late fees in three lines (real money apart from a calculation), and the month-by-month collection measured at the same age (within 20 days).
   **What is owed** says "All open dues, all months": Total owed = unpaid bills + late fees, one list of age groups, **See the flats** beside each group opens its flats (flat codes only, largest first, a switch to oldest first, 25 at a time, a way back at the top and bottom), and the towers that owe the most.
4. **How fast bills are paid** (three rows, three plain numbers and, from 768px, the payment curve), **Complaints** (six lines, one safety line, and from 768px the weekly SLA chart) and **Bank statement matchingon** (three lines;
   it says no statement was imported until you import the sample statement as Priya Nair). Every chart has a **Show as a table** link with the same numbers as text. **About these numbers** at the bottom defines every figure.
5. **Choose sections** (at the bottom, above About) opens a sheet: untick a section and it is gone from the page at once, and stays gone after a reload on this device and browser; tick it again to bring it back, then press Done. The four cards cannot be hidden. The choice is a cookie, not a setting in the database.
6. The targets are assumptions in the setting `committee_goals`. On a hosted database that was seeded before this task, the owner inserts the row once (`docs/deploy-checklist.md`, E8); until then the built-in targets are shown and
   the page says so.

To look at it at phone and laptop width, open the page in Chrome or Firefox, press F12 and then Ctrl+Shift+M (device toolbar), choose Responsive and type 360 x 800, then 768 x 1024, then 1280 x 800. At 360px it is one
column: four cards, five closed sections, and only bars and small trend lines (no line charts). At 768px the cards are two by two, the first two sections are open and the line charts and columns appear, full width. At 1280px the cards
are four in a row and the sections two columns. Tab through the page: every control shows a ring, and Enter or Space opens a section. The pictures taken by the browser checks are in `docs/screenshots/committee-report-*.png`.

## Raising a complaint (resident)

Complaint screens: `docs/complaints-ui.md`. With a seeded database and the app running in demo mode (see Run and Demo data above), open the page in a
browser at 360 x 800 (F12, then Ctrl+Shift+M):

1. Log in as **Swati Joshi** (`5000000007`). Press **Complaints** in the bottom bar, then **Raise a complaint**.
2. Write "Stairwell light on floor 4 is flickering", press **Send complaint** without answering "Is anyone in danger right now?": it refuses and says
   "Choose Yes or No." Choose **No** and send. You land on the complaint with a confirmation and its tracker.
3. Raise another, choose **Yes**: the call link appears at once ("You can still send this report."). Send it, even with nothing written. Go Home: the
   safety alert is above the dues ("Your report has gone to the duty manager") with a filled **Call duty manager**, and Pay is outlined.
4. The duty manager has no screen yet, so acknowledge it through the API (the id is in the address of the complaint page; the code of each login is in the
   `demoCode` of the first answer):

```bash
curl -s -c /tmp/duty.jar -H 'content-type: application/json' -d '{"phone":"5000000005"}' http://localhost:3000/api/auth/otp/request
curl -s -c /tmp/duty.jar -H 'content-type: application/json' -d '{"phone":"5000000005","code":"<the demoCode>"}' http://localhost:3000/api/auth/otp/verify
curl -s -b /tmp/duty.jar -X POST -H 'content-type: application/json' -d '{}' http://localhost:3000/api/staff/complaints/<id>/acknowledge
```

   Reload Home: "The duty manager has seen your report. Seen at ...". Left alone for 5 minutes (real clock; `DEMO_AS_OF` freezes time) it changes to "No answer yet".
5. To see "Is it fixed?", mark a normal complaint resolved as **Kavita Rao** (`5000000004`) with `POST /api/staff/complaints/<id>/status`
   (`{"status":"PENDING_CONFIRMATION","expectedVersion":<version from GET /api/staff/complaints/<id>>}`), then reload the complaint page.

## Checking the classifier providers (you, with your own keys)

The complaint classifier can use two System One providers (`docs/classifier-providers.md`). Without keys the keyword fallback answers every complaint. To
check your keys, put the `JEV_PRIMARY_*` and `JEV_SECONDARY_*` lines from `.env.example` in your own `.env` (never in a chat, an issue or a commit) and run. The URL and the key are needed; the two `_MODEL` lines are optional: without one the request carries no model name and the provider uses its default (if a provider answers 400 or 422 the check tells you to set one). A mistake in any of these settings never stops a complaint from being raised: that provider is skipped, or the number uses its default, and the check names the variable:

```bash
npm run llm:check
```

It sends three fictional complaints to each configured provider and prints one line per provider and sample (provider name, HTTP status, latency, top
category and urgency with probabilities). It never prints a key or a URL, and exits 1 if no provider answered. It uses three calls per provider from the
free quota.

## Demo logins

Login is a one-time code. With `DEMO_MODE=true` and a demo phone (starts with 5), the API returns the code in
the response (`demoCode`) and nothing is sent. Seeded users (read from `src/domain/seed/people.ts`):

| Phone | Name | Role and permissions |
|---|---|---|
| 5000000001 | Priya Nair | staff: `payments:match` |
| 5000000002 | Rahul Menon | staff: `payments:match`, `payments:approve` |
| 5000000003 | Meera Kapoor | staff: `reports:view` |
| 5000000004 | Kavita Rao | staff: `complaints:manage` |
| 5000000005 | Sanjay Pawar | staff: `complaints:manage`, `complaints:duty_manager` |
| 5000000006 | Neeraj Kulkarni | resident, flat T07-1203 |
| 5000000007 | Swati Joshi | resident, flat T12-0408 |
| 5000000008 | Anil Joshi | resident, flat T12-0408 |
| 5000000009 | Aamir Shaikh | resident, flat T21-1601 |
| 5000000010 | Rohit Deshmukh | resident, flat T15-0902 |

```bash
curl -s -X POST localhost:3000/api/auth/otp/request -H 'content-type: application/json' -d '{"phone":"5000000001"}'
# {"message":"OTP_SENT_GENERIC","retryAfterSeconds":30,"demoCode":"123456"}
curl -si -X POST localhost:3000/api/auth/otp/verify -H 'content-type: application/json' -d '{"phone":"5000000001","code":"123456"}'
```

Set `OTP_PEPPER` in `.env` (at least 32 characters in production). `PAYMENT_WEBHOOK_SECRET` is the same kind of secret (32 characters or more in production) and signs the payment gateway's webhook events. Design and threat notes: `docs/auth-design.md`.
