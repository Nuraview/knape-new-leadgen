# All settings: ``.env`` (gitignored) + ``.env.example``. README overview.
# Obscure env names are documented in comment blocks below and in ``.env.example`` next to each key.

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv as _dotenv_load  # type: ignore[import-untyped]
except ModuleNotFoundError:  # pragma: no cover
    _dotenv_load = None


def _parse_dotenv_file(path: Path) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines from a single ``.env`` path."""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return out
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if not key:
            continue
        val = val.strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out


def load_dotenv(path: Path | str, *, override: bool = False) -> bool:
    """Load ``KEY=VALUE`` lines from a ``.env`` file into ``os.environ``."""
    p = Path(path)
    if _dotenv_load is not None:
        return bool(_dotenv_load(p, override=override))
    if not p.is_file():
        return False
    for key, val in _parse_dotenv_file(p).items():
        if not override and os.getenv(key) is not None:
            continue
        os.environ[key] = val
    return True


_ROOT = Path(__file__).resolve().parent
load_dotenv(_ROOT / ".env")
load_dotenv(_ROOT.parent / ".env")

GEMINI_ENV_NAMES: tuple[str, ...] = (
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_KEY",
    "GOOGLE_AI_API_KEY",
    "GOOGLE_GENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "gemini_api_key",
    "google_api_key",
)


def _env_first(*names: str) -> str:
    for name in names:
        raw = os.getenv(name)
        if raw is None or not str(raw).strip():
            continue
        s = str(raw).strip()
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            s = s[1:-1].strip()
        return s
    return ""


def _parse_gemini_key_from_dotenv_file(path: Path) -> str:
    d = _parse_dotenv_file(path)
    for name in GEMINI_ENV_NAMES:
        val = d.get(name)
        if val and str(val).strip():
            return str(val).strip()
    return ""


def _is_google_gemini_api_key(key: str) -> bool:
    k = (key or "").strip()
    if not k or k.startswith("sk-or-"):
        return False
    return True


def get_gemini_api_key() -> str:
    """Google AI Studio / Gemini API key (``GEMINI_API_KEY``, ``GOOGLE_API_KEY``, etc.)."""
    load_dotenv(_ROOT / ".env", override=False)
    load_dotenv(_ROOT.parent / ".env", override=False)
    k = _env_first(*GEMINI_ENV_NAMES)
    if _is_google_gemini_api_key(k):
        return k
    parsed = _parse_gemini_key_from_dotenv_file(_ROOT / ".env") or _parse_gemini_key_from_dotenv_file(
        _ROOT.parent / ".env"
    )
    return parsed if _is_google_gemini_api_key(parsed) else ""


def get_openrouter_api_key() -> str:
    """OpenRouter API key (``OPENROUTER_API_KEY``). Used to reach Gemini via OpenRouter's
    OpenAI-compatible API. When set, it takes precedence over the native Gemini key."""
    load_dotenv(_ROOT / ".env", override=False)
    load_dotenv(_ROOT.parent / ".env", override=False)
    return _env_first("OPENROUTER_API_KEY", "openrouter_api_key")


def llm_uses_openrouter() -> bool:
    """True when an OpenRouter key is configured (preferred over native Gemini)."""
    return bool(get_openrouter_api_key())


def get_llm_api_key() -> str:
    """The active LLM key: OpenRouter when set, else the native Gemini (Google AI Studio) key."""
    return get_openrouter_api_key() or get_gemini_api_key()


def get_openrouter_key_in_env_hint() -> str:
    """Deprecated — OpenRouter is now a first-class provider. Always empty."""
    return ""


APIFY_TOKEN = _env_first("APIFY_TOKEN")

# ---------------------------------------------------------------------------
# Milestone 1 — how many leads end up in 1.xlsx and how strict selection is
# ---------------------------------------------------------------------------
# TARGET_LEAD_COUNT — Final row count written to ``1.xlsx`` (after dedupe, ICP filter, balance).
# LINKEDIN_LEAD_TARGET — Prefer at least this many rows whose ``source`` counts as LinkedIn-side
#   (job postings + profiles); see ``utils.identity.is_linkedin_source``.
# NON_LINKEDIN_LEAD_TARGET — Prefer at least this many rows from ThomasNet, ConstructConnect, etc.
# MIN_ICP_SCORE — Drop rows whose ICP score (0–10) is strictly below this before balancing.
# MIN_FACILITY_EXPANSION_COUNT — Try to keep at least this many rows with ``signal_category``
#   ``facility_expansion`` in the final file (if the pool has enough qualified rows).
# MIN_NEW_PRODUCT_DEVELOPMENT_COUNT — Same for ``new_product_development``.
# STRICT_FIFTY_FIFTY — If true, never pad with extra LinkedIn rows when non-LinkedIn pool is short
#   (honest 50/50 cap); if false, top-up with best remaining leads to reach TARGET_LEAD_COUNT.
def _int_env(name: str, default: str | int) -> int:
    """Read an integer setting that may arrive as a float string.

    The dashboard settings registry stores MIN_ICP_SCORE as a float and hands
    every value to the scraper subprocess through str(), so this module received
    "5.0" and `int("5.0")` raises. config.py is imported at the top of
    milestone1, so the scrape died at import — instantly, with stdout and stderr
    going to DEVNULL, on every scheduled run. Switching the scraper on produced
    a "Scrape started" event and then silence, and the account count never moved.

    Tolerant of "5", "5.0" and " 5 ", and falls back to the default rather than
    taking the whole pipeline down over one malformed setting.
    """
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return int(float(default))
    try:
        return int(float(str(raw).strip()))
    except (TypeError, ValueError):
        return int(float(default))

TARGET_LEAD_COUNT = _int_env("TARGET_LEAD_COUNT", "100")
LINKEDIN_LEAD_TARGET = _int_env("LINKEDIN_LEAD_TARGET", "50")
NON_LINKEDIN_LEAD_TARGET = _int_env("NON_LINKEDIN_LEAD_TARGET", "50")
MIN_ICP_SCORE = _int_env("MIN_ICP_SCORE", "5")
# Keep at least this many grant-funded (prevention_funding) rows in the final pool.
MIN_PREVENTION_FUNDING_COUNT = _int_env("MIN_PREVENTION_FUNDING_COUNT", "30")
# Legacy HVAC knobs (unused in the schools niche; kept for import compatibility).
MIN_FACILITY_EXPANSION_COUNT = _int_env("MIN_FACILITY_EXPANSION_COUNT", "0")
MIN_NEW_PRODUCT_DEVELOPMENT_COUNT = int(
    os.getenv("MIN_NEW_PRODUCT_DEVELOPMENT_COUNT", "0")
)

STRICT_FIFTY_FIFTY = os.getenv("STRICT_FIFTY_FIFTY", "true").lower() in (
    "1",
    "true",
    "yes",
)
# LEAD_EXCLUDE_COMPANIES — Comma-separated company names to block at scrape + cockpit display
# (merged into staffing-agency list; prefer LEAD_EXCLUDE_COMPETITORS / LEAD_EXCLUDE_PARTNERS).
LEAD_EXCLUDE_COMPANIES = os.getenv("LEAD_EXCLUDE_COMPANIES", "").strip()
# LEAD_EXCLUDE_COMPETITORS / LEAD_EXCLUDE_PARTNERS — Extra names merged with ``data/lead_exclusions.json``.
LEAD_EXCLUDE_COMPETITORS = os.getenv("LEAD_EXCLUDE_COMPETITORS", "").strip()
LEAD_EXCLUDE_PARTNERS = os.getenv("LEAD_EXCLUDE_PARTNERS", "").strip()
# LEAD_EXCLUSION_LIST_PATH — JSON file with competitor/partner/staffing name lists (see data/lead_exclusions.json).
LEAD_EXCLUSION_LIST_PATH = os.getenv("LEAD_EXCLUSION_LIST_PATH", "").strip()


def resolved_lead_exclusion_list_path() -> Path:
    raw = (LEAD_EXCLUSION_LIST_PATH or "").strip()
    if raw:
        p = Path(raw)
        return (p if p.is_absolute() else (_ROOT / p)).resolve()
    return (_ROOT / "data" / "lead_exclusions.json").resolve()

# --- ThomasNet (Apify scraper; not an official ThomasNet REST product) ---
# APIFY_THOMASNET_ACTOR — Apify actor id for supplier search.
# APIFY_THOMASNET_QUERIES — Comma-separated search strings (built-in defaults if empty).
# APIFY_THOMASNET_MAX_PER_QUERY — Max supplier rows to request **per query string** (Apify input).
# THOMASNET_SCRAPE_MODE — Passed through to the actor (e.g. ``all`` vs ``name``); depends on actor.
APIFY_THOMASNET_ACTOR = os.getenv(
    "APIFY_THOMASNET_ACTOR", "zen-studio/thomasnet-suppliers-scraper"
).strip()
APIFY_THOMASNET_QUERIES = os.getenv("APIFY_THOMASNET_QUERIES", "").strip()
APIFY_THOMASNET_MAX_PER_QUERY = _int_env("APIFY_THOMASNET_MAX_PER_QUERY", "40")
THOMASNET_SCRAPE_MODE = os.getenv("THOMASNET_SCRAPE_MODE", "all").strip()

# ---------------------------------------------------------------------------
# Milestone 1 — how hard each **fetch** hits external sites (before ICP / balance)
# ---------------------------------------------------------------------------
# LINKEDIN_JOBS_LIMIT_DEFAULT — For each **generic** job-title search listed in ``TARGET_JOB_TITLES``
#   (Mechanical Engineer, HVAC Engineer, …), this is the Apify actor ``limit``: max job postings
#   returned **per title, per run**. Higher = more Apify cost and slower runs.
# LINKEDIN_JOBS_LIMIT_TARGETED — Same idea for the smaller set of **signal-specific** title searches
#   in ``sources/linkedin_jobs`` (e.g. Plant Expansion PM, R&D Engineer); usually a larger cap.
# LINKEDIN_PROFILES_MAX_URLS — Max profile URLs scraped per run from ``APIFY_LINKEDIN_PROFILE_URLS``;
#   ``0`` means scrape every URL you listed.
# CONSTRUCTCONNECT_MAX_RECORDS / CIVCAST_MAX_RECORDS / DODGE_MAX_RECORDS / INDUSTRY_DB_MAX_RECORDS —
#   After that source returns rows, keep at most this many (``0`` = keep all returned).
LINKEDIN_JOBS_LIMIT_DEFAULT = max(1, _int_env("LINKEDIN_JOBS_LIMIT_DEFAULT", "20"))
LINKEDIN_JOBS_LIMIT_TARGETED = max(1, _int_env("LINKEDIN_JOBS_LIMIT_TARGETED", "45"))
LINKEDIN_PROFILES_MAX_URLS = _int_env("LINKEDIN_PROFILES_MAX_URLS", "0")
# LINKEDIN_RESOLVE_COMPANY_WEBSITE — After jobs/profile Apify runs, HTTP-fetch each distinct
#   ``linkedin.com/company/…`` page to extract the public corporate website (not the LI URL).
LINKEDIN_RESOLVE_COMPANY_WEBSITE = os.getenv("LINKEDIN_RESOLVE_COMPANY_WEBSITE", "true").lower() in (
    "1",
    "true",
    "yes",
)
# LINKEDIN_COMPANY_WEBSITE_DELAY_S — Pause between distinct company-page fetches (rate limit / politeness).
LINKEDIN_COMPANY_WEBSITE_DELAY_S = float(os.getenv("LINKEDIN_COMPANY_WEBSITE_DELAY_S", "0.35"))
# APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR — Optional Apify actor (e.g. ``scrapium/linkedin-company-profile-scraper``)
#   with input ``{"urls":["https://www.linkedin.com/company/…"]}`` returning a corporate ``website`` field.
#   Used when HTTP parsing does not extract a domain (recommended with Hunter.io when jobs only have LI URLs).
APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR = os.getenv("APIFY_LINKEDIN_COMPANY_WEBSITE_ACTOR", "").strip()
CONSTRUCTCONNECT_MAX_RECORDS = _int_env("CONSTRUCTCONNECT_MAX_RECORDS", "0")
CIVCAST_MAX_RECORDS = _int_env("CIVCAST_MAX_RECORDS", "0")
DODGE_MAX_RECORDS = _int_env("DODGE_MAX_RECORDS", "0")
INDUSTRY_DB_MAX_RECORDS = _int_env("INDUSTRY_DB_MAX_RECORDS", "0")

# --- Dodge Construction Network / ConstructConnect IO API ---
CONSTRUCTCONNECT_API_KEY = os.getenv("CONSTRUCTCONNECT_API_KEY", "").strip()
CONSTRUCTCONNECT_API_URL = os.getenv("CONSTRUCTCONNECT_API_URL", "").strip()

# --- CIVcast (vendor-specific; set URL + headers your account provides) ---
CIVCAST_API_URL = os.getenv("CIVCAST_API_URL", "").strip()
CIVCAST_HTTP_HEADERS_JSON = os.getenv("CIVCAST_HTTP_HEADERS_JSON", "").strip()

# --- Industry database (CSV path and/or JSON URL your org exposes) ---
INDUSTRY_LEADS_CSV = os.getenv("INDUSTRY_LEADS_CSV", "").strip()
INDUSTRY_LEADS_JSON_URL = os.getenv("INDUSTRY_LEADS_JSON_URL", "").strip()

# Manual JSON exports (optional fallbacks when no API URL is available)
DODGE_LEADS_JSON = os.getenv("DODGE_LEADS_JSON", "").strip()
CIVCAST_LEADS_JSON = os.getenv("CIVCAST_LEADS_JSON", "").strip()

TARGET_JOB_TITLES = [
    "Athletic Director",
    "Activities Director",
    "Prevention Program Manager",
    "Prevention Coordinator",
    "Student Assistance Coordinator",
    "Wellness Coordinator",
]

TARGET_INDUSTRIES = [
    "High School",
    "School District",
    "Prevention Coalition",
    "County Health",
    "Athletics",
]

# ICP_WEIGHT_* — Relative weights when averaging the four 0–10 sub-scores into ``icp_score``
#   (industry fit, signal strength, role relevance, company/context fit). Higher = that pillar
#   matters more in the final number; see ``scoring/icp.score_record``.
ICP_WEIGHT_INDUSTRY_FIT = float(os.getenv("ICP_WEIGHT_INDUSTRY_FIT", "1.0"))
ICP_WEIGHT_SIGNAL_STRENGTH = float(os.getenv("ICP_WEIGHT_SIGNAL_STRENGTH", "2.0"))
ICP_WEIGHT_ROLE_RELEVANCE = float(os.getenv("ICP_WEIGHT_ROLE_RELEVANCE", "1.0"))
ICP_WEIGHT_COMPANY_FIT = float(os.getenv("ICP_WEIGHT_COMPANY_FIT", "1.0"))

# --- Milestone 2 — outreach, research, Instantly (see ``main.py`` commands) ---
GEMINI_API_KEY = _env_first(*GEMINI_ENV_NAMES)  # static load; use get_gemini_api_key() when in doubt
# Native Gemini API model id (not an OpenRouter slug). Override via ``GEMINI_MODEL`` in ``.env``.
_raw_gemini_model = (os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite") or "gemini-2.5-flash-lite").strip()
GEMINI_MODEL = _raw_gemini_model.split("/", 1)[-1] if _raw_gemini_model.startswith("google/") else _raw_gemini_model
# OpenRouter (OpenAI-compatible) — used to reach Gemini when OPENROUTER_API_KEY is set.
OPENROUTER_API_BASE = (os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1") or "https://openrouter.ai/api/v1").strip().rstrip("/")
# OpenRouter model slug. Empty default → derive ``google/<GEMINI_MODEL>`` so it tracks GEMINI_MODEL.
# Override with e.g. ``OPENROUTER_MODEL=google/gemini-2.5-flash`` in ``.env``.
OPENROUTER_MODEL = (os.getenv("OPENROUTER_MODEL", "") or "").strip()
INSTANTLY_API_KEY = os.getenv("INSTANTLY_API_KEY", "").strip()
INSTANTLY_API_BASE = os.getenv("INSTANTLY_API_BASE", "https://api.instantly.ai").strip().rstrip("/")
# Existing Instantly campaign UUID (create in UI; sequence steps use {{m2_stepN_*}} custom vars).
MILESTONE2_INSTANTLY_CAMPAIGN_ID = os.getenv("MILESTONE2_INSTANTLY_CAMPAIGN_ID", "").strip()
# MILESTONE2_LEADS_XLSX — Optional path to input sheet; default is project-root ``1.xlsx``.
MILESTONE2_LEADS_XLSX = os.getenv("MILESTONE2_LEADS_XLSX", "").strip()


def resolved_leads_xlsx_path() -> Path:
    """Absolute path to the Milestone leads workbook (project-root-relative if env is relative)."""
    raw = (MILESTONE2_LEADS_XLSX or "").strip()
    if raw:
        p = Path(raw)
        return (p if p.is_absolute() else (_ROOT / p)).resolve()
    return (_ROOT / "1.xlsx").resolve()
# MILESTONE2_MAX_LEADS — Cap rows processed from the spreadsheet for M2 steps.
# MILESTONE2_MIN_LEADS — Warn when fewer than this many rows have a usable ``email`` column.
# MILESTONE2_SEQUENCE_STEPS — Number of email steps in generated sequences.
# MILESTONE2_FOLLOWUP_GAP_DAYS — Comma-separated day gaps between steps (length = steps − 1).
# MILESTONE2_SEND — When true and Instantly keys are set, push leads to Instantly (live send path).
MILESTONE2_MAX_LEADS = _int_env("MILESTONE2_MAX_LEADS", "100")
MILESTONE2_MIN_LEADS = _int_env("MILESTONE2_MIN_LEADS", "50")
MILESTONE2_SEQUENCE_STEPS = _int_env("MILESTONE2_SEQUENCE_STEPS", "3")
MILESTONE2_FOLLOWUP_GAP_DAYS = os.getenv("MILESTONE2_FOLLOWUP_GAP_DAYS", "3,5").strip()
MILESTONE2_SEND = os.getenv("MILESTONE2_SEND", "").lower() in ("1", "true", "yes")
# Shown in copy + From display name; use dedicated outreach subdomain in production DNS.
OUTREACH_SUBDOMAIN = os.getenv("OUTREACH_SUBDOMAIN", "").strip()
OUTREACH_SENDER_NAME = os.getenv("OUTREACH_SENDER_NAME", "HVAC outreach").strip()
OUTREACH_FROM_EMAIL = os.getenv("OUTREACH_FROM_EMAIL", "").strip()
OUTREACH_FROM_NAME = os.getenv("OUTREACH_FROM_NAME", "").strip()
OUTREACH_SMTP_HOST = os.getenv("OUTREACH_SMTP_HOST", "").strip()
OUTREACH_SMTP_PORT = _int_env("OUTREACH_SMTP_PORT", "587")
# When true (or port 465) use implicit TLS (SMTP_SSL) instead of STARTTLS.
OUTREACH_SMTP_SSL = os.getenv("OUTREACH_SMTP_SSL", "").lower() in ("1", "true", "yes") or OUTREACH_SMTP_PORT == 465
OUTREACH_SMTP_USER = os.getenv("OUTREACH_SMTP_USER", "").strip()
OUTREACH_SMTP_PASSWORD = os.getenv("OUTREACH_SMTP_PASSWORD", "").strip()
# IMAP for the in-app inbox (defaults to the SMTP host on the standard SSL port).
OUTREACH_IMAP_HOST = os.getenv("OUTREACH_IMAP_HOST", "").strip() or OUTREACH_SMTP_HOST
OUTREACH_IMAP_PORT = _int_env("OUTREACH_IMAP_PORT", "993")
# Reputation guards: minimum seconds between consecutive sends (smooths bursts,
# mainly when several follow-ups come due at once) and a rolling-24h send cap.
# Set the cap to 0 to disable it.
OUTREACH_SEND_MIN_GAP_SEC = _int_env("OUTREACH_SEND_MIN_GAP_SEC", "45")
OUTREACH_DAILY_SEND_CAP = _int_env("OUTREACH_DAILY_SEND_CAP", "40")
# Public base URL that recipients' mail apps / browsers hit for open-pixel and
# click-redirect tracking. MUST be internet-reachable and, for deliverability,
# on the sending domain (nginx proxies /t/ -> this API). Empty disables tracking.
OUTREACH_TRACK_BASE_URL = (os.getenv("OUTREACH_TRACK_BASE_URL", "").strip().rstrip("/"))

# --- OpenAI (email drafting only; research stays on OpenRouter/Gemini) ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_API_BASE = (os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1") or "https://api.openai.com/v1").strip().rstrip("/")


def _normalize_openai_model(raw: str) -> str:
    """Map loose names like 'GPT-5.4 mini' to the API id 'gpt-5.4-mini'."""
    m = (raw or "").strip().lower().replace(" ", "-")
    while "--" in m:
        m = m.replace("--", "-")
    return m or "gpt-5.4-mini"


OPENAI_MODEL = _normalize_openai_model(os.getenv("OPENAI_MODEL", "gpt-5.4-mini"))


def get_openai_api_key() -> str:
    return _env_first("OPENAI_API_KEY", "openai_api_key") or OPENAI_API_KEY
MILESTONE2_DB_PATH = os.getenv(
    "MILESTONE2_DB_PATH",
    str(_ROOT / "outreach_data" / "milestone2.sqlite"),
).strip()
MILESTONE2_DRAFTS_DIR = os.getenv(
    "MILESTONE2_DRAFTS_DIR",
    str(_ROOT / "outreach_data" / "drafts"),
).strip()


def resolved_milestone2_db_path() -> Path:
    """Absolute path to Milestone 2 outreach SQLite (project-root-relative if env is relative)."""
    raw = (MILESTONE2_DB_PATH or "").strip()
    if not raw:
        return (_ROOT / "outreach_data" / "milestone2.sqlite").resolve()
    p = Path(raw)
    return (p if p.is_absolute() else (_ROOT / p)).resolve()


MILESTONE2_DASHBOARD_BIND = os.getenv("MILESTONE2_DASHBOARD_BIND", "127.0.0.1").strip()
MILESTONE2_DASHBOARD_PORT = _int_env("MILESTONE2_DASHBOARD_PORT", "8765")

# Postgres connection (cockpit accounts/contacts/email + Milestone 2 leads/events all
# live in this one database now). Required at runtime; the old *_DB_PATH constants below
# are kept only for the one-time SQLite -> Postgres importer (scripts/sqlite_to_pg.py).
DATABASE_URL = (os.getenv("DATABASE_URL") or os.getenv("DATABASE_URL_UNPOOLED") or "").strip()

# Cockpit (React frontend + API)
COCKPIT_DB_PATH = os.getenv("COCKPIT_DB_PATH", str(_ROOT / "outreach_data" / "cockpit.sqlite")).strip()
COCKPIT_API_BIND = os.getenv("COCKPIT_API_BIND", "127.0.0.1").strip()
# COCKPIT_API_PORT wins; else PORT (common with ngrok: `ngrok http 5000` + PORT=5000).
_COCKPIT_PORT_RAW = (os.getenv("COCKPIT_API_PORT") or os.getenv("PORT") or "8787").strip()
COCKPIT_API_PORT = int(_COCKPIT_PORT_RAW)
COCKPIT_API_RELOAD = os.getenv("COCKPIT_API_RELOAD", "true").lower() in ("1", "true", "yes")
# Comma-separated browser origins for CORS (local Vite + Vercel preview/production, etc.).
_COCKPIT_UI_ORIGINS_RAW = os.getenv(
    "COCKPIT_UI_ORIGIN",
    "http://127.0.0.1:5173,http://localhost:5173",
).strip()
COCKPIT_ALLOWED_ORIGINS: list[str] = [o.strip() for o in _COCKPIT_UI_ORIGINS_RAW.split(",") if o.strip()]
if not COCKPIT_ALLOWED_ORIGINS:
    COCKPIT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"]
# Optional: regex so Vercel previews work without listing each URL (e.g. https://.*\.vercel\.app).
_raw_cors_regex = (os.getenv("COCKPIT_CORS_ORIGIN_REGEX", "") or "").strip()
# When unset, allow common dev tunnels (ngrok, Cloudflare) + any localhost port so OPTIONS preflight
# does not return 400. Set COCKPIT_CORS_TUNNEL_DEFAULT=false to disable this default regex.
_tunnel_cors_default = os.getenv("COCKPIT_CORS_TUNNEL_DEFAULT", "true").lower() in ("1", "true", "yes")
if _raw_cors_regex:
    COCKPIT_CORS_ORIGIN_REGEX: str | None = _raw_cors_regex
elif _tunnel_cors_default:
    COCKPIT_CORS_ORIGIN_REGEX = (
        r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
        r"|https?://[a-zA-Z0-9][a-zA-Z0-9\-]*\.(ngrok-free\.app|ngrok\.io|ngrok\.app)(:\d+)?"
        r"|https?://[a-zA-Z0-9][a-zA-Z0-9\-]*\.trycloudflare\.com(:\d+)?"
        r"|https://[a-zA-Z0-9][a-zA-Z0-9\-]*\.vercel\.app(:\d+)?"
    )
else:
    COCKPIT_CORS_ORIGIN_REGEX = None
COCKPIT_ADMIN_EMAIL = os.getenv("COCKPIT_ADMIN_EMAIL", "admin@local").strip()
COCKPIT_ADMIN_PASSWORD = os.getenv("COCKPIT_ADMIN_PASSWORD", "changeme123").strip()
COCKPIT_SESSION_DAYS = max(1, _int_env("COCKPIT_SESSION_DAYS", "7"))

# MILESTONE2_RESEARCH_FORCE — Re-run Gemini company research even when cells already filled.
# MILESTONE2_RESEARCH_MAX_API_CALLS — Max paid research calls per run (``0`` = unlimited).
# MILESTONE2_RESEARCH_CONCURRENCY — Parallel Gemini requests.
# MILESTONE2_RESEARCH_SHARE_BY_COMPANY — If true (default), one Gemini call per company+website fan-out
#   to all matching rows (cheaper). If false, each sheet row gets its own call (full per-lead copy).
MILESTONE2_RESEARCH_BEFORE_OUTREACH = os.getenv(
    "MILESTONE2_RESEARCH_BEFORE_OUTREACH", "true"
).lower() in ("1", "true", "yes")
MILESTONE2_RESEARCH_SHARE_BY_COMPANY = os.getenv(
    "MILESTONE2_RESEARCH_SHARE_BY_COMPANY", "true"
).lower() in ("1", "true", "yes")
MILESTONE2_RESEARCH_FORCE = os.getenv("MILESTONE2_RESEARCH_FORCE", "").lower() in (
    "1",
    "true",
    "yes",
)
MILESTONE2_RESEARCH_MAX_API_CALLS = _int_env("MILESTONE2_RESEARCH_MAX_API_CALLS", "0")
MILESTONE2_RESEARCH_CONCURRENCY = max(
    1, _int_env("MILESTONE2_RESEARCH_CONCURRENCY", "2")
)
MILESTONE2_RESEARCH_GAP_SEC = float(os.getenv("MILESTONE2_RESEARCH_GAP_SEC", "0.35"))

# Hunter.io — Milestone 2 email finder + verification (https://api.hunter.io)
# When a lead has no ``email``, Email Finder requires non-empty ``person_name`` plus a corporate
# ``website`` host (derived mail domain). Verifier-only path only needs ``email``.
HUNTER_API_KEY = _env_first("HUNTER_API_KEY", "hunter_api_key")


def get_hunter_api_key() -> str:
    load_dotenv(_ROOT / ".env", override=True)
    load_dotenv(_ROOT.parent / ".env", override=True)
    return _env_first("HUNTER_API_KEY", "hunter_api_key")


# Maximum rows Hunter runs on per enrichment (finder+verify each); ``0`` = all capped leads.
MILESTONE2_HUNTER_MAX_ROWS = _int_env("MILESTONE2_HUNTER_MAX_ROWS", "0")
# Hunter returns HTTP 403 when rate limits are exceeded — keep concurrency low (default 1).
MILESTONE2_HUNTER_CONCURRENCY = max(1, _int_env("MILESTONE2_HUNTER_CONCURRENCY", "1"))
MILESTONE2_HUNTER_GAP_SEC = float(os.getenv("MILESTONE2_HUNTER_GAP_SEC", "0.15"))
# When Email Finder returns nothing, call Domain Search and match ``person_name`` (uses extra Hunter credits).
MILESTONE2_HUNTER_DOMAIN_SEARCH = os.getenv(
    "MILESTONE2_HUNTER_DOMAIN_SEARCH", "true"
).lower() in ("1", "true", "yes")
MILESTONE2_HUNTER_DOMAIN_SEARCH_LIMIT = int(
    os.getenv("MILESTONE2_HUNTER_DOMAIN_SEARCH_LIMIT", "15")
)
MILESTONE2_HUNTER_MIN_DELIVERABILITY = _int_env("MILESTONE2_HUNTER_MIN_DELIVERABILITY", "50")
MILESTONE2_VERIFICATION_REPORT_PATH = os.getenv(
    "MILESTONE2_VERIFICATION_REPORT_PATH",
    str(_ROOT / "outreach_data" / "email_verification_report.json"),
).strip()
# Ask Instantly to verify leads on import (in addition to Hunter pre-check).
INSTANTLY_VERIFY_LEADS_ON_IMPORT = os.getenv(
    "INSTANTLY_VERIFY_LEADS_ON_IMPORT", ""
).lower() in ("1", "true", "yes")
# Contract: no live send without explicit client sign-off in env.
MILESTONE2_CLIENT_APPROVED = os.getenv("MILESTONE2_CLIENT_APPROVED", "").lower() in (
    "1",
    "true",
    "yes",
)
MILESTONE2_SEND_REQUIRES_CLIENT_APPROVAL = os.getenv(
    "MILESTONE2_SEND_REQUIRES_CLIENT_APPROVAL", "true"
).lower() in ("1", "true", "yes")
# When true, only push leads that Hunter marked deliverable with score ≥ min.
MILESTONE2_SEND_REQUIRES_HUNTER_OK = os.getenv(
    "MILESTONE2_SEND_REQUIRES_HUNTER_OK", ""
).lower() in ("1", "true", "yes")
