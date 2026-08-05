"""Serper.dev Google SERP API (stdlib HTTP). Used for staff-page discovery + LinkedIn x-ray."""

from __future__ import annotations

import os

from utils.http import post_json

SERPER_API_KEY = (os.getenv("SERPER_API_KEY") or "").strip()
_ENDPOINT = "https://google.serper.dev/search"


def serper_enabled() -> bool:
    return bool(SERPER_API_KEY or (os.getenv("SERPER_API_KEY") or "").strip())


def serper_search(query: str, num: int = 10) -> list[dict]:
    """Return organic results [{title, link, snippet}] or [] on failure/no key."""
    key = SERPER_API_KEY or (os.getenv("SERPER_API_KEY") or "").strip()
    if not key:
        return []
    try:
        payload = post_json(
            _ENDPOINT,
            {"X-API-KEY": key, "Content-Type": "application/json"},
            {"q": query, "num": num, "gl": "us", "hl": "en"},
            timeout=30.0,
            retries=2,
        )
    except RuntimeError as e:
        print(f"Warning: Serper query failed: {str(e)[:120]}")
        return []
    out = []
    for r in payload.get("organic") or []:
        if isinstance(r, dict) and r.get("link"):
            out.append({"title": r.get("title", ""), "link": r["link"], "snippet": r.get("snippet", "")})
    return out
