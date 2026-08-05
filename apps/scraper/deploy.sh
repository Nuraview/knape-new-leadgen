#!/usr/bin/env bash
# Deploy this repo to the VPS and restart the container.
#
# Usage:    ./deploy.sh
# Override: SSH_TARGET=root@<host> REMOTE_PATH=/root/<dir> ./deploy.sh
#
# Requirements: rsync, ssh key already trusted by VPS, working tree clean.
#
# What it does:
#   1. Refuses to deploy if there are uncommitted changes (everything that
#      reaches the VPS must be in git so we can revert by SHA).
#   2. rsyncs the repo to $REMOTE_PATH, EXCLUDING .env, cookies.json, logs,
#      and .git — those are server-side state we never overwrite.
#   3. ssh to VPS, `docker compose up -d --build` to rebuild & restart.
#   4. Tails 30s of fresh logs so you see startup state before exiting.
#
# Rollback: git checkout <prev-sha>; ./deploy.sh

set -euo pipefail

SSH_TARGET="${SSH_TARGET:-root@185.245.182.175}"
REMOTE_PATH="${REMOTE_PATH:-/root/nuraview-scraper}"
CONTAINER="${CONTAINER:-nuraview-scraper}"

cd "$(dirname "$0")"

# Pre-flight: every deploy must be a committed git state.
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree has uncommitted changes. Commit first." >&2
  git status --short >&2
  exit 1
fi

CURRENT_SHA=$(git rev-parse --short HEAD)
CURRENT_MSG=$(git log -1 --format='%s')
echo "→ Deploying $CURRENT_SHA to $SSH_TARGET:$REMOTE_PATH"
echo "  Subject: $CURRENT_MSG"

# Rsync code only. Server-side .env, cookies.json, and logs/ are sacred —
# excluding them keeps the live session and uploaded creds intact across
# deploys. --delete prunes files that no longer exist locally (so removing
# a file via git actually removes it on the VPS); the EXCLUDED files are
# NOT deleted (rsync's default for excluded paths).
rsync -azP \
  --exclude='.git/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='cookies.json' \
  --exclude='logs/' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
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
