"""Pull the full attendee list for The International WorkBoat Show 2026 from the
official event app (Brella, workboatshow.brella.io -> api.brella.io).

Auth: the Brella one-click sign-in flow. Verify a 6-char email OTP code to get
an access token, then page through the event's attendee directory.

Usage:
    # 1) get a fresh code: POST /one_click_links (needs an hcaptcha token,
    #    easiest to trigger from the web app at workboatshow.brella.io)
    # 2) run this script with the code:
    python3 scripts/one-off/20261020-workboat-2026-attendees.py --code XXXXXX \
        --email afhamabid1@gmail.com

Or with an already-captured token:
    python3 ... --token <access-token>

Output:
    docs/workboat-show-2026/brella-attendees-2026-raw.json   (verbatim records)
    docs/workboat-show-2026/attendees-2026.csv               (project convention:
        name,title,company,has_title,has_company,source_url)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time

import requests

API = "https://api.brella.io/api"
ORG_SLUG = "workboatshow"
EVENT_NAME_HINT = "workboat"
EMAIL = "afhamabid1@gmail.com"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "workboat-show-2026")


def base_headers() -> dict[str, str]:
    return {
        "Accept": "application/vnd.brella.v4+json",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "brella-organization-slug": ORG_SLUG,
        "include-extra-schedule-data": "true",
    }


def verify_otp(code: str, email: str) -> dict:
    """Exchange the 6-char OTP for user data; the access token arrives in
    response headers (access-token / token-type)."""
    r = requests.post(
        f"{API}/one_click_links/sign_in",
        headers=base_headers(),
        json={"token": code.strip(), "email": email, "account_type": "organization_scoped"},
        timeout=60,
    )
    print(f"[auth] {r.status_code} {r.text[:200]}")
    r.raise_for_status()
    token = r.headers.get("access-token") or r.headers.get("authorization") or ""
    token_type = r.headers.get("token-type", "")
    body = r.json()
    return {"token": token, "token_type": token_type, "user": body}


def auth_headers(session: requests.Session, auth: dict) -> dict[str, str]:
    h = base_headers()
    t = auth.get("token") or ""
    if t:
        if t.lower().startswith("bearer "):
            h["Authorization"] = t
        else:
            h["Authorization"] = f"Bearer {t}"
            h["access-token"] = t
            if auth.get("token_type"):
                h["token-type"] = auth["token_type"]
    return h


def find_event_slug(session: requests.Session, headers: dict) -> str:
    r = session.get(f"{API}/me/events", headers=headers, timeout=60)
    print(f"[events] {r.status_code}")
    if r.status_code != 200:
        print(r.text[:400])
        sys.exit("could not list events")
    data = r.json().get("data", [])
    for ev in data:
        attrs = ev.get("attributes", ev)
        blob = json.dumps(attrs).lower()
        if EVENT_NAME_HINT in blob:
            slug = ev.get("slug") or attrs.get("slug")
            name = attrs.get("name") or attrs.get("title") or "?"
            print(f"[events] found: {name} slug={slug}")
            return slug
    # fallback: dump and let the caller decide
    for ev in data:
        print("[events] candidate:", json.dumps(ev)[:300])
    sys.exit("no workboat event found in /me/events")


def fetch_page(session: requests.Session, headers: dict, slug: str, page: int, size: int = 100) -> dict:
    params = {"size": size, "page": page, "order": "newest"}
    r = session.get(f"{API}/events/{slug}/attendees", params=params, headers=headers, timeout=120)
    return {"status": r.status_code, "json": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:500], "headers": dict(r.headers)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code")
    ap.add_argument("--token")
    ap.add_argument("--email", default=EMAIL)
    ap.add_argument("--slug", help="event slug (skip /me/events lookup)")
    ap.add_argument("--size", type=int, default=100)
    ap.add_argument("--max-pages", type=int, default=500)
    args = ap.parse_args()

    session = requests.Session()

    if args.token:
        auth = {"token": args.token}
    elif args.code:
        auth = verify_otp(args.code, args.email)
        token = auth["token"]
        print(f"[auth] token={'yes (' + str(len(token)) + ' chars)' if token else 'NONE — check response headers'}")
        # persist token for the pager script
        with open(os.path.join(OUT_DIR, "brella-token.json"), "w") as f:
            json.dump(auth, f, indent=2)
    else:
        sys.exit("need --code or --token")

    headers = auth_headers(session, auth)

    slug = args.slug or find_event_slug(session, headers)

    # probe: one page, dump raw shape
    probe = fetch_page(session, headers, slug, 1, size=5)
    print(f"[probe] status={probe['status']}")
    print(json.dumps(probe["json"], indent=2)[:4000])

    raw_out = os.path.join(OUT_DIR, "brella-attendees-2026-raw.json")
    all_items: list[dict] = []
    page = 1
    while page <= args.max_pages:
        res = fetch_page(session, headers, slug, page, size=args.size)
        if res["status"] != 200:
            print(f"[page {page}] status {res['status']}: {str(res['json'])[:300]}")
            break
        body = res["json"]
        items = body.get("data", []) if isinstance(body, dict) else body
        if not items:
            break
        all_items.extend(items)
        total = body.get("total") if isinstance(body, dict) else None
        print(f"[page {page}] +{len(items)} (total so far {len(all_items)}{', server total ' + str(total) if total is not None else ''})")
        if total is not None and len(all_items) >= int(total):
            break
        if len(items) < args.size:
            break
        page += 1
        time.sleep(0.4)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(raw_out, "w") as f:
        json.dump(all_items, f, indent=2)
    print(f"[out] {len(all_items)} raw records -> {raw_out}")

    # normalize to project convention
    csv_out = os.path.join(OUT_DIR, "attendees-2026.csv")
    rows = []
    for it in all_items:
        a = it.get("attributes", it) if isinstance(it, dict) else {}
        first = (a.get("first-name") or a.get("firstName") or "").strip()
        last = (a.get("last-name") or a.get("lastName") or "").strip()
        title = (a.get("job-title") or a.get("jobTitle") or a.get("title") or a.get("position") or "").strip()
        company = (a.get("company-name") or a.get("companyName") or a.get("company") or "").strip()
        name = " ".join(x for x in (first, last) if x)
        source_url = ""
        rows.append({
            "name": name,
            "title": title,
            "company": company,
            "has_title": "TRUE" if title else "FALSE",
            "has_company": "TRUE" if company else "FALSE",
            "source_url": source_url,
        })
    with open(csv_out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["name", "title", "company", "has_title", "has_company", "source_url"])
        w.writeheader()
        w.writerows(rows)
    print(f"[out] {len(rows)} csv rows -> {csv_out}")


if __name__ == "__main__":
    main()
