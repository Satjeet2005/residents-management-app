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

With the app running in demo mode (`DEMO_MODE=true` and a `PAYMENT_WEBHOOK_SECRET` of any value in `.env`; copy it from `.env.example`):

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
