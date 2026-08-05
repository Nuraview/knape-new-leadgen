#!/bin/bash
# Run the forked scraper (Flask) and the pusher in the same container.
# tini (PID 1) reaps children and forwards signals.
#
# CRITICAL: this script must exit non-zero if EITHER process dies, so
# docker's `restart: unless-stopped` policy can rebuild the world. The
# previous version `exec`d the pusher in the foreground, which meant the
# container stayed "Up" whenever Flask crashed — pusher kept hammering
# 127.0.0.1:5007 and producing nothing. We caught one such silent death
# at 2026-05-02 04:46:24 only after 41 hours of zero leads.
#
# `wait -n` is a bash builtin (not POSIX sh) — that's why this script
# uses #!/bin/bash. The base image is python:3.11-slim, which ships bash.
set -e

echo "[entrypoint] starting scraper service in background…"
python upwork_scraper_service.py &
SCRAPER_PID=$!

# Wait up to ~60s for the scraper to start listening.
i=0
until curl -sf http://127.0.0.1:5007/health > /dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -gt 30 ]; then
    echo "[entrypoint] scraper never became healthy; exiting"
    kill -TERM $SCRAPER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] scraper healthy — launching pusher"

python pusher.py &
PUSHER_PID=$!

# Block until ANY child exits. The bash builtin `wait -n` returns the
# exit status of whichever child died; we then kill the survivor and
# propagate that status so docker restarts us.
wait -n
EXITED=$?
echo "[entrypoint] one of the child processes exited (status=$EXITED) — shutting down so docker can restart"
kill -TERM "$SCRAPER_PID" "$PUSHER_PID" 2>/dev/null || true
# Give them a moment to flush, then collect.
wait 2>/dev/null || true
exit "$EXITED"
