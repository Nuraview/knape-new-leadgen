"""Camofox REST client — local stealth-browser fallback tier for Phase 2 crawling.

Camofox (Camoufox) runs locally on port 9377. We use the per-tab REST lifecycle
(POST /tabs → GET /tabs/:id/snapshot → DELETE /tabs/:id) so tabs never pile up.
The accessibility snapshot (a YAML-ish text tree) is parsed into the same
``segments`` / ``links`` shape that ``sources.site_crawl`` extracts from raw HTML,
so the downstream contact extractor works unchanged.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any

_BASE = "http://127.0.0.1:9377"
_USER = "winday-crawl"

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# `- role "quoted text" [ref]: trailing`  /  `- text: plain content`
_LINE_RE = re.compile(r'^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+\[[^\]]*\])?:?\s*(.*)$')
_URL_RE = re.compile(r'^\s*-\s+/url:\s*"?([^"\s]+)"?\s*$')

# Roles whose text is page chrome, not content worth extracting from.
_SKIP_ROLES = {"img", "textbox", "checkbox", "combobox", "option", "searchbox", "slider"}


def _req(method: str, path: str, body: dict | None = None, timeout: float = 75.0) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        _BASE + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


def alive() -> bool:
    try:
        return bool(_req("GET", f"/tabs?userId={_USER}", timeout=5.0).get("running"))
    except Exception:  # noqa: BLE001
        return False


_SEM = threading.BoundedSemaphore(3)  # one browser — a few pages in flight at a time
_MUTEX = threading.Lock()
_INFLIGHT = 0


def fetch_snapshot(url: str, *, wait: float = 5.0) -> tuple[str, str, str]:
    """Render ``url`` in camofox. Returns ``(snapshot_text, final_url, "")`` or
    ``("", "", reason)`` on failure. The tab is always closed afterwards.
    Thread-safe: up to 3 concurrent tab lifecycles; the leaked-tab session wipe
    (per-tab DELETE is a no-op in this server build) only fires when no other
    page is in flight, so it can't kill a sibling worker's tab."""
    global _INFLIGHT
    with _SEM:
        with _MUTEX:
            _INFLIGHT += 1
        try:
            return _fetch_snapshot_locked(url, wait)
        finally:
            with _MUTEX:
                _INFLIGHT -= 1
                solo = _INFLIGHT == 0
            if solo:
                try:
                    tabs = _req("GET", f"/tabs?userId={_USER}", timeout=10.0).get("tabs", [])
                    if len(tabs) >= 10:
                        _req("DELETE", f"/sessions/{_USER}", timeout=15.0)
                except Exception:  # noqa: BLE001
                    pass


def _fetch_snapshot_locked(url: str, wait: float) -> tuple[str, str, str]:
    tab_id = None
    try:
        res = None
        for attempt in range(4):  # the camofox server 429s under rapid tab churn
            try:
                res = _req("POST", "/tabs", {"userId": _USER, "sessionKey": "default", "url": url})
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 3:
                    time.sleep(5.0 * (attempt + 1))
                    continue
                raise
        tab_id = (res or {}).get("tabId")
        if not tab_id:
            return "", "", "camofox:no_tab"
        time.sleep(wait)
        snap = _req("GET", f"/tabs/{tab_id}/snapshot?userId={_USER}")
        text = snap.get("snapshot", "") or ""
        final = snap.get("url", url) or url
        if len(text.split()) < 30:  # still rendering or challenge in progress — one more beat
            time.sleep(6.0)
            snap = _req("GET", f"/tabs/{tab_id}/snapshot?userId={_USER}")
            text = snap.get("snapshot", text) or text
            final = snap.get("url", final) or final
        if not text.strip():
            return "", "", "camofox:empty"
        return text, final, ""
    except Exception as e:  # noqa: BLE001
        return "", "", f"camofox:{str(e)[:50]}"
    finally:
        if tab_id:
            try:  # best effort; the real cleanup is the idle-time session wipe above
                _req("DELETE", f"/tabs/{tab_id}?userId={_USER}", timeout=15.0)
            except Exception:  # noqa: BLE001
                pass


def close_session() -> None:
    """Close every tab in our user context (call between sites)."""
    try:
        _req("DELETE", f"/sessions/{_USER}", timeout=15.0)
    except Exception:  # noqa: BLE001
        pass


def snapshot_to_segments(snapshot: str) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    """Parse an a11y snapshot into (segments, links) matching the HTML segmenter's shape:
    segments = [{"text": str, "emails": [str]}], links = [(href, anchor_text)]."""
    segments: list[dict[str, Any]] = []
    links: list[tuple[str, str]] = []
    pending_anchor = ""  # link text waiting for its /url line

    for line in snapshot.splitlines():
        um = _URL_RE.match(line)
        if um:
            href = um.group(1)
            if href.lower().startswith("mailto:"):
                em = href[7:].split("?")[0].strip().lower()
                if _EMAIL_RE.fullmatch(em) and segments:
                    segments[-1]["emails"].append(em)
            else:
                links.append((href, pending_anchor))
            pending_anchor = ""
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        role, quoted, rest = m.group(1), m.group(2), m.group(3)
        text = (quoted if quoted is not None else rest or "").strip()
        text = text.replace('\\"', '"')
        if role == "link":
            pending_anchor = text
        if role in _SKIP_ROLES or not text:
            continue
        emails = [e.lower() for e in _EMAIL_RE.findall(text)]
        segments.append({"text": " ".join(text.split()), "emails": emails})
    return segments, links
