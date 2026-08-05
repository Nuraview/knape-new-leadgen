#!/usr/bin/env bash
# Pushes the dialer's Twilio/VAPID env vars from apps/web/.env to the Vercel
# production environment, then redeploys. Run manually from apps/web:
#   bash scripts/push-dialer-env.sh
set -uo pipefail

cd "$(dirname "$0")/.."

NAMES=(
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_API_KEY
  TWILIO_API_SECRET
  TWIML_APP_SID
  TWILIO_PHONE_NUMBER
  VAPID_PUBLIC_KEY
  VAPID_PRIVATE_KEY
  VAPID_SUBJECT
  NEXT_PUBLIC_VAPID_PUBLIC_KEY
  DIALER_PUBLIC_BASE_URL
  DIALER_MISSED_CALL_SMS
)

for name in "${NAMES[@]}"; do
  value=$(grep "^${name}=" .env | head -1 | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "SKIP $name (not found in .env)"
    continue
  fi
  if printf '%s' "$value" | vercel env add "$name" production >/dev/null 2>&1; then
    echo "OK   $name (production)"
  else
    echo "FAIL $name (production) — may already exist; remove with: vercel env rm $name production"
  fi
  if printf '%s' "$value" | vercel env add "$name" preview >/dev/null 2>&1; then
    echo "OK   $name (preview)"
  else
    echo "FAIL $name (preview)"
  fi
done

echo
echo "Redeploying production…"
vercel redeploy nv-crm-nine.vercel.app --prod
