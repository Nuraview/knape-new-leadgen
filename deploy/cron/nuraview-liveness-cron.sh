#!/bin/sh
#
# Liveness alarm. Deployed to /usr/local/bin/nuraview-liveness-cron.sh and run
# from the VPS crontab every 15 minutes:
#
#   */15 * * * * /usr/local/bin/nuraview-liveness-cron.sh
#
# WHY THIS EXISTS: lead enrichment was dead for two days (2026-07-28/29) with a
# warning logged on every dropped event. Nobody reads container logs. This turns
# the same condition into a WhatsApp message on the number the owner already
# receives lead reminders on — no new channel, no new credential.
#
# ALERTING RULES, chosen so the channel does not get muted:
#   - alert on the TRANSITION into failure, not every tick
#   - re-alert every 6h while still failing, so a long outage is not forgotten
#   - send exactly one RECOVERED message on the way back
# A channel that pings every 15 minutes gets silenced within a day, and then it
# is worse than having no alarm at all.
set -eu

HOST="https://crmx1.nuraview.com"
SECRET_FILE=/root/.crm-cron-secret
STATE_DIR=/var/lib/nuraview
STATE="$STATE_DIR/liveness.state"
LOG=/var/log/nuraview-liveness.log
REALERT_SECONDS=21600 # 6h

mkdir -p "$STATE_DIR"
SECRET=$(cat "$SECRET_FILE")

BODY=$(curl -sS -m 30 "$HOST/api/cron/liveness?secret=$SECRET" || echo '{"ok":false,"checks":[]}')

# No jq on this box — pull the top-level ok flag and the failing check names
# with grep/sed. The endpoint's shape is fixed by cron/liveness.ts.
if printf '%s' "$BODY" | grep -q '"ok":true'; then
  NOW_OK=1
else
  NOW_OK=0
fi

FAILING=$(printf '%s' "$BODY" \
  | tr ',' '\n' \
  | grep -B0 '"name"' \
  | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' \
  | tr '\n' ' ')

PREV_OK=1
PREV_ALERT_AT=0
if [ -f "$STATE" ]; then
  # shellcheck disable=SC1090
  . "$STATE"
fi

NOW=$(date -u +%s)
SEND=""

if [ "$NOW_OK" -eq 0 ]; then
  if [ "$PREV_OK" -eq 1 ]; then
    SEND="NuraView ALERT: $(printf '%s' "$BODY" | sed -n 's/.*"detail":"\([^"]*\)".*/\1/p' | head -1)"
  elif [ $((NOW - PREV_ALERT_AT)) -ge "$REALERT_SECONDS" ]; then
    SEND="NuraView STILL FAILING (checks: $FAILING)"
  fi
elif [ "$PREV_OK" -eq 0 ]; then
  SEND="NuraView RECOVERED: all liveness checks passing again."
fi

if [ -n "$SEND" ]; then
  # whatsapp_outbox is INSERT-and-forget; the bridge drains it. Deliberately
  # not the API's /whatsapp/send — this alarm must still fire when the API is
  # the thing that is broken.
  RECIP=$(sed -n 's/^WHATSAPP_RECIPIENTS=//p' /root/nuraview-app/.env \
    | tr -d '"' | tr ',' '\n' | sed -n 's/.*://p' | head -1)
  if [ -n "$RECIP" ]; then
    # Columns verified against information_schema: to_jid / body, and status
    # defaults to 'pending' which is what the bridge polls for.
    printf '%s\n' "INSERT INTO whatsapp_outbox (to_jid, body)
      VALUES ('${RECIP#+}@s.whatsapp.net', \$msg\$${SEND}\$msg\$);" \
      | docker exec -i nuraview-crm-pg sh -c 'psql -U $POSTGRES_USER -d nuracrm -tA' \
      >/dev/null 2>&1 || echo "alert insert failed" >> "$LOG"
  fi
  PREV_ALERT_AT=$NOW
fi

printf 'PREV_OK=%s\nPREV_ALERT_AT=%s\n' "$NOW_OK" "$PREV_ALERT_AT" > "$STATE"

{
  echo "--- $(date -u +%FT%TZ) ok=$NOW_OK ${SEND:+sent=\"$SEND\"}"
  printf '%s\n' "$BODY"
} >> "$LOG"
