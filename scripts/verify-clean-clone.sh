#!/usr/bin/env bash
# Proves that the repository works from a clean clone, using only what the repository says (deployment.md). Run by a HUMAN, in an EMPTY temporary directory:
#
#   mkdir /tmp/township-verify && cd /tmp/township-verify
#   bash /path/to/scripts/verify-clean-clone.sh <repository-url> [--quick]
#   bash /path/to/scripts/verify-clean-clone.sh --local-copy <directory> [--quick] [--skip-install]
#
# It clones (or copies) the project into ./repo, checks Node against .nvmrc, runs `npm ci`, writes a local .env from .env.example with FRESH random secrets (nothing
# secret is printed), starts its OWN database container (a unique COMPOSE_PROJECT_NAME and a free host port, so the development database is never touched), migrates,
# seeds, builds, starts the app on a free port, runs `npm run smoke:auth` for one resident and one staff phone and (unless --quick) `npm run test:ci-parity`. At the end
# it stops ONLY what it started and prints a PASS/FAIL table. The exit status is non-zero when any step failed.
#
# Options
#   --quick          skip `npm run test:ci-parity` (the unit and integration tests; several minutes)
#   --local-copy D   do not clone: copy directory D (without node_modules, .next, .env, .git, test-results, generated)
#   --tracked-only   with --local-copy: copy exactly the files `git ls-files` lists in D (skipping deleted ones), no untracked files: what a clone, and so CI, has
#   --skip-install   TEST ONLY: link node_modules from the repository this script lives in instead of running `npm ci`, to save disk and time. The `npm ci` step is then
#                    reported SKIP and is NOT verified. Never use it for the real check.
# Environment (optional): VCC_DB_PORT and VCC_APP_PORT choose the host ports; the script refuses with a message if one is taken. Without them it picks free ports.
#
# It never prints a secret, a code, a cookie or the contents of .env, never runs a destructive command against any database but its own container, and deletes no
# directory (the work directory stays for you to look at; remove it yourself).
set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK="$PWD"
REPO="$WORK/repo"
LOGS="$WORK/logs"

QUICK=false
SKIP_INSTALL=false
TRACKED_ONLY=false
LOCAL_COPY=""
REPO_URL=""

usage() {
  sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --quick) QUICK=true ;;
    --skip-install) SKIP_INSTALL=true ;;
    --tracked-only) TRACKED_ONLY=true ;;
    --local-copy)
      shift
      [ $# -gt 0 ] || usage
      LOCAL_COPY="$1"
      ;;
    -h | --help) usage ;;
    --*) echo "Unknown option $1" >&2; usage ;;
    *)
      [ -z "$REPO_URL" ] || usage
      REPO_URL="$1"
      ;;
  esac
  shift
done
if [ -z "$LOCAL_COPY" ] && [ -z "$REPO_URL" ]; then usage; fi
if [ -n "$LOCAL_COPY" ] && [ -n "$REPO_URL" ]; then echo "Give a repository URL or --local-copy, not both." >&2; exit 2; fi
if [ -n "$LOCAL_COPY" ] && [ ! -f "$LOCAL_COPY/package.json" ]; then echo "--local-copy: $LOCAL_COPY has no package.json." >&2; exit 2; fi
if [ "$TRACKED_ONLY" = true ] && [ -z "$LOCAL_COPY" ]; then echo "--tracked-only needs --local-copy." >&2; exit 2; fi
if [ "$TRACKED_ONLY" = true ] && ! git -C "$LOCAL_COPY" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "--tracked-only: $LOCAL_COPY is not a git work tree." >&2; exit 2; fi
if [ -n "$(ls -A "$WORK")" ]; then
  echo "Refusing to run: $WORK is not empty. Run this in a new, empty directory (mkdir /tmp/township-verify && cd /tmp/township-verify)." >&2
  exit 2
