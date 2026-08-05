#!/bin/bash
# Guards / on the VPS against filling up. Motivated by the 2026-07-31 outage:
# /tmp flooded with orphan .so files until the disk hit 100%, docker health
# checks started failing with ENOSPC, and crmx1 served 502s.
#
# Source of truth: nextcrm-app/scripts/vps-disk-guard.sh.
# Deployed to /usr/local/bin/nuraview-disk-guard.sh, run from root's crontab
# every 10 minutes. Alerts go out via the Resend API so they still work when
# the local docker stack is the thing that is broken.
set -u

WARN=85
CRIT=92
EMERG=96
ENV_APP=/root/nuraview-app/.env
STATE=/var/lib/nuraview-disk-guard.state
LOG=/var/log/nuraview-disk-guard.log
BALLAST=/root/.emergency-ballast
ALERT_TO="afhamabid1@gmail.com"

use=$(df --output=pcent / | tail -1 | tr -dc '0-9')

log() { echo "$(date -u +%FT%TZ) [${use}%] $*" >>"$LOG"; }

envget() { grep -E "^$1=" "$ENV_APP" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

# alert LEVEL MESSAGE — emails via Resend, at most once per 6h per level.
alert() {
  local level=$1 msg=$2 now last key from
  now=$(date +%s)
  last=$(awk -v l="$level" '$1==l{print $2}' "$STATE" 2>/dev/null)
  if [ -n "${last:-}" ] && [ $((now - last)) -lt 21600 ]; then return 0; fi
  { awk -v l="$level" '$1!=l' "$STATE" 2>/dev/null; echo "$level $now"; } >"$STATE.new" && mv "$STATE.new" "$STATE"
  key=$(envget RESEND_API_KEY)
  from=$(envget RESEND_FROM_EMAIL)
  if [ -z "$key" ] || [ -z "$from" ]; then
    log "alert($level) skipped: RESEND_API_KEY/RESEND_FROM_EMAIL missing in $ENV_APP"
    return 1
  fi
  curl -sS -m 20 https://api.resend.com/emails \
    -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
    -d "{\"from\":\"$from\",\"to\":[\"$ALERT_TO\"],\"subject\":\"[VPS $level] $msg\",\"text\":\"$(hostname): $msg\\n\\n$(df -h / | tail -1)\\n\\nGuard log: $LOG\"}" \
    >>"$LOG" 2>&1 && log "alert($level) emailed: $msg" || log "alert($level) email FAILED: $msg"
}

if [ "$use" -ge "$CRIT" ]; then
  before=$use
  log "disk >= ${CRIT}% — auto-cleaning"
  # Known junk pattern from the 2026-07-31 flood: delete on sight, any age.
  find /tmp -maxdepth 1 -name '.*-00000000.so' -type f -delete 2>/dev/null
  systemd-tmpfiles --clean 2>/dev/null
  journalctl --vacuum-size=200M >/dev/null 2>&1
  docker builder prune -f >/dev/null 2>&1
  # Dangling layers only. Never -a: tagged images must survive for pinned
  # manual container recreates (see project memory).
  docker image prune -f >/dev/null 2>&1
  use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  log "auto-clean done (was ${before}%)"
  alert CRITICAL "disk hit ${before}%, auto-clean brought it to ${use}%"
elif [ "$use" -ge "$WARN" ]; then
  alert WARNING "disk at ${use}% and rising toward the ${CRIT}% auto-clean threshold"
fi

if [ "$use" -ge "$EMERG" ] && [ -f "$BALLAST" ]; then
  rm -f "$BALLAST"
  use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  log "EMERGENCY — 2G ballast released"
  alert EMERGENCY "disk was >= ${EMERG}% after auto-clean; 2G emergency ballast deleted — investigate immediately"
fi

# Recreate the emergency ballast once the disk is healthy again.
if [ "$use" -lt "$WARN" ] && [ ! -f "$BALLAST" ]; then
  fallocate -l 2G "$BALLAST" 2>/dev/null && log "2G ballast created at $BALLAST"
fi

# The outage presented as nginx 502 long before anyone looked at df.
# Watch the one container whose health equals "is prod up".
api=$(docker inspect nuraview-api --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)
if [ "$api" != "healthy" ] && [ "$api" != "starting" ]; then
  alert API-DOWN "nuraview-api container is '$api' — crmx1.nuraview.com likely serving 502s"
fi
