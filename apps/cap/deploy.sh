#!/usr/bin/env bash
# Deploy the self-hosted Cap stack (Loom replacement) to the VPS.
#
# Usage:    ./deploy.sh
# Override: SSH_TARGET=root@<host> REMOTE_PATH=/root/<dir> ./deploy.sh
#
# What it does:
#   1. Refuses to deploy with uncommitted changes in apps/cap (revert-by-SHA).
#   2. rsyncs apps/cap to $REMOTE_PATH, EXCLUDING .env (server-side secret).
#      First run: copy .env.example to /root/nuraview-cap/.env on the VPS and
#      fill secrets (openssl rand -hex 32 each) before running this script.
#   3. Installs nginx vhosts into the aaPanel nginx. For any domain that has
#      no Let's Encrypt cert yet, installs an HTTP-only bootstrap vhost,
#      obtains the cert via webroot, then installs the full vhost.
#   4. docker compose pull && up -d, then shows container status.
#
# DNS prerequisites (A records -> 185.245.182.175):
#   cap.nuraview.com, capstore.nuraview.com

set -euo pipefail

SSH_TARGET="${SSH_TARGET:-root@185.245.182.175}"
REMOTE_PATH="${REMOTE_PATH:-/root/nuraview-cap}"
NGINX_BIN="/www/server/nginx/sbin/nginx"
VHOST_DIR="/www/server/panel/vhost/nginx"
DOMAINS=("cap.nuraview.com" "capstore.nuraview.com")
ACME_ROOTS=("/www/wwwroot/cap_acme" "/www/wwwroot/capstore_acme")

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain .)" ]; then
  echo "✗ apps/cap has uncommitted changes. Commit first." >&2
  git status --short . >&2
  exit 1
fi

CURRENT_SHA=$(git rev-parse --short HEAD)
echo "→ Deploying apps/cap @ $CURRENT_SHA to $SSH_TARGET:$REMOTE_PATH"

rsync -azP \
  --exclude='.env' \
  --delete \
  ./ "$SSH_TARGET:$REMOTE_PATH/"

# .env must exist server-side before compose can start.
if ! ssh "$SSH_TARGET" "test -f $REMOTE_PATH/.env"; then
  echo "✗ $REMOTE_PATH/.env missing on VPS. Create it from .env.example first." >&2
  exit 1
fi

echo "→ nginx vhosts + certs"
for i in "${!DOMAINS[@]}"; do
  domain="${DOMAINS[$i]}"
  acme_root="${ACME_ROOTS[$i]}"
  ssh "$SSH_TARGET" bash -s -- "$domain" "$acme_root" "$REMOTE_PATH" "$VHOST_DIR" "$NGINX_BIN" <<'EOS'
set -euo pipefail
domain="$1"; acme_root="$2"; remote_path="$3"; vhost_dir="$4"; nginx_bin="$5"
mkdir -p "$acme_root"
if [ ! -d "/etc/letsencrypt/live/$domain" ]; then
  # Bootstrap: HTTP-only vhost so certbot webroot can answer the challenge.
  cat > "$vhost_dir/$domain.conf" <<EOF
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $acme_root; default_type "text/plain"; }
    location / { return 404; }
}
EOF
  "$nginx_bin" -t && "$nginx_bin" -s reload
  certbot certonly --webroot -w "$acme_root" -d "$domain" \
    --non-interactive --agree-tos --keep-until-expiring \
    -m clynecta@gmail.com
fi
cp "$remote_path/nginx/$domain.conf" "$vhost_dir/$domain.conf"
"$nginx_bin" -t && "$nginx_bin" -s reload
echo "✓ $domain vhost live"
EOS
done

echo "→ Starting Cap stack"
ssh "$SSH_TARGET" "cd $REMOTE_PATH && docker compose pull -q && docker compose up -d" 2>&1 | tail -10
ssh "$SSH_TARGET" "cd $REMOTE_PATH && docker compose ps"

echo "✓ Deployed. Smoke tests:"
echo "  1. open https://cap.nuraview.com — sign up (magic link via Resend, or: docker logs cap-web | grep -i login)"
echo "  2. record a test video in the browser"
echo "  3. open the /s/<id> share link in incognito — must play"
echo "  4. curl -sI 'https://cap.nuraview.com/api/video/preview?videoId=<id>' — expect 302 to capstore GIF"
