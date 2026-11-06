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

Set `OTP_PEPPER` in `.env` (at least 32 characters in production). Design and threat notes: `docs/auth-design.md`.
