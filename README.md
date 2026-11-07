# Township

Resident app and staff console for a gated township. See `CLAUDE.md` for the rules this repo follows.

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
npm run build
npm run scan:secrets
```

## Demo data

```bash
npm run db:seed -- --yes                                    # seed an empty local database
npm run db:reset-demo -- --yes --confirm-database=township  # recreate the schema, then seed
```

Both need `DEMO_MODE=true`. A reset works only on localhost, and only on the
databases `township`, `township_seed_scratch` and `township_test_*`, and you must
type the exact database name; a remote seed needs `--allow-remote` as well. The
guards and the reasons for them are in `docs/seed-data.md`.

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
