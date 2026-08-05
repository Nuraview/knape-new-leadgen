"""Dashboard-editable app settings (KV in Postgres).

Every operational knob resolves **DB value → env var → code default**, so the
dashboard always wins over whatever is baked into the VPS ``.env`` — the client
can tune the whole system from the UI with no developer involved.

The scrape scheduler also exports the Scraper group as env vars onto the
``milestone1`` subprocess, so pipeline/sources code keeps reading ``os.getenv``
and needs zero changes.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from outreach import db


def _connect() -> db._Conn:
    return db.connect()


def init_db() -> None:
    conn = _connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DOUBLE PRECISION NOT NULL
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Registry: one entry per client-facing setting.
#   key        — app_settings key AND (for scraper group) the env var exported
#                to the milestone1 subprocess.
#   group      — Scraper | Enrichment | Outreach (UI grouping)
#   type       — bool | int | float | str | times | states
#   default    — code default (used when neither DB nor env has a value)
#   label/help — client-facing copy rendered by the Settings page
# ---------------------------------------------------------------------------
SETTINGS_REGISTRY: list[dict[str, Any]] = [
    # --- Scraper ---
    {"key": "SCRAPE_ENABLED", "group": "Scraper", "type": "bool", "default": False,
     "label": "Auto-scrape new leads",
     "help": "Automatically find new leads on the schedule below. Off until you switch it on."},
    {"key": "SCRAPE_TIMES", "group": "Scraper", "type": "times", "default": "03:00,15:00",
     "label": "Run times (server time)",
     "help": "When the scraper runs each day. Comma-separated 24h times."},
    {"key": "SCRAPE_TARGET_STATES", "group": "Scraper", "type": "states", "default": "",
     "label": "States to target",
     "help": "Limit lead-finding to these states. Leave empty for all 50 states."},
    {"key": "SCRAPE_MIN_SIZE", "group": "Scraper", "type": "int", "default": 0,
     "label": "Minimum organisation size",
     "help": "Organisations below this size are skipped. 0 disables the filter."},
    {"key": "SCRAPE_MAX_RECORDS", "group": "Scraper", "type": "int", "default": 60,
     "label": "Max organisations per run",
     "help": "Cap on new organisations added by one scraper run."},
    {"key": "TARGET_LEAD_COUNT", "group": "Scraper", "type": "int", "default": 100,
     "label": "Max total leads per run",
     "help": "Overall cap on leads one scraper run can add."},
    {"key": "MIN_ICP_SCORE", "group": "Scraper", "type": "float", "default": 5.0,
     "label": "Minimum fit score (0-10)",
     "help": "Leads scoring below this are dropped before they reach your board."},
    {"key": "INCLUDE_SOR_SUBAWARDS", "group": "Scraper", "type": "bool", "default": False,
     "label": "Include State Opioid Response sub-awards",
     "help": "Adds SOR sub-award recipients. Off by default — that list skews toward treatment programs."},
    {"key": "USASPENDING_DETAIL_MAX", "group": "Scraper", "type": "int", "default": 900,
     "label": "Grant lookups per run",
     "help": "How many federal grant records to check in detail per run. Higher = more coverage, slower run."},
    # --- Enrichment ---
    {"key": "AUTO_ENRICH_ENABLED", "group": "Enrichment", "type": "bool", "default": True,
     "label": "Auto-find contacts for new leads",
     "help": "After each scrape, automatically look up decision-maker contacts for newly added leads."},
    {"key": "ENRICH_DAILY_CAP", "group": "Enrichment", "type": "int", "default": 50,
     "label": "Daily contact-finding limit",
     "help": "Max leads enriched per day, so search/AI credits can't run away."},
    {"key": "ENRICH_MAX_CONTACTS", "group": "Enrichment", "type": "int", "default": 3,
     "label": "Contacts per lead",
     "help": "How many people to keep per school or coalition."},
    # --- Outreach ---
    {"key": "MILESTONE2_SEQUENCE_STEPS", "group": "Outreach", "type": "int", "default": 4,
     "label": "Emails per sequence",
     "help": "First email plus follow-ups (4 = opener + 3 follow-ups)."},
    {"key": "MILESTONE2_FOLLOWUP_GAP_DAYS", "group": "Outreach", "type": "str", "default": "3,5,7",
     "label": "Days between follow-ups",
     "help": "Wait times after each email, e.g. 3,5,7 = +3d, +5d, +7d."},
    {"key": "OUTREACH_SENDER_NAME", "group": "Outreach", "type": "str", "default": "",
     "label": "Sender name",
     "help": "The name emails are signed with. Empty uses the instance brand."},
    {"key": "EMAIL_TEMPLATE_VARIANT", "group": "Outreach", "type": "str", "default": "frame1",
     "label": "Email design variant",
     "help": "Which of the two approved Figma designs emails use: 'frame1' (photo header, "
             "left-aligned copy, quote + Download button at the bottom) or 'frame2' (flat dark "
             "header, centered copy, quote + Download button in the middle)."},
    # --- When mail is allowed to leave ---
    #
    # 144 emails in one week landed in US school inboxes between 1am and 3am
    # Eastern, because the queue drains whenever it is due and the people
    # running it are nine and a half hours ahead. Costs nothing in volume:
    # ten hours at one send per 45 seconds is far more than the daily cap.
    {"key": "OUTREACH_SEND_WINDOW_START", "group": "Outreach", "type": "int", "default": 8,
     "label": "Start sending at (US Eastern)",
     "help": "Hour of the day, 0-23, in the recipients' timezone. Nothing goes out before this."},
    {"key": "OUTREACH_SEND_WINDOW_END", "group": "Outreach", "type": "int", "default": 18,
     "label": "Stop sending at (US Eastern)",
     "help": "Hour of the day, 0-23. Anything still queued waits for tomorrow's window."},
    {"key": "OUTREACH_SEND_WEEKDAYS_ONLY", "group": "Outreach", "type": "bool", "default": True,
     "label": "Weekdays only",
     "help": "Hold sending on Saturday and Sunday. These are school staff, and a Saturday "
             "send is read on Monday underneath everything else that arrived first."},
    {"key": "OUTREACH_DAILY_SEND_CAP", "group": "Outreach", "type": "int", "default": 75,
     "label": "Total emails per day (all inboxes)",
     "help": "Global rolling 24h send limit across every inbox. Keep at or below the sum of "
             "per-inbox caps (3 inboxes x 25 = 75). Follow-ups queue up if this is too low."},
    # --- Keys (external provider API keys — a dashboard value here overrides the VPS .env) ---
    {"key": "BRIGHTDATA_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "Bright Data API key",
     "help": "Primary search provider, and the unlocker that fetches school sites which "
             "block a plain request. On 5 Aug every other provider ran out of credit at "
             "once and contact-finding stopped dead; this is the one that kept working."},
    {"key": "BRIGHTDATA_UNLOCKER_ZONE", "group": "Keys", "type": "str", "default": "",
     "label": "Bright Data Web Unlocker zone",
     "help": "A SEPARATE zone from the SERP one. The SERP zone only answers search-engine "
             "URLs; fetching a school's staff directory needs an Unlocker zone. Without it, "
             "2,313 leads that have a website and no email address stay unreachable."},
    {"key": "BRIGHTDATA_DAILY_BUDGET", "group": "Keys", "type": "int", "default": 400,
     "label": "Bright Data calls per day",
     "help": "Hard ceiling on billable requests in a day. Not a cap on work, a cap on spend. "
             "Set for a free trial: the trial is a few thousand requests in total, so 400 a day "
             "makes it last a working fortnight instead of two days. Repeat questions are answered "
             "from cache and never billed. Raise it only when there is a paid balance behind it."},
    {"key": "BRIGHTDATA_ZONE", "group": "Keys", "type": "str", "default": "serp_api1",
     "label": "Bright Data zone",
     "help": "The zone name as it appears in the Bright Data account. Must exist there or "
             "every request is rejected."},
    {"key": "SERPER_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "Serper.dev API key",
     "help": "Required. Powers website discovery, LinkedIn lookup, and org/contact search across enrichment."},
    {"key": "TAVILY_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "Tavily API key",
     "help": "Optional fallback search provider — used automatically when Serper is out of credits."},
    {"key": "OPENWEBNINJA_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "OpenWebNinja API key",
     "help": "Optional second fallback search provider."},
    {"key": "APOLLO_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "Apollo.io API key",
     "help": "Used first for org phone + LinkedIn (works on the free plan). Verified person "
             "emails + direct dials need a paid Apollo plan — the free plan blocks that endpoint."},
    {"key": "LEAD_NOTIFY_TO", "group": "Outreach", "type": "str",
     "default": "",
     "label": "Where website leads and replies go",
     "help": "The Reply-To on every confirmation sent to someone who filled in a landing-page "
             "form, and the address the new-lead alert is sent to. Must be a mailbox listed in "
             "Inboxes with IMAP configured, or replies land where nothing is watching."},
    {"key": "MILLIONVERIFIER_API_KEY", "group": "Keys", "type": "secret", "default": "",
     "label": "MillionVerifier API key",
     "help": "Checks every address is deliverable before it is written to. $0.0037 per check, "
             "credits never expire, and catch-all/unknown answers are not billed. Without it the "
             "system falls back to its own SMTP probe, which school mail gateways defeat — that "
             "is what the current bounce rate is."},
]

_BY_KEY = {s["key"]: s for s in SETTINGS_REGISTRY}

# Internal state keys (not client-facing; no env fallback).
STATE_KEYS = ("SCRAPE_LAST_RUN_AT", "SCRAPE_LAST_RESULT", "ENRICH_DAY", "ENRICH_DAY_COUNT", "KEY_ALERTS",
              "BOUNCE_SCAN_LAST", "REPLY_SCAN_LAST", "BOUNCE_SCAN_UIDS")


def _coerce(spec: dict[str, Any] | None, raw: str | None) -> Any:
    if raw is None:
        return None
    if not spec:
        return raw
    t = spec["type"]
    try:
        if t == "bool":
            return str(raw).strip().lower() in ("1", "true", "yes", "on")
        if t == "int":
            return int(float(str(raw).strip()))
        if t == "float":
            return float(str(raw).strip())
    except (TypeError, ValueError):
        return spec["default"]
    return str(raw)


def _db_get(key: str) -> str | None:
    conn = _connect()
    try:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return None if row is None else row["value"]
    except Exception:  # noqa: BLE001 — table may not exist yet
        return None
    finally:
        conn.close()


def get_setting(key: str, default: Any = None) -> Any:
    """DB → env → registry default → ``default``."""
    spec = _BY_KEY.get(key)
    raw = _db_get(key)
    if raw is not None:
        return _coerce(spec, raw)
    env = os.getenv(key)
    if env is not None and env.strip() != "":
        return _coerce(spec, env)
    if spec is not None:
        return spec["default"]
    return default


def set_settings(values: dict[str, Any]) -> dict[str, Any]:
    """Validate + upsert. Unknown keys allowed only for internal STATE_KEYS."""
    init_db()
    now = time.time()
    saved: dict[str, Any] = {}
    conn = _connect()
    try:
        for key, val in values.items():
            if key not in _BY_KEY and key not in STATE_KEYS:
                continue
            spec = _BY_KEY.get(key)
            if spec:
                val = _coerce(spec, str(val))
                if spec["type"] == "times":
                    parts = [p.strip() for p in str(val).split(",") if p.strip()]
                    ok = all(len(p) == 5 and p[2] == ":" and p[:2].isdigit() and p[3:].isdigit() for p in parts)
                    if not parts or not ok:
                        continue
                    val = ",".join(parts)
            store = json.dumps(val) if isinstance(val, (dict, list)) else ("1" if val is True else "0" if val is False else str(val))
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                """,
                (key, store, now),
            )
            saved[key] = val
        conn.commit()
        return saved
    finally:
        conn.close()


