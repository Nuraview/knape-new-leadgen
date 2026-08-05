#!/bin/bash
# One-shot enablement for proposals.nuraview.com + invoices.nuraview.com.
#
# Run ON THE VPS, AFTER the two Cloudflare A records point at this box:
#   proposals.nuraview.com  A  185.245.182.175   (remove the Vercel CNAME first)
#   invoices.nuraview.com    A  185.245.182.175
#
# The vhost ships disabled (.conf.off) because its 443 block references a
# certificate that does not exist until certbot has run — enabling it earlier
# would take nginx down for every site on the box.
set -euo pipefail

VHOST_DIR=/www/server/panel/vhost/nginx
SRC="$VHOST_DIR/proposals.nuraview.com.conf.off"
DST="$VHOST_DIR/proposals.nuraview.com.conf"

for host in proposals.nuraview.com invoices.nuraview.com; do
  ip=$(dig +short "$host" A | tail -1)
  if [ "$ip" != "185.245.182.175" ]; then
    echo "ABORT: $host resolves to '${ip:-nothing}', not this box. Fix DNS first." >&2
    exit 1
  fi
done

[ -f "$SRC" ] || [ -f "$DST" ] || { echo "ABORT: vhost file missing — deploy first." >&2; exit 1; }

NG=/www/server/nginx/sbin/nginx
certbot certonly --webroot -w /www/wwwroot/crmx1_acme \
  -d proposals.nuraview.com -d invoices.nuraview.com \
  --cert-name proposals.nuraview.com \
  --non-interactive --agree-tos -m info@nuraview.com

[ -f "$SRC" ] && mv "$SRC" "$DST"
$NG -t && $NG -s reload
echo "OK: both hosts live."
curl -s -o /dev/null -w "proposals: %{http_code}\n" https://proposals.nuraview.com/
curl -s -o /dev/null -w "invoice:   %{http_code}\n" https://invoices.nuraview.com/
