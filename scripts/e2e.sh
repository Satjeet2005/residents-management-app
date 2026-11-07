#!/bin/sh
# `npm run e2e`: the real-browser checks (Playwright, Chromium only) against the BUILT app on a scratch database. It is NOT part of `npm run check` and NOT part of
# `npm run test:ci-parity`. Steps: drop any old township_seed_scratch and create a new one (SELECT current_database() is printed and checked first), migrate it
# (`prisma migrate deploy`, no reset) and seed it (`db:seed -- --yes`, the documented flag), build the app, start it on a free port with the demo settings and the JEV_ classifier variables BLANK, run Playwright, and tear everything down (stop the
# server by its PID, drop the database; the app creates no role). Arguments after `--` go to `playwright test` (for example `-- --project=mobile-360`).
# The browser binary is downloaded once with `npx playwright install chromium` into your own cache; it is never committed.
set -e
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' .env.example)}"
SCRATCH_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/township_seed_scratch"; console.log(u.toString())' "$DATABASE_URL")
PORT=$(node -e 'const s = require("net").createServer().listen(0, () => { console.log(s.address().port); s.close(); })')
SECRET=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
PEPPER=$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
SERVER_PID=""

cleanup() {
  status=$?
  if [ -n "$SERVER_PID" ]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null || true
  fi
  node scripts/e2e-db.mjs drop || true
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "== scratch database =="
# A leftover from an earlier run is dropped first, so the database is always new and empty: it then needs only `migrate deploy` and the seed, never a reset.
node scripts/e2e-db.mjs drop
node scripts/e2e-db.mjs create

# The same environment for the seed, the build and the server: the scratch database, demo mode, a frozen business date, test secrets, no classifier provider.
run_env() {
  env DATABASE_URL="$SCRATCH_URL" DEMO_MODE=true DEMO_AS_OF=2026-10-27 IGNORE_DOTENV=true \
    PAYMENT_WEBHOOK_SECRET="$SECRET" OTP_PEPPER="$PEPPER" \
    JEV_PRIMARY_URL= JEV_PRIMARY_KEY= JEV_PRIMARY_MODEL= JEV_SECONDARY_URL= JEV_SECONDARY_KEY= JEV_SECONDARY_MODEL= "$@"
}

echo "== migrate and seed =="
run_env npx prisma migrate deploy
run_env npm run db:seed -- --yes

echo "== build =="
run_env npm run build

echo "== start the app on port $PORT =="
# setsid gives the server its own process group, so stopping its PID stops next-server too.
run_env setsid node_modules/.bin/next start -p "$PORT" >"${TMPDIR:-/tmp}/township-e2e-server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then break; fi
  sleep 1
done
curl -s -o /dev/null -w "login page: HTTP %{http_code}\n" "http://localhost:$PORT/login"

echo "== playwright =="
E2E_BASE_URL="http://localhost:$PORT" npx playwright test "$@"
