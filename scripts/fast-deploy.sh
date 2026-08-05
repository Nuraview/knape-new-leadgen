#!/usr/bin/env bash
#
# Deploy to production in seconds instead of minutes.
#
# CI (.github/workflows/deploy-nuraview.yml) takes ~4 minutes for an API change:
# a typecheck gate the deploy waits on, a Docker image build, a registry push, a
# pull on the VPS and a container recreate. Almost none of that moves the code —
# the API image runs `node dist/index.js`, one esbuild bundle that rebuilds
# locally in about 60ms. Shipping that file and restarting the container is the
# same deploy, ~10x faster.
#
#   scripts/fast-deploy.sh          # decide from what changed
#   scripts/fast-deploy.sh api      # backend only
#   scripts/fast-deploy.sh app      # frontend only
#   scripts/fast-deploy.sh both
#
# WHAT THIS DOES NOT DO, deliberately:
#
#   - It does not typecheck. CI still does, on the push that follows. If the
#     gate goes red, the fix is another 20-second deploy.
#   - It does not build a Docker image, so `docker inspect` still names the last
#     CI image while the container runs newer code. .fast-deploy-sha inside the
#     container records what is really running, and the next CI deploy overwrites
#     the hot-patched file with an identical build from the same commit.
#   - It refuses anything that changes the dependency graph (bun.lock, a
#     package.json, the Dockerfile). node_modules lives in the image; a bundle
#     that imports something not installed there fails at require time, and the
#     container would restart-loop. Those changes go through CI.
#
# ALWAYS COMMIT AND PUSH AFTERWARDS. The hot patch lives in the container's
# writable layer and does not survive a recreate — the push is what makes it
# permanent, and what gets the typecheck gate to look at it.
set -euo pipefail

