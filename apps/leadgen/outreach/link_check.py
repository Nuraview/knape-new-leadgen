"""Fetch every link that outreach can put in an email, and report what it returns.

This exists because nobody ever did it. Ten messaging angles shipped with eight
landing-page paths that had never been built; all eight returned 404, and the
templates went out that way for weeks. 1,204 of the 1,227 emails sent carry a
dead link and 63 people clicked one, in Dan's name, and landed on a Page Not
Found. The copy was reviewed. The links were not, because reviewing a link
means fetching it and no code path did.

So this is the check, and it is cheap: three HEAD requests. Run it from the CLI
(``main.py check-links``), from the dashboard (``GET /api/emails/link-check``),
and after any template edit.

Deliberately fetches the URLs the ANGLES actually contain rather than the
APPROVED_LINKS constant. Asserting the constants are reachable proves nothing
about what a recipient receives — the templates are what get sent, and it was
exactly that gap between "the approved list" and "what the copy says" that
produced this.
"""

from __future__ import annotations

import re
import ssl
import urllib.request
from typing import Any

from outreach.messaging_angles import ANGLES, APPROVED_LINKS, render_angle_steps

_URL = re.compile(r"https?://[^\s<>\")]+")

# A landing page behind a CDN may refuse a bare HEAD from a script. A browser
# UA and a GET that we stop reading is the honest way to ask "would a person
# see a page here?".
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _status(url: str, timeout: float = 20.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": _UA}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return int(r.status), ""
    except urllib.error.HTTPError as e:
        return int(e.code), e.reason or ""
    except Exception as e:  # noqa: BLE001 — DNS, TLS, timeout all mean "a reader would fail too"
        return 0, f"{type(e).__name__}: {e}"


def template_urls() -> dict[str, list[str]]:
    """Every distinct URL a rendered email can contain, by angle key.

    Renders each angle against a dummy lead rather than reading the raw
    template strings, so ``{SITE}`` and every other token is resolved exactly
    as a recipient would receive it.
    """
    lead = {"person_name": "Test Person", "company": "Test School", "job_title": "Athletic Director"}
    out: dict[str, list[str]] = {}
    for angle in ANGLES:
        found: list[str] = []
        for step in render_angle_steps(angle, lead, "Dan Rigby"):
            for u in _URL.findall(step.get("body") or ""):
                u = u.rstrip(".,);:")
                if u not in found:
                    found.append(u)
        label, url = angle["primary_link"]
        if url not in found:
            found.append(url)
        out[angle["key"]] = found
    return out


def check() -> dict[str, Any]:
    """Fetch every template URL once. ``ok`` is False if any is not 200."""
    by_angle = template_urls()
    distinct: list[str] = []
    for urls in by_angle.values():
        for u in urls:
            if u not in distinct:
                distinct.append(u)

    results = []
    for u in distinct:
        code, err = _status(u)
        results.append({
            "url": u,
            "status": code,
            "ok": code == 200,
            "approved": u in APPROVED_LINKS,
            "error": err,
        })

    broken = [r for r in results if not r["ok"]]
    unapproved = [r for r in results if not r["approved"]]
    return {
        "ok": not broken and not unapproved,
        "checked": len(results),
        "broken": broken,
        # A 200 on a page nobody approved is still a failure — the client was
        # explicit that only three pages may appear in outbound mail.
        "unapproved": unapproved,
        "results": results,
        "by_angle": by_angle,
    }


def print_report() -> int:
    """CLI entry. Returns a process exit code so CI can fail on a dead link."""
    r = check()
    for item in r["results"]:
        mark = "OK  " if item["ok"] else f"{item['status'] or 'ERR':<4}"
        flag = "" if item["approved"] else "   <- NOT AN APPROVED PAGE"
        print(f"{mark} {item['url']}{flag}{(' ' + item['error']) if item['error'] else ''}")
    if r["ok"]:
        print(f"\nAll {r['checked']} template links resolve and are approved.")
        return 0
    print(f"\n{len(r['broken'])} broken, {len(r['unapproved'])} unapproved, of {r['checked']} checked.")
    return 1
