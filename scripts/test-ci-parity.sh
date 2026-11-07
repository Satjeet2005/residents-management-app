#!/bin/sh
# Runs the unit and the integration tests the way CI does: no .env, and nothing in the environment but DATABASE_URL
# (and PATH, HOME, NODE_OPTIONS so that node and npm start). A test that passes only with a developer's .env fails here.
# DATABASE_URL: the one given to this script, else the local development value of .env.example.
set -e
cd "$(dirname "$0")/.."
URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' .env.example)}"
run() {
  env -i PATH="$PATH" HOME="$HOME" NODE_OPTIONS="${NODE_OPTIONS:-}" IGNORE_DOTENV=true DATABASE_URL="$URL" npm run "$1"
}
run test:unit
run test:integration
