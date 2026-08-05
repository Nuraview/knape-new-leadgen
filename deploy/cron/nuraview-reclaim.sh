#!/bin/sh
# Keep only the N newest SHA-tagged images per repo, plus whatever is running.
# Age-based pruning cannot cope with 8 deploys in a day.
set -eu
KEEP=${1:-2}

in_use() {
  docker ps -a --format '{{.Image}}' | sort -u
}

for repo in ghcr.io/nuraview/nv-crm-api ghcr.io/nuraview/nv-crm-app; do
  echo "--- $repo"
  # Newest first; skip :latest and anything a container references.
  docker images "$repo" --format '{{.ID}} {{.Repository}}:{{.Tag}}' \
    | grep -v ':latest$' \
    | awk -v keep="$KEEP" 'NR>keep {print $2}' > /tmp/nv-rm.list
  while read -r ref; do
    [ -n "$ref" ] || continue
    if in_use | grep -qxF "$ref"; then
      echo "  keep (running): $ref"
      continue
    fi
    docker rmi "$ref" >/dev/null 2>&1 && echo "  removed $ref" || echo "  skip $ref"
  done < /tmp/nv-rm.list
done

echo "=== build caches (builds run in CI now, not here) ==="
rm -rf /root/.bun/install/cache 2>/dev/null || true
rm -rf /root/.cache/puppeteer /root/.cache/ms-playwright /root/.cache/bun 2>/dev/null || true

docker image prune -af --filter "until=6h" >/dev/null 2>&1 || true
df -h / | tail -1
