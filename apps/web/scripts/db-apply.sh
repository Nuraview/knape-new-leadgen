#!/usr/bin/env bash
# Apply a single SQL file to the NV CRM database (Dockerized psql:17).
#
# Use for ADDITIVE schema changes when `drizzle-kit migrate` can't be used —
# this DB's __drizzle_migrations tracking is out of sync with the journal, so
# `db:migrate` re-applies already-present migrations and fails. Marketing /
# dialer / proposal schema is therefore applied directly via this script.
#
# Reads DATABASE_URL_UNPOOLED (fallback DATABASE_URL) from .env / .env.local
# without sourcing (URL contains '&'). ON_ERROR_STOP aborts on first failure.
#
#   bun run db:apply drizzle/0015_clever_texas_twister.sql
#   bun run db:apply drizzle/marketing_provider_ab.sql
set -u

cd "$(dirname "$0")/.." || exit 1   # -> apps/web

DOCKER="${DOCKER:-docker.exe}"
SQL="${1:-}"
if [ -z "$SQL" ]; then
  echo "usage: bun run db:apply <path-to-sql-file>" >&2
  exit 1
fi
if [ ! -f "$SQL" ]; then
  echo "SQL file not found: $SQL" >&2
  exit 1
fi

extract() {
  grep -hE "^$1=" .env .env.local 2>/dev/null | head -1 \
    | sed -E 's/^[^=]+=//; s/^["'\'']//; s/["'\'']$//'
}
URL="$(extract DATABASE_URL_UNPOOLED)"
[ -z "$URL" ] && URL="$(extract DATABASE_URL)"
if [ -z "$URL" ]; then
  echo "No DATABASE_URL_UNPOOLED / DATABASE_URL found in .env or .env.local" >&2
  exit 1
fi

echo "Applying $SQL to NV CRM database (ON_ERROR_STOP=1)..."
if ! "$DOCKER" run --rm -i -e PGURL="$URL" postgres:17 \
  psql "$URL" -v ON_ERROR_STOP=1 -1 < "$SQL"; then
  echo "Apply FAILED (is Docker running?). No-Docker alternative: bun run db:apply:pg $SQL" >&2
  exit 1
fi
echo "Done: $SQL"