def reset_setting(key: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM app_settings WHERE key = ?", (key,))
        conn.commit()
    finally:
        conn.close()


def all_settings() -> list[dict[str, Any]]:
    """Registry + current effective value + where it came from (for the UI).

    ``secret`` values (API keys) are masked to their last 4 characters — the real
    value never leaves the server after it's been saved once. The Keys tab only
    ever writes a field the user actually retyped (see ``SettingsPage``'s draft
    logic), so a masked placeholder can never be resubmitted as a new key.
    """
    # One query for every stored value — per-key lookups opened ~40 fresh
    # Postgres connections per request and made this endpoint seconds-slow.
    conn = _connect()
    try:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
        stored = {r["key"]: r["value"] for r in rows}
    except Exception:  # noqa: BLE001 — table may not exist yet
        stored = {}
    finally:
        conn.close()

    out = []
    for spec in SETTINGS_REGISTRY:
        raw_db = stored.get(spec["key"])
        env = os.getenv(spec["key"])
        if raw_db is not None:
            source = "dashboard"
        elif env not in (None, ""):
            source = "server"
        else:
            source = "default"
        if raw_db is not None:
            value = _coerce(spec, raw_db)
        elif env not in (None, ""):
            value = _coerce(spec, env)
        else:
            value = spec["default"]
        if spec["type"] == "secret" and value:
            s = str(value)
            value = ("•" * max(0, len(s) - 4)) + s[-4:] if len(s) > 4 else "•" * len(s)
        out.append({
            "key": spec["key"], "group": spec["group"], "type": spec["type"],
            "label": spec["label"], "help": spec["help"], "default": spec["default"],
            "value": value, "source": source,
        })
    return out


def record_key_alert(provider: str, message: str) -> None:
    """Flag a search provider as low/out of credits (or misconfigured) for the Keys tab."""
    alerts = get_key_alerts()
    alerts[provider] = {"message": message, "ts": time.time()}
    set_settings({"KEY_ALERTS": json.dumps(alerts)})


def clear_key_alert(provider: str) -> None:
    """Clear a provider's alert once a call succeeds again."""
    alerts = get_key_alerts()
    if provider in alerts:
        del alerts[provider]
        set_settings({"KEY_ALERTS": json.dumps(alerts)})


def get_key_alerts() -> dict[str, Any]:
    raw = _db_get("KEY_ALERTS")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return {}


def scraper_env() -> dict[str, str]:
    """The Scraper-group settings as env vars for the milestone1 subprocess."""
    env: dict[str, str] = {}
    for spec in SETTINGS_REGISTRY:
        if spec["group"] != "Scraper" or spec["key"] in ("SCRAPE_ENABLED", "SCRAPE_TIMES"):
            continue
        v = get_setting(spec["key"])
        env[spec["key"]] = ("true" if v else "false") if spec["type"] == "bool" else str(v)
    return env
