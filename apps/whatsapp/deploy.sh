#!/usr/bin/env bash
# Deploy this repo to the VPS and restart the Baileys bridge container.
#
# Usage:    ./deploy.sh
# Override: SSH_TARGET=root@<host> REMOTE_PATH=/root/<dir> ./deploy.sh
#
# Mirrors nuraview-scraper/deploy.sh — see that file's header for the
# rationale. Differences here:
#   - excludes auth/ (Baileys pairing creds — losing this means re-scan QR)
#   - excludes node_modules/ and dist/ (rebuilt inside the Docker image)

set -euo pipefail

SSH_TARGET="${SSH_TARGET:-root@185.245.182.175}"
REMOTE_PATH="${REMOTE_PATH:-/root/nuraview-whatsapp}"
CONTAINER="${CONTAINER:-nuraview-whatsapp}"

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree has uncommitted changes. Commit first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_SHA=$(git rev-parse --short HEAD)
CURRENT_MSG=$(git log -1 --format='%s')
echo "→ Deploying $CURRENT_SHA to $SSH_TARGET:$REMOTE_PATH"
echo "  Subject: $CURRENT_MSG"

# Auth state under auth/ MUST survive deploys — losing it means re-pairing
# via QR scan. Same for the .env (server-side secrets) and logs/.
rsync -azP \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='auth/' \
  --exclude='logs/' \
  --delete \
  ./ "$SSH_TARGET:$REMOTE_PATH/"

echo "→ Rebuilding & restarting $CONTAINER"
ssh "$SSH_TARGET" "cd $REMOTE_PATH && docker compose up -d --build" 2>&1 | tail -10

echo "→ Tailing $CONTAINER logs (30s)..."
ssh "$SSH_TARGET" "docker logs $CONTAINER --since 30s --follow 2>&1" &
LOG_PID=$!
sleep 30
kill $LOG_PID 2>/dev/null || true
wait $LOG_PID 2>/dev/null || true

echo "✓ Deployed $CURRENT_SHA — to roll back: git checkout HEAD~1 && ./deploy.sh"
