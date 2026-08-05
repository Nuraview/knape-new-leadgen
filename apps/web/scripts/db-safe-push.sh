#!/usr/bin/env bash
# Backup-gated `drizzle-kit push`.
#
# WHY: on this project's live Neon DB, `drizzle-kit push` proposes DESTRUCTIVE
# statements even for a tiny additive change — the FK/index NAMES in the DB
# (Postgres/Prisma-era `_fkey`, plus indexes that only exist in the DB) drift
# from what drizzle's schema generates (`_fk`). So push wants to DROP + rename
# constraints and DROP indexes (e.g. crm_Leads_phone_digits_idx) that it does
# NOT always recreate. A stray "Yes" would delete production indexes/FKs.
#
# This wrapper takes a fresh backup FIRST, then runs push so you can review the
# plan and abort. For a purely additive change (new nullable column/index),
# prefer applying the exact DDL surgically instead of push — see README/memory.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> apps/web

echo "▶ push on this DB is destructive due to FK/index name drift — backing up first…"
bash scripts/db-backup.sh

cat <<'WARN'

⚠  REVIEW THE PUSH PLAN CAREFULLY.
   If it lists any DROP CONSTRAINT / DROP INDEX you did not intend, choose
   "No, abort". Those are drift, not your change. A backup was just taken.

WARN

exec npx drizzle-kit push "$@"
