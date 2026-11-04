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