fi
for tool in node npm docker tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Refusing to run: '$tool' is not installed or not on PATH." >&2; exit 2; }
done
[ -n "$REPO_URL" ] && { command -v git >/dev/null 2>&1 || { echo "Refusing to run: 'git' is not installed." >&2; exit 2; }; }
docker compose version >/dev/null 2>&1 || { echo "Refusing to run: 'docker compose' (the plugin, version 2 or later) is not available." >&2; exit 2; }
mkdir -p "$LOGS"

# A value left in YOUR shell beats the value in .env, so a DATABASE_URL pointing at another database (a hosted one, say) would be migrated and seeded by this script.
# Everything that could redirect the run is removed for the whole run; the script sets its own DATABASE_URL for its own database container below.
unset DATABASE_URL LOGS_DATABASE_URL DEMO_AS_OF DEMO_MODE OTP_PEPPER PAYMENT_WEBHOOK_SECRET OPS_TEST_TOKEN SESSION_SECRET LLM_API_KEY DB_PORT IGNORE_DOTENV
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES
for name in $(compgen -v | grep -E '^(JEV_|NEXT_)'); do unset "$name"; done

# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# State kept for the table and the cleanup.
RESULTS=()
SERVER_PID=""
PROJECT=""
COMPOSE_STARTED=false
FAILED=false

port_free() { # exit 0 when nothing listens on the port
  node -e 'const s = require("net").createServer(); s.once("error", () => process.exit(1)); s.listen(Number(process.argv[1]), () => s.close(() => process.exit(0)));' "$1"
}
pick_port() { # a free port chosen by the operating system
  node -e 'const s = require("net").createServer().listen(0, () => { console.log(s.address().port); s.close(); })'
}
choose_port() { # name, requested -> prints the port; refuses clearly when a requested port is taken
  local name="$1" requested="$2"
  if [ -n "$requested" ]; then
    if port_free "$requested"; then echo "$requested"; return 0; fi
    echo "Port $requested ($name) is already in use. Stop whatever uses it or choose another port." >&2
    return 1
  fi
  pick_port
}

