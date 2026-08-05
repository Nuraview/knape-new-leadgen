#!/usr/bin/env bash
# NV CRM database backup via pg_dump (Dockerized postgres:17 client).
#
# Reads DATABASE_URL_UNPOOLED (fallback DATABASE_URL) from .env / .env.local
# WITHOUT sourcing the file — the Neon URL contains '&' which breaks `source`
# and `export $(cat .env | xargs)`. Writes a timestamped dump to ./backups/
# (gitignored — contains data + credentials).
#
# Requires Docker. Under WSL this uses the Windows docker.exe; on native Linux
# run with `DOCKER=docker bun run db:backup`.
set -u

cd "$(dirname "$0")/.." || exit 1   # -> apps/web

DOCKER="${DOCKER:-docker.exe}"

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

mkdir -p backups
OUT="backups/nvcrm_$(date +%Y%m%d_%H%M%S).sql"
echo "Backing up NV CRM database -> $OUT"

"$DOCKER" run --rm -e PGURL="$URL" postgres:17 \
  sh -c 'pg_dump "$PGURL" --no-owner --no-acl --clean' > "$OUT"

if [ -s "$OUT" ]; then
  echo "Backup complete: $(du -h "$OUT" | cut -f1)  $OUT"
else
  echo "Backup FAILED — output empty. Removing $OUT" >&2
  rm -f "$OUT"
  exit 1
fi
