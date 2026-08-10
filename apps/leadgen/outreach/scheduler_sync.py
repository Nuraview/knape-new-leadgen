"""Push the content calendar to an external CRM's scheduler.

One-directional: we send, they receive. Knape's designer works inside a
different CRM (crmx1) and needs to see what is scheduled here without being
given an account on this dashboard.

Why a full resync instead of event-driven webhooks: the calendar is ~7 posts.
Re-sending all of them every few minutes is idempotent (the receiver upserts on
``externalEventId``) and self-healing — if the far end is down, or a post is
edited while it is down, the next tick repairs it. Event webhooks would need a
retry queue, a dead-letter path and a backfill job to reach the same place, and
all three are more code than the thing they protect.

The receiving schema is shaped for *meetings* (start/end/attendee), not social
posts. What that costs is documented on ``build_payload``.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from outreach import social_store

_SCHEDULER_STARTED = False
_LOCK = threading.Lock()

# A post is an instant, not an interval, but the receiver requires an end time
# to place a block on a calendar. This is presentation only — nothing here or
# downstream treats it as a real duration.
DEFAULT_DURATION_MIN = 30


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def is_enabled() -> bool:
    return _env("SCHEDULER_SYNC_ENABLED", "0") == "1"


def _status_map() -> dict[str, str]:
    """Optional remap of our status vocabulary onto the receiver's.

    Ours is a content-review lifecycle (draft -> pending_approval -> approved ->
    published); theirs is a booking lifecycle. Until they confirm which values
    they accept, statuses pass through unchanged and this stays empty — set
    SCHEDULER_SYNC_STATUS_MAP to a JSON object to translate.
    """
    raw = _env("SCHEDULER_SYNC_STATUS_MAP")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        # Malformed JSON must not take the loop down — an unmapped status is a
        # cosmetic problem, a crashed scheduler is not.
        return {}


def _iso_utc(epoch: float) -> str:
    return dt.datetime.fromtimestamp(float(epoch), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _title_for(post: dict[str, Any]) -> str:
    """Posts are not required to have a title; the body's first line is the
    next-best label for a calendar chip."""
    title = (post.get("title") or "").strip()
    if title:
        return title
    first_line = (post.get("body") or "").strip().splitlines()
    if first_line:
        return first_line[0][:80]
    return f"Post {post.get('id')}"


def _media_urls(post: dict[str, Any]) -> list[str]:
    """Creative URLs, only if a publicly reachable base is configured.

    The cockpit serves media from /api/social/media/{id}/file behind a bearer
    token, so a URL built against this host would render as a broken image in
    someone else's CRM. Rather than send links we know will 401, we send none
    until SCHEDULER_SYNC_MEDIA_BASE names a base that does not need our auth.
    """
    base = _env("SCHEDULER_SYNC_MEDIA_BASE").rstrip("/")
    if not base:
        return []
    return [f"{base}/{m['id']}" for m in post.get("media") or []]


def build_payload(post: dict[str, Any], force_status: str | None = None) -> dict[str, Any]:
    """Map one social post onto the receiver's event schema.

    Deliberately dropped: ``attendeeName`` / ``attendeeEmail``. Nobody attends a
    social post, and stuffing the author or approver in there would misreport
    who the event is *with*. Empty is more honest than wrong.

    The post copy goes in ``description`` — the receiver's name for it. Getting
    this key wrong is silent: an unrecognised field is simply dropped, so the
    designer would see correctly-scheduled events with no content in them.
    """
    started = float(post["scheduled_at"])
    duration_min = int(_env("SCHEDULER_SYNC_DURATION_MIN", str(DEFAULT_DURATION_MIN)) or DEFAULT_DURATION_MIN)
    status = force_status or str(post.get("status") or "draft")

    payload: dict[str, Any] = {
        "source": _env("SCHEDULER_SYNC_SOURCE", "knape"),
        # Prefixed rather than the bare row id: safe whether the receiver's
        # upsert key is (source, externalEventId) or externalEventId alone.
        "externalEventId": f"knape-social-{post['id']}",
        "title": _title_for(post),
        "description": post.get("body") or "",
        "startTime": _iso_utc(started),
        "endTime": _iso_utc(started + duration_min * 60),
        "status": _status_map().get(status, status),
    }

    urls = _media_urls(post)
    if urls:
        payload["mediaUrls"] = urls

    return payload


def _post_json(url: str, token: str, payload: dict[str, Any], timeout: int = 15) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(2000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        # The receiver's 400 carries which field failed validation — that body
        # is the whole diagnostic, so read it rather than just the status.
        return e.code, e.read(2000).decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, f"{type(e).__name__}: {e}"


def _deleted_posts() -> list[dict[str, Any]]:
    """Soft-deleted posts, so the receiver can retire them.

    ``list_posts`` filters these out, and on its own that would strand a deleted
    post on the designer's calendar permanently: to an upsert, "no longer sent"
    is indistinguishable from "unchanged". Only an explicit ``cancelled`` clears
    it. Reaches for social_store's connection helper rather than adding a
    function there, because that module is a mirror of the client's own cockpit
    and is worth keeping free of drift.
    """
    c = social_store._conn()
    try:
        rows = c.execute(
            "SELECT id, title, body, status, scheduled_at FROM social_posts "
            "WHERE deleted_at IS NOT NULL AND scheduled_at IS NOT NULL"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def sync_once(dry_run: bool = False) -> dict[str, Any]:
    """Push every scheduled post. Returns a summary rather than raising, so a
    caller in the scheduler thread can log without try/except around it.

    ``dry_run`` builds and returns the payloads without sending — the only way
    to inspect the mapping while the receiving endpoint is still undeployed.
    """
    url = _env("SCHEDULER_SYNC_URL")
    token = _env("SCHEDULER_SYNC_TOKEN")
    if not dry_run and (not url or not token):
        return {"ok": False, "error": "SCHEDULER_SYNC_URL / SCHEDULER_SYNC_TOKEN not configured"}

    posts = social_store.list_posts()  # already excludes soft-deleted rows
    scheduled = [p for p in posts if p.get("scheduled_at")]
    skipped = len(posts) - len(scheduled)

    cancelled = _deleted_posts()
    payloads = [build_payload(p) for p in scheduled]
    payloads += [build_payload(p, force_status="cancelled") for p in cancelled]

    if dry_run:
        return {"ok": True, "dry_run": True, "count": len(payloads),
                "cancelled": len(cancelled), "skipped_unscheduled": skipped,
                "payloads": payloads}

    sent, failures = 0, []
    for payload in payloads:
        status, body = _post_json(url, token, payload)
        if 200 <= status < 300:
            sent += 1
        else:
            failures.append({"id": payload["externalEventId"], "status": status, "body": body[:300]})

    return {"ok": not failures, "sent": sent, "failed": len(failures),
            "cancelled": len(cancelled), "skipped_unscheduled": skipped,
            "failures": failures[:10]}


def _loop(interval_sec: int) -> None:
    # Let the app finish booting before the first outbound round-trip.
    time.sleep(25)
    while True:
        if is_enabled():
            try:
                result = sync_once()
                if not result.get("ok"):
                    print(f"Cockpit: scheduler sync issue: {result}", flush=True)
            except Exception as e:  # noqa: BLE001
                # Same contract as the other cockpit loops: a tick may fail, the
                # loop may not die.
                print(f"Cockpit: scheduler sync tick failed: {type(e).__name__}: {e}", flush=True)
        time.sleep(interval_sec)


def ensure_scheduler(interval_sec: int = 300) -> None:
    """Start the background push loop once per process."""
    global _SCHEDULER_STARTED
    with _LOCK:
        if _SCHEDULER_STARTED:
            return
        t = threading.Thread(target=_loop, args=(interval_sec,), daemon=True, name="scheduler-sync")
        t.start()
        _SCHEDULER_STARTED = True
