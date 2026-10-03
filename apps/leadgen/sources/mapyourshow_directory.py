"""Public exhibitor roster from a Map Your Show event directory.

Map Your Show powers many trade-show exhibitor directories on a per-event
subdomain, for example ``https://weftec26.mapyourshow.com``. The browsable
gallery is a client-rendered app whose data feed sits under ``/8_0/ajax`` — a
path the site's own ``robots.txt`` disallows and which answers 403 without a
browser session. We do not touch it.

Instead this module reads the one public, server-generated artifact the gallery
itself links to: the exhibitor list Excel export at
``/8_0/exhibitor/exhibitor-list.cfm?export=excel``. That path is allowed by
``robots.txt`` (only the 6_0 and 7_0 copies are disallowed, not 8_0), it needs
no login, and it returns the full exhibiting-company roster in one request.

The export carries company name and booth number only. Websites and contacts
are filled later by the normal enrichment pipeline (``pipeline.enrich_websites``
resolves a site from the company name, then ``sources.site_crawl`` /
``sources.serp_emails`` find the people). So each row we emit here is a seed
account, not a finished lead.

This is a directory of exhibiting COMPANIES, never the event's attendee roster.
Attendee people come only from a client's own booth-scan export
(``sources.booth_scan_import``), which is data the client already holds.
"""

from __future__ import annotations

import argparse
import shutil
import ssl
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# A plain token, deliberately. Map Your Show's CDN fingerprints requests: a full
# Chrome UA string over a non-Chrome TLS stack is challenged with an empty
# ``202`` and never served the file, while a generic ``Mozilla/5.0`` is allowed.
_UA = "Mozilla/5.0"

# The robots-allowed, login-free export the public gallery links to.
_EXPORT_PATH = "/8_0/exhibitor/exhibitor-list.cfm?export=excel"


def _export_url(subdomain: str) -> str:
    sub = subdomain.strip().strip(".").strip("/")
    return f"https://{sub}.mapyourshow.com{_EXPORT_PATH}"


def _directory_url(subdomain: str) -> str:
    sub = subdomain.strip().strip(".").strip("/")
    return f"https://{sub}.mapyourshow.com/8_0/exhibitor-gallery.cfm"


def _get_bytes(url: str, *, timeout: float = 60.0) -> bytes | None:
    """Fetch a binary body (the Excel file). Returns None on failure.

    Map Your Show sits behind a CDN that answers HTTP/1.1 requests with an empty
    ``202 Accepted`` (a bot check) and serves the file only over HTTP/2. Python's
    stdlib ``urlopen`` speaks HTTP/1.1 only, so we fetch with ``curl --http2``
    when it is available and fall back to urllib otherwise.
    """
    curl = shutil.which("curl")
    if curl:
        for attempt in range(3):
            try:
                proc = subprocess.run(
                    [
                        curl, "-s", "-L", "--http2", "--compressed",
                        "--max-time", str(int(timeout)),
                        "-A", _UA, url,
                    ],
                    capture_output=True,
                    timeout=timeout + 10,
                )
                if proc.returncode == 0 and proc.stdout:
                    return proc.stdout
            except (subprocess.TimeoutExpired, OSError) as e:
                print(f"Warning: curl export fetch failed ({url[:80]}…): {e}")
            time.sleep(2.0)

    # Fallback: stdlib HTTP/1.1 (may hit the 202 bot check on CDN-fronted hosts).
    req = Request(url, headers={"User-Agent": _UA, "Accept": "*/*"}, method="GET")
    try:
        with urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:
            body = resp.read()
        if body:
            return body
        print(f"Warning: Map Your Show export returned empty body (HTTP {resp.status}).")
        return None
    except (HTTPError, URLError, OSError, TimeoutError) as e:
        print(f"Warning: Map Your Show export fetch failed ({url[:80]}…): {e}")
        return None


def _parse_export(data: bytes) -> list[tuple[str, str]]:
    """Parse the exhibitor-list .xlsx into [(company, booth), …].

    Uses the project's stdlib xlsx reader (``storage.xlsx_output``), not openpyxl,
    to match how the rest of the pipeline reads spreadsheets.
    """
    import os
    import tempfile
    from pathlib import Path

    from storage.xlsx_output import _read_sheet_all_rows

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tf:
        tf.write(data)
        tmp = tf.name
    try:
        rows = _read_sheet_all_rows(Path(tmp))
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if not rows:
        return []

    # Header is ("Name", "Booth") today, but find the columns by name so a
    # layout change does not silently shift the data.
    header = [str(c or "").strip().lower() for c in rows[0]]
    try:
        name_i = header.index("name")
    except ValueError:
        name_i = 0
    booth_i = header.index("booth") if "booth" in header else (1 if len(header) > 1 else 0)

    out: list[tuple[str, str]] = []
    for r in rows[1:]:
        if not r:
            continue
        company = str(r[name_i] or "").strip() if name_i < len(r) else ""
        booth = str(r[booth_i] or "").strip() if booth_i < len(r) else ""
        if company:
            out.append((company, booth))
    return out


def fetch_mapyourshow_exhibitors(
    *,
    subdomain: str,
    show_name: str,
    data_batch: str,
    source_bucket: str,
    limit: int | None = None,
) -> list[dict]:
    """Return seed account records for every exhibitor in a Map Your Show event.

    Record shape matches what ``outreach.cockpit_api.merge_records`` consumes.
    ``website`` is intentionally blank: the enrichment pipeline resolves it.
    """
    data = _get_bytes(_export_url(subdomain))
    if not data:
        print(f"Warning: {show_name} — exhibitor export unavailable; 0 rows.")
        return []

    pairs = _parse_export(data)
    if limit is not None:
        pairs = pairs[: max(0, limit)]

    directory = _directory_url(subdomain)
    out: list[dict] = []
    for company, booth in pairs:
        booth_note = f" Booth {booth}." if booth else ""
        out.append(
            {
                "company": company,
                "website": "",
                "post_url": directory,
                "source": f"{show_name} Exhibitor Directory",
                "signal_category": "event_exhibitor",
                "signal_evidence": f"Exhibiting company at {show_name}.{booth_note}",
                "booth": booth,
                "event": show_name,
                "data_batch": data_batch,
                "lead_source_bucket": source_bucket,
            }
        )

    print(f"  {show_name} (Map Your Show export): {len(out)} exhibitor rows.")
    return out


def _cli() -> None:
    p = argparse.ArgumentParser(description="Fetch a Map Your Show public exhibitor roster.")
    p.add_argument("--subdomain", required=True, help="e.g. weftec26")
    p.add_argument("--show", required=True, help='e.g. "WEFTEC 2026"')
    p.add_argument("--batch", required=True, help="data_batch label, e.g. weftec-2026")
    p.add_argument("--bucket", default="event:exhibitor", help="lead_source_bucket value")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true", help="print rows, write nothing")
    args = p.parse_args()

    rows = fetch_mapyourshow_exhibitors(
        subdomain=args.subdomain,
        show_name=args.show,
        data_batch=args.batch,
        source_bucket=args.bucket,
        limit=args.limit,
    )
    if args.dry_run or not rows:
        for r in rows[:20]:
            print(f"  - {r['company']!r} | {r['booth'] or '(no booth)'}")
        print(f"[dry-run] {len(rows)} rows parsed; nothing written.")
        return

    from outreach.cockpit_api import merge_records

    res = merge_records(rows, data_batch_override=args.batch, source_bucket_override=args.bucket)
    print(f"Ingested: {res}")


if __name__ == "__main__":
    _cli()