VPS="root@${VPS_HOST:-185.245.182.175}"
API_CONTAINER=nuraview-api
SPA_DIR=/www/wwwroot/nuraview-spa
REMOTE_DIR=/root/nuraview-app
HEALTH_URL=https://crmx1.nuraview.com/api/health
APP_URL=https://crmx1.nuraview.com
SSH=(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$VPS")

cd "$(dirname "$0")/.."
START=$SECONDS
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- what changed

# The commit the box is actually running: the marker a previous fast deploy
# left, else the SHA tag of the image CI last pulled.
deployed_sha() {
  local marker image
  marker=$("${SSH[@]}" "docker exec $API_CONTAINER cat /app/.fast-deploy-sha 2>/dev/null" 2>/dev/null || true)
  if [ -n "$marker" ] && git cat-file -e "${marker}^{commit}" 2>/dev/null; then
    echo "$marker"; return
  fi
  image=$("${SSH[@]}" "docker inspect --format '{{.Config.Image}}' $API_CONTAINER 2>/dev/null" 2>/dev/null || true)
  image=${image##*:}
  if [ -n "$image" ] && git cat-file -e "${image}^{commit}" 2>/dev/null; then
    echo "$image"
  fi
}

changed_files() {
  local base="$1"
  # Committed since the box's commit, plus whatever is still in the tree.
  { [ -n "$base" ] && git diff --name-only "$base" HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard; } | sort -u
}

TARGET="${1:-auto}"
CHANGED=""
if [ "$TARGET" = "auto" ]; then
  BASE=$(deployed_sha || true)
  [ -n "$BASE" ] || fail "cannot tell what is deployed — pass api, app or both explicitly"
  CHANGED=$(changed_files "$BASE")
  [ -n "$CHANGED" ] || { echo "nothing changed since ${BASE:0:8} — nothing to deploy"; exit 0; }
  api=$(grep -cE '^(apps/api/|packages/|i18n/)' <<<"$CHANGED" || true)
  app=$(grep -cE '^apps/app/' <<<"$CHANGED" || true)
  if   [ "$api" -gt 0 ] && [ "$app" -gt 0 ]; then TARGET=both
  elif [ "$api" -gt 0 ]; then TARGET=api
  elif [ "$app" -gt 0 ]; then TARGET=app
  else echo "changes touch neither app — nothing to deploy"; exit 0; fi
  echo "since ${BASE:0:8}: $(wc -l <<<"$CHANGED") file(s) → $TARGET"
fi

# A dependency change needs the image rebuilt; the bundle alone cannot carry it.
if [ -n "$CHANGED" ] && grep -qE '^(bun\.lock|deploy/package\.api\.json|apps/api/package\.json|apps/app/package\.json|packages/[^/]+/package\.json|apps/api/Dockerfile)' <<<"$CHANGED"; then
  fail "dependency graph changed — push and let CI rebuild the image:
      git push   # then watch: gh run list --workflow deploy-nuraview.yml --limit 1"
fi

# ------------------------------------------------------------------------ api

deploy_api() {
  say "building API bundle"
  if [ -n "$CHANGED" ] && grep -q '^packages/permissions/' <<<"$CHANGED"; then
    bun run --filter @nuraview/permissions build >/dev/null
    rsync -az packages/permissions/dist/ "$VPS:$REMOTE_DIR/packages/permissions/dist/"
    "${SSH[@]}" "docker cp $REMOTE_DIR/packages/permissions/dist $API_CONTAINER:/app/packages/permissions/ >/dev/null"
  fi
  (cd apps/api && bun run build >/dev/null)
  [ -s apps/api/dist/index.js ] || fail "esbuild produced no bundle"

  # Migrations are read from disk at boot (migrationsFolder is <entry>/../drizzle),
  # so a new migration has to travel with the bundle or it silently never runs.
  if [ -n "$CHANGED" ] && grep -q '^apps/api/drizzle/' <<<"$CHANGED"; then
    say "shipping migrations"
    rsync -az apps/api/drizzle/ "$VPS:$REMOTE_DIR/apps/api/drizzle/"
    "${SSH[@]}" "docker cp $REMOTE_DIR/apps/api/drizzle $API_CONTAINER:/app/apps/api/ >/dev/null"
  fi

  say "shipping bundle ($(du -h apps/api/dist/index.js | cut -f1))"
  "${SSH[@]}" "docker exec -i $API_CONTAINER sh -c 'cat > /app/apps/api/dist/index.js.new'" \
    < apps/api/dist/index.js

  # Swap and restart. The previous bundle stays as .prev so a bad deploy is one
  # move away from being undone, without a registry round trip.
  "${SSH[@]}" "docker exec $API_CONTAINER sh -c '
      cd /app/apps/api/dist &&
      cp -f index.js index.js.prev 2>/dev/null || true &&
      mv index.js.new index.js' &&
    docker restart $API_CONTAINER >/dev/null"

  say "waiting for health"
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$HEALTH_URL" || echo 000)
    [ "$code" = "200" ] && { echo "healthy after ${i} attempt(s)"; return 0; }
    sleep 2
  done

  printf '\033[31m✗ unhealthy — rolling back to the previous bundle\033[0m\n' >&2
  "${SSH[@]}" "docker exec $API_CONTAINER sh -c '
      cd /app/apps/api/dist && test -f index.js.prev && mv index.js.prev index.js' &&
    docker restart $API_CONTAINER >/dev/null"
  fail "rolled back; the API is on the previous bundle"
}

# ------------------------------------------------------------------------ app

# CI builds the SPA from a fresh checkout, so it has NO .env files at all and
# every VITE_* is undefined — which is what makes the bundle same-origin and
# lets one build serve crmx1 and crmx2. A developer machine has .env.local, and
# vite loads it for production builds too: VITE_APP_URL and VITE_CLIENT_URL are
# localhost:5173 there, and .env.production does not override them. Building
# here without hiding them ships a bundle whose sign-in redirects and generated
# links point at the developer's own machine.
restore_env_files() {
  local hidden
  for hidden in apps/app/.env*.fastdeploy-hidden; do
    [ -e "$hidden" ] && mv "$hidden" "${hidden%.fastdeploy-hidden}"
  done
  return 0
}

deploy_app() {
  say "building SPA (this is the slow half — vite, ~70s)"
  local f
  for f in apps/app/.env apps/app/.env.local apps/app/.env.development \
           apps/app/.env.production apps/app/.env.production.local; do
    [ -f "$f" ] && mv "$f" "$f.fastdeploy-hidden"
  done
  trap restore_env_files EXIT
  (cd apps/app && bun run build >/dev/null)
  restore_env_files
  trap - EXIT
  [ -f apps/app/dist/index.html ] || fail "vite produced no dist/index.html"

  # Belt and braces: if a local URL reached the bundle anyway, do not ship it.
  if grep -rqE 'localhost:(5173|1337)' apps/app/dist/assets/ 2>/dev/null; then
    fail "the built bundle contains a localhost URL — refusing to ship it"
  fi

  say "syncing dist to the nginx bind mount"
  "${SSH[@]}" "tar -czf $SPA_DIR-prev.tar.gz -C $SPA_DIR . || true"

  # Order matters, and it is the same order CI uses. Assets go first and
  # additively so index.html can never name a chunk that is not on disk yet, and
  # old chunks are never deleted here — a tab still running the previous build
  # lazy-loads them until use-deploy-reload.ts moves it over.
  rsync -az apps/app/dist/assets/ "$VPS:$SPA_DIR/assets/"
  rsync -az --delete --delay-updates --exclude 'assets/***' \
    apps/app/dist/ "$VPS:$SPA_DIR/"
  "${SSH[@]}" "find $SPA_DIR/assets -type f -mtime +7 -delete || true"

  say "verifying the served bundle"
  expected=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' apps/app/dist/index.html | head -1)
  served=$(curl -s --max-time 15 "$APP_URL/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
  [ "$expected" = "$served" ] || fail "served $served, expected $expected"
  echo "serving $served"
}

case "$TARGET" in
  api)  deploy_api ;;
  app)  deploy_app ;;
  both) deploy_api; deploy_app ;;
  *)    fail "usage: $0 [api|app|both]" ;;
esac

# Record what is really running, so the next auto run can diff against it.
if [ "$TARGET" != "app" ]; then
  "${SSH[@]}" "docker exec $API_CONTAINER sh -c 'echo $(git rev-parse HEAD) > /app/.fast-deploy-sha'"
fi

printf '\n\033[32m✓ deployed in %ds\033[0m — now commit and push so it survives the next recreate\n' \
  "$((SECONDS - START))"