cleanup() {
  local status=$?
  set +e
  if [ -n "$SERVER_PID" ]; then
    kill -TERM -- "-$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$SERVER_PID" 2>/dev/null && kill -KILL -- "-$SERVER_PID" 2>/dev/null
  fi
  if [ "$COMPOSE_STARTED" = true ] && [ -d "$REPO" ]; then
    # Only this run's own project: its container and its volume.
    (cd "$REPO" && COMPOSE_PROJECT_NAME="$PROJECT" docker compose down -v >"$LOGS/compose-down.log" 2>&1)
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# step <name> <function>: runs the function with its output in logs/<n>.log; records PASS or FAIL with the seconds; after the first FAIL the rest are SKIP.
STEP_NO=0
step() {
  local name="$1" fn="$2"
  STEP_NO=$((STEP_NO + 1))
  if [ "$FAILED" = true ]; then RESULTS+=("$STEP_NO|$name|SKIP|-"); return 1; fi
  local log="$LOGS/$(printf '%02d' "$STEP_NO")-$fn.log" started=$SECONDS
  echo "[$STEP_NO] $name ..."
  if "$fn" >"$log" 2>&1; then
    RESULTS+=("$STEP_NO|$name|PASS|$((SECONDS - started))")
  else
    RESULTS+=("$STEP_NO|$name|FAIL|$((SECONDS - started))")
    FAILED=true
    echo "    FAILED. The last lines of $log:"
    tail -n 15 "$log" | sed 's/^/    | /'
    return 1
  fi
}
skip() { # skip <name> <why>
  STEP_NO=$((STEP_NO + 1))
  RESULTS+=("$STEP_NO|$1|SKIP|$2")
}

# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
s_get_code() {
  if [ -n "$LOCAL_COPY" ]; then
    mkdir -p "$REPO"
    if [ "$TRACKED_ONLY" = true ]; then
      git -C "$LOCAL_COPY" ls-files -z | while IFS= read -r -d '' file; do [ -e "$LOCAL_COPY/$file" ] && printf '%s\0' "$file"; done > "$LOGS/tracked-files.list"
      tar -C "$LOCAL_COPY" --null -T "$LOGS/tracked-files.list" -cf - | tar -C "$REPO" -xf -
      echo "copied the tracked files of $LOCAL_COPY"
    else
      tar -C "$LOCAL_COPY" --exclude=./node_modules --exclude=./.next --exclude=./.env --exclude=./.git --exclude=./test-results --exclude=./generated -cf - . | tar -C "$REPO" -xf -
      echo "copied $LOCAL_COPY"
    fi
  else
    git clone --quiet "$REPO_URL" "$REPO"
    echo "cloned"
  fi
  test -f "$REPO/package.json" && test -f "$REPO/.nvmrc" && test -f "$REPO/.env.example" && test -f "$REPO/docker-compose.yml"
  echo "package.json, .nvmrc, .env.example and docker-compose.yml are present"
}

s_node() {
  local want have want_major have_major
  want="$(tr -d 'v \n' <"$REPO/.nvmrc")"
  have="$(node -v | tr -d 'v \n')"
  want_major="${want%%.*}"
  have_major="${have%%.*}"
  echo ".nvmrc wants Node $want; this machine has $have"
  [ "$want_major" = "$have_major" ] || { echo "The major version differs: use Node $want_major (nvm use)."; return 1; }
  [ "$want" = "$have" ] || echo "note: the minor or patch version differs; the major version matches, which is what engines requires"
}

s_install() {
  cd "$REPO" || return 1
  npm ci --no-audit --no-fund
}

# TEST ONLY (--skip-install): the dependencies of the repository this script lives in, linked instead of installed.
s_link() {
  cd "$REPO" || return 1
  ln -s "$SCRIPT_REPO/node_modules" "$REPO/node_modules"
  npx --no-install prisma generate >/dev/null
  echo "node_modules linked from $SCRIPT_REPO; npm ci was NOT run"
}

s_env() {
  cd "$REPO" || return 1
  local lines
  # Written by node so that no secret appears in an argument list, a log or the screen.
  DB_PORT_VALUE="$DB_PORT" node -e '
    const fs = require("fs"), crypto = require("crypto");
    const secret = () => crypto.randomBytes(32).toString("hex");
    const set = { DB_PORT: process.env.DB_PORT_VALUE, OTP_PEPPER: secret(), PAYMENT_WEBHOOK_SECRET: secret(), DEMO_MODE: "true" };
    let text = fs.readFileSync(".env.example", "utf8");
    text = text.replace(/^(DATABASE_URL=postgresql:\/\/[^@]+@localhost:)\d+(\/.*)$/m, "$1" + set.DB_PORT + "$2");
    for (const [name, value] of Object.entries(set)) {
      const line = new RegExp("^" + name + "=.*$", "m");
      if (!line.test(text)) throw new Error(name + " is not in .env.example");
      text = text.replace(line, name + "=" + value);
    }
    fs.writeFileSync(".env", text, { mode: 0o600 });
  '
  # The one database this run may touch: the throwaway container on its own port (the same value .env holds).
  export DATABASE_URL="postgresql://township:township_local_only@localhost:$DB_PORT/township"
  # Counts and names only.
  lines="$(grep -c '' .env)"
  echo ".env written from .env.example ($lines lines): DB_PORT, the port in DATABASE_URL, OTP_PEPPER, PAYMENT_WEBHOOK_SECRET and DEMO_MODE set; secrets are 64 random hex characters and are not shown"
  grep -q '^DEMO_AS_OF=' .env && { echo "DEMO_AS_OF is set in .env; it must stay unset"; return 1; }
  return 0
}

s_database() {
  cd "$REPO" || return 1
  export COMPOSE_PROJECT_NAME="$PROJECT" DB_PORT
  COMPOSE_STARTED=true
  docker compose up -d db
  local container health="" tries=0
  container="$(docker compose ps -q db)"
  [ -n "$container" ] || { echo "the database container did not start"; return 1; }
  while [ "$tries" -lt 90 ]; do
    health="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null)"
    [ "$health" = "healthy" ] && break
    tries=$((tries + 1))
    sleep 1
  done
  echo "database container health: $health (project $PROJECT, host port $DB_PORT)"
  [ "$health" = "healthy" ]
}

s_migrate() {
  cd "$REPO" || return 1
  npx prisma migrate deploy
  npx prisma migrate status
}

s_seed() {
  cd "$REPO" || return 1
  npm run db:seed -- --yes
}

s_build() {
  cd "$REPO" || return 1
  npm run build
}

s_start() {
  cd "$REPO" || return 1
  # setsid gives the server its own process group, so stopping its PID stops next-server too.
  setsid node_modules/.bin/next start -p "$APP_PORT" >"$LOGS/server.log" 2>&1 &
  SERVER_PID=$!
  local tries=0
  while [ "$tries" -lt 60 ]; do
    if node -e 'fetch(process.argv[1]).then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))' "http://localhost:$APP_PORT/api/health"; then
      echo "the app answers on http://localhost:$APP_PORT (PID $SERVER_PID); its log is $LOGS/server.log and is never printed"
      return 0
    fi
    kill -0 "$SERVER_PID" 2>/dev/null || { echo "the server stopped"; return 1; }
    tries=$((tries + 1))
    sleep 1
  done
  echo "the app did not answer within 60 seconds"
  return 1
}

# The server connects as the database owner of the throwaway container, so the readiness report has the owner's failures; --allow-owner-role (localhost only) accepts exactly those.
s_smoke_resident() {
  cd "$REPO" || return 1
  npm run smoke:auth -- "http://localhost:$APP_PORT" 5000000006 --allow-owner-role
}
s_smoke_staff() {
  cd "$REPO" || return 1
  npm run smoke:auth -- "http://localhost:$APP_PORT" 5000000001 --allow-owner-role
}

s_parity() {
  cd "$REPO" || return 1
  DATABASE_URL="postgresql://township:township_local_only@localhost:$DB_PORT/township" npm run test:ci-parity
}

# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
DB_PORT="$(choose_port "the database" "${VCC_DB_PORT:-}")" || exit 2
APP_PORT="$(choose_port "the app" "${VCC_APP_PORT:-}")" || exit 2
[ "$DB_PORT" != "$APP_PORT" ] || { echo "The database and app ports are the same." >&2; exit 2; }
PROJECT="township-vcc-$(date +%s)-$$"
echo "Work directory: $WORK"
echo "Compose project: $PROJECT, database host port $DB_PORT, app port $APP_PORT"

step "get the code (clone or copy)" s_get_code
step "Node matches .nvmrc" s_node
if [ "$SKIP_INSTALL" = true ]; then
  skip "npm ci" "NOT RUN (--skip-install, test only)"
  step "link node_modules and generate the client (test only)" s_link
else
  step "npm ci" s_install
fi
step "write .env with fresh secrets" s_env
step "start the database (own container)" s_database
step "prisma migrate deploy" s_migrate
step "seed the demo data" s_seed
step "next build" s_build
step "start the app" s_start
step "smoke:auth, a resident (5000000006)" s_smoke_resident
step "smoke:auth, a staff member (5000000001)" s_smoke_staff
if [ "$QUICK" = true ]; then skip "test:ci-parity" "--quick"; else step "test:ci-parity (unit and integration)" s_parity; fi

echo
echo "RESULT TABLE"
printf '%-4s %-62s %-6s %s\n' "No" "Step" "Result" "Seconds"
FAILS=0
for row in "${RESULTS[@]}"; do
  IFS='|' read -r no name result seconds <<<"$row"
  printf '%-4s %-62s %-6s %s\n' "$no" "$name" "$result" "$seconds"
  [ "$result" = "FAIL" ] && FAILS=$((FAILS + 1))
done
echo
echo "Logs: $LOGS (the server log is there too; nothing in this output is a secret)."
if [ "$FAILS" -gt 0 ]; then echo "OVERALL: FAIL ($FAILS step failed)"; exit 1; fi
if [ "$SKIP_INSTALL" = true ]; then echo "OVERALL: PASS, but npm ci was not run (--skip-install is for testing this script only)"; exit 0; fi
echo "OVERALL: PASS"
