"""
Ported from the n8n workflow
  /root/upwork-scraper/Upwork_Lead_Extraction_Custom_Scraper_UPDATED.json

n8n DAG:
  Get Next Keyword → Call Scraper → Process Scraper Response →
  Prepare Gemini Request → Extract Contact Info with Gemini →
  Process Extracted Lead Data → Filter Valid Leads → Save to Master Sheet
  → Advance Keyword → Check Cycle Complete → Wait Between Cycles → loop

Here the loop lives in this process. Each cycle:
  1. Refresh cookies from the CRM (one shared session for all workers)
  2. Fan out ALL keywords across MAX_PARALLEL_KEYWORDS worker threads
  3. Each worker scrapes its keyword via the local Flask service (the
     service caps actual browser concurrency at MAX_CONCURRENT_SCRAPES via
     a BoundedSemaphore — excess workers block on the permit)
  4. For each scrape result: Gemini-extract firstName/lastName/companyName,
     enrich, keep only valid leads, POST to /api/ingest/upwork, emit
     lifecycle events
  5. After all workers join, sleep WAIT_SECONDS and start the next cycle

Env vars:
  NEXTCRM_URL       Base URL of the CRM (Vercel or cloudflared tunnel)
  SCRAPER_API_KEY   Shared secret — must match CRM's SCRAPER_API_KEY
  SEARCH_QUERIES    Comma-separated keywords to rotate through
                    (default — client-revised May 2026:
                     'Pitch Decks,Explainer videos,eBooks,Presentations,Brochures,Graphic designs')
  LIMIT             Jobs per keyword per tick (n8n used 10; default 10)
  WAIT_SECONDS      Seconds to wait between keywords (n8n used 30; default 30)
  REQUEST_TIMEOUT   Seconds to wait on the local scraper (default 1500)
  GEMINI_API_KEY    Google AI API key. If unset, enrichment is skipped and
                    leads pass through raw (everyone treated as "Not Found").
  GEMINI_MODEL      default: gemini-flash-lite-latest (matches n8n)
  OPENROUTER_API_KEY  Backup LLM key. When the direct Gemini call fails
                      (most commonly: project-level ban or quota exhaustion
                      on the Google free tier — see May 2026 incident), the
                      pusher falls through to OpenRouter. ONLY Gemini models
                      are accepted (OPENROUTER_MODEL must start with
                      "google/") — this is enforced in code so a misconfig
                      can't silently start spending on OpenAI/Anthropic.
  OPENROUTER_MODEL  default: google/gemini-3.1-flash-lite ($0.25/M in,
                    $1.50/M out — cheapest current Gemini on OpenRouter).
"""

import json
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s pusher - %(message)s",
)
log = logging.getLogger("pusher")

SCRAPER_URL = "http://127.0.0.1:5007"
NEXTCRM_URL = os.getenv("NEXTCRM_URL", "").rstrip("/")
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
LIMIT = int(os.getenv("LIMIT", "20"))
# Cooldown between full cycles (was: between sequential keywords). With
# parallel keyword fan-out, each cycle is ALL keywords at once, so this
# is no longer per-keyword latency but rather throttling on the upstream
# (Upwork) — short, since each cycle already takes minutes by virtue of
# the per-keyword Cloudflare/detail-page work.
WAIT_SECONDS = max(0, int(os.getenv("WAIT_SECONDS", "10")))
# Number of keywords to scrape concurrently. Bounded by the scraper
# service's MAX_CONCURRENT_SCRAPES (defaults to 3) — set both in lockstep.
# Going higher than ~3 risks tripping Upwork Cloudflare from one IP and
# OOMing the 4GB container (each Camoufox is ~500MB).
MAX_PARALLEL_KEYWORDS = int(os.getenv("MAX_PARALLEL_KEYWORDS", "3"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "1500"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
# Fallback LLM via OpenRouter — Gemini-only (enforced in code). Activated
# when the direct Gemini call fails (project ban, quota, network). Default
# is gemini-3.1-flash-lite, the cheapest Gemini on OpenRouter at ship time.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-3.1-flash-lite")

# Client-revised keyword list (May 2026): Infographics→Brochures,
# Animations→Graphic designs (client: low-volume / off-target keywords
# swapped for ones closer to what we actually sell). The operative runtime
# list is the SEARCH_QUERIES env var on the VPS; this default is kept in
# sync so a fresh deploy without that env still scrapes the right list.
DEFAULT_KEYWORDS = [
    "Pitch Decks",
    "Explainer videos",
    "eBooks",
    "Presentations",
    "Brochures",
    "Graphic designs",
]
_raw_queries = os.getenv("SEARCH_QUERIES", "").strip()
KEYWORDS = (
    [q.strip() for q in _raw_queries.split(",") if q.strip()]
    if _raw_queries
    else DEFAULT_KEYWORDS
)

# NOTE: pre-parallel versions of this file persisted a `keywordIndex` to
# /app/state.json so a restarted container could resume mid-rotation. With
# the parallel fan-out (Apr 2026) every cycle scrapes ALL keywords at once,
# so there's no cursor to persist. State file removed entirely.


# ---------------------------------------------------------------------------
# service-category mapping (ported from "Process Extracted Lead Data" node)
# ---------------------------------------------------------------------------

def service_category_for(keyword: str) -> str:
    k = keyword.lower()
    if "animation" in k:
        return "Animation"
    if "brochure" in k:
        return "Brochures"
    if "ebook" in k:
        return "Ebooks"
    if "video" in k:
        return "Video_Reels"
    if "infographic" in k:
        return "Infographics"
    if "pitch deck" in k:
        return "Pitch_Decks"
    if "whitepaper" in k or "white paper" in k:
        return "Whitepaper"
    if "social media" in k:
        return "Social_Media"
    if "website" in k or "web design" in k:
        return "Website_Design"
    if "presentation" in k:
        return "Presentations"
    if "explainer" in k:
        return "Explainer_Videos"
    return "Other"


# ---------------------------------------------------------------------------
# Gemini contact-info extraction (ported from "Prepare Gemini Request" node)
# ---------------------------------------------------------------------------

def build_gemini_prompt(job: dict) -> str:
    title = (job.get("title") or "").replace("\n", " ").replace("\r", " ")
    description = (job.get("description") or job.get("job_description") or "").replace("\n", " ").replace("\r", " ")
    location = (job.get("clientLocation") or "").replace("\n", " ").replace("\r", " ")
    client_info = job.get("client_info") or {}
    client_company = (client_info.get("client_company") or "").replace("\n", " ").replace("\r", " ")
    job_history = client_info.get("job_history") or []
    history_ctx = ""
    if job_history:
        # Upwork field semantics (confusing, document it):
        #   client_feedback     = what the FREELANCER wrote ABOUT the client
        #                         → often names the client ("Bilal was easy to work with")
        #   freelancer_feedback = what the CLIENT wrote ABOUT the freelancer
        #                         → names the freelancer, NOT the client we want
        # We label them by who-wrote-what-about-whom so the model isn't confused.
        parts = []
        for i, hj in enumerate(job_history):
            hj_title = (hj.get("title") or "Untitled").replace("\n", " ").replace("\r", " ")
            review_of_client = (hj.get("client_feedback") or "").replace("\n", " ").replace("\r", " ")
            review_of_freelancer = (hj.get("freelancer_feedback") or "").replace("\n", " ").replace("\r", " ")
            line = f"Past job {i + 1}: \"{hj_title}\""
            if review_of_client:
                line += f'\n    Freelancer\'s review of the CLIENT: "{review_of_client}"'
            if review_of_freelancer:
                line += f'\n    Client\'s review of the freelancer: "{review_of_freelancer}"'
            parts.append(line)
        history_ctx = "\n".join(parts)

    return (
        "You extract the CLIENT's contact info from an Upwork job posting.\n"
        "The CLIENT is the buyer who posted this job. We want the client's first name, last name, and company.\n\n"
        "WHERE TO LOOK (in order of reliability):\n"
        "1. \"Freelancer's review of the CLIENT\" lines in the client's past job history. "
        "Freelancers often name the client by first name "
        "(e.g. \"<NAME> was easy to work with\", \"<NAME> is a clear communicator\", "
        "\"Working with <NAME> was a pleasure\"). "
        "If you see ANY first name appear in these client-side reviews, that is the client's first name.\n"
        "2. The job description — sometimes the client signs off (\"- <NAME>, CEO\") or "
        "introduces themselves (\"I'm <NAME>, owner of ...\").\n"
        "3. The company-name field if explicitly provided.\n\n"
        "DO NOT confuse names:\n"
        "- The freelancer's name appears in \"Client's review of the freelancer\" lines. IGNORE those for client identity.\n"
        "- The reviewer (the freelancer who wrote a review of the client) signs with their own initials; that's the freelancer, not the client.\n\n"
        "If a value cannot be found, return \"Not Found\".\n\n"
        "Respond ONLY in this exact JSON format with no surrounding text or code fences:\n"
        "{\n"
        '  "firstName": "value or Not Found",\n'
        '  "lastName": "value or Not Found",\n'
        '  "companyName": "value or Not Found"\n'
        "}\n\n"
        f"Job Title: {title}\n"
        f"Job Description: {description}\n"
        f"Client Location: {location}\n"
        + (f"Client Company (from sidebar): {client_company}\n" if client_company else "")
        + (
            f"\nClient's past job history (scan EVERY \"Freelancer's review of the CLIENT\" for the client's first name):\n{history_ctx}\n"
            if history_ctx
            else ""
        )
        + "\nExtract the information now:"
    )


_CONTACT_NOT_FOUND = {
    "firstName": "Not Found",
    "lastName": "Not Found",
    "companyName": "Not Found",
}

# Reject obvious placeholder/garbage tokens that Gemini sometimes emits
# instead of following the "return Not Found" instruction. Keep in sync
# with apps/web/lib/sanitize-name.ts — a "Person" leaking through here
# becomes a permanent fake lastName on the lead (the upsert never
# overwrites lastName, and enrichment only fills when empty).
_PLACEHOLDER_NAME_TOKENS = {
    # Generic
    "person", "user", "anonymous", "anon", "unknown", "none",
    "n/a", "na", "null", "undefined",
    "not found", "notfound", "not available",
    "tbd", "to be determined",
    # Role labels
    "client", "freelancer", "customer", "buyer", "seller",
    "vendor", "contractor", "employer",
    # Field labels the LLM might echo back as a value
    "name", "first name", "last name", "full name",
    "firstname", "lastname", "fullname",
    "company", "company name", "companyname",
    # Test / example
    "test", "example", "sample", "demo", "placeholder",
}


def _sanitize_name(v) -> "str | None":
    """Return v trimmed, or None if v is empty / a known placeholder token."""
    if v is None or not isinstance(v, str):
        return None
    t = v.strip()
    if not t:
        return None
    if t.lower() in _PLACEHOLDER_NAME_TOKENS:
        return None
    return t


def _parse_contact_response(text: str) -> dict:
    """Coerce an LLM response into the contact dict. Tolerates ```json fences
    and partial JSON. Always returns a 3-key dict (Not Found defaults)."""
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        m = re.search(r"\{[^{}]+\}", cleaned, re.DOTALL)
        if not m:
            return dict(_CONTACT_NOT_FOUND)
        try:
            parsed = json.loads(m.group(0))
        except Exception:
            return dict(_CONTACT_NOT_FOUND)

    return {
        "firstName": _sanitize_name(parsed.get("firstName")) or "Not Found",
        "lastName": _sanitize_name(parsed.get("lastName")) or "Not Found",
        "companyName": _sanitize_name(parsed.get("companyName")) or "Not Found",
    }


def _call_gemini_direct(prompt: str) -> str:
    """Direct call to Google's Gemini REST API. Returns response text or
    raises on HTTP/parse failure."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    resp = requests.post(
        url,
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
        or "{}"
    )


def _call_openrouter_gemini(prompt: str) -> str:
    """Fallback via OpenRouter's OpenAI-compatible chat API.

    Hard-enforces a google/* model: misconfiguring OPENROUTER_MODEL to
    e.g. anthropic/* or openai/* would silently bill the wrong provider,
    which contradicts the "only use Gemini" decision. Raises rather than
    silently swapping models.

    Cost knobs:
      * reasoning.effort=minimal — Gemini 3 reasoning tokens otherwise
        consume the max_tokens budget before any visible output is emitted
        (caught this on a max_tokens=10 test against 3.1-pro-preview).
      * service_tier=flex — OpenRouter passes this through to Google's
        Flex tier for ~50% discount in exchange for higher latency. The
        actual served tier is echoed back in the response (we don't read
        it; just a billing hint).
    """
    if not OPENROUTER_MODEL.startswith("google/"):
        raise RuntimeError(
            f"OPENROUTER_MODEL must be a Gemini model (google/*); got "
            f"{OPENROUTER_MODEL!r}"
        )
    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/afhm/nuraview-scraper",
            "X-Title": "nuraview-scraper",
        },
        json={
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 256,
            "reasoning": {"effort": "minimal"},
            "service_tier": "flex",
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"openrouter: empty choices payload: {data!r}")
    return (choices[0].get("message") or {}).get("content") or "{}"


def gemini_extract_contact(job: dict) -> dict:
    """Extract {firstName, lastName, companyName} via OpenRouter (Gemini models only).

    Ops decision (2026-06-01): use OpenRouter EXCLUSIVELY — nothing else.
    The direct Google AI Studio free-tier key (gemini-flash-lite-latest) is
    capped at ~500 req/day and 429'd continuously under our volume (1846
    failed calls on 2026-06-01 alone), so trying it first only wasted a
    round-trip before falling through to OpenRouter anyway. The direct path
    is gone; OpenRouter is the single source of truth for name extraction.
    Never raises; returns Not Found defaults if OpenRouter fails or no key."""
    if not OPENROUTER_API_KEY:
        return dict(_CONTACT_NOT_FOUND)
    prompt = build_gemini_prompt(job)

    try:
        text = _call_openrouter_gemini(prompt)
    except Exception as e:
        log.warning("OpenRouter extraction failed: %s", e)
        return dict(_CONTACT_NOT_FOUND)

    return _parse_contact_response(text)


# ---------------------------------------------------------------------------
# lead enrichment (ported from "Process Extracted Lead Data" node)
# ---------------------------------------------------------------------------

def _to_ist_locale(iso_like: Optional[str]) -> str:
    if not iso_like or iso_like in {"N/A", "Not Found"}:
        return iso_like or ""
    try:
        dt = datetime.fromisoformat(iso_like.replace("Z", "+00:00"))
        # Convert to IST (+05:30)
        from datetime import timedelta
        ist = dt.astimezone(timezone(timedelta(hours=5, minutes=30)))
        return ist.strftime("%d/%m/%Y, %H:%M")
    except Exception:
        return iso_like


def enrich_lead(job: dict, extracted: dict, keyword: str) -> dict:
    client_info = job.get("client_info") or {}
    job_history = client_info.get("job_history") or []

    # metrics
    jobs_completed = len(job_history)
    total_spent = 0.0
    rating_sum = 0.0
    for hj in job_history:
        billed = str(hj.get("total_billed") or hj.get("price") or "0")
        total_spent += float(re.sub(r"[^0-9.]", "", billed) or 0)
        try:
            rating_sum += float(hj.get("client_rating") or 0)
        except Exception:
            pass
    avg_rating = (rating_sum / jobs_completed) if jobs_completed else 0

    def job_at(i):
        return job_history[i] if i < len(job_history) else {}

    return {
        # core
        "upworkLink": job.get("job_url") or job.get("url") or "Not Found",
        "job_id": job.get("job_id") or "Not Found",
        "firstName": extracted.get("firstName") or "Not Found",
        "lastName": extracted.get("lastName") or "Not Found",
        "companyName": extracted.get("companyName") or "Not Found",
        "location": job.get("clientLocation") or "Not Found",
        "jobTitle": job.get("job_title") or job.get("title") or "",
        "job_description": job.get("job_description") or job.get("description") or "",
        # budget
        "budget_raw": job.get("budget_raw") or job.get("budget") or "N/A",
        "budget_min": job.get("budget_min"),
        "budget_max": job.get("budget_max"),
        # dates
        "posted_at": job.get("posted_at") or job.get("relativeDate") or "",
        "scraped_at": job.get("scraped_at") or datetime.now(timezone.utc).isoformat(),
        "extractedAt": _to_ist_locale(datetime.now(timezone.utc).isoformat()),
        # classification
        "keyword": keyword,
        "serviceCategory": service_category_for(keyword),
        "scrape_status": job.get("scrape_status") or "success",
        "lead_quality_score": job.get("lead_quality_score"),
        # client intel
        "client_total_jobs_posted": client_info.get("jobs_posted") or "Unknown",
        "client_payment_verified": client_info.get("payment_verified") or False,
        "client_rating": client_info.get("rating") or "N/A",
        "client_review_count": client_info.get("review_count") or "0",
        "client_location": client_info.get("location") or job.get("clientLocation") or "Not Found",
        # City/town + the buyer's LOCAL TIME (e.g. "Evesham Township",
        # "11:44 AM"). client_location is only the country; the reviewer
        # wants the town and what time it is there before calling.
        "client_city": client_info.get("city") or "",
        "client_local_time": client_info.get("local_time") or "",
        # client intel — new fields surfaced from the redesigned About-the-client
        # section (early May 2026). Reviewers see industry / hires / hours in
        # the sidebar even when rating/review aren't populated yet.
        "client_industry": client_info.get("industry") or "",
        "client_company_size": client_info.get("company_size") or "",
        "client_hires": client_info.get("hires") or "",
        "client_hires_text": client_info.get("hires_text") or "",
        "client_hours": client_info.get("hours") or "",
        "client_hours_text": client_info.get("hours_text") or "",
        "client_total_spent_label": client_info.get("total_spent") or "",
        "client_member_since": client_info.get("member_since") or "",
        # calculated
        "client_jobs_completed": jobs_completed,
        "client_total_spent": f"{total_spent:.2f}",
        "client_avg_rating": f"{avg_rating:.1f}",
        # top 3 recent
        **{
            f"recent_job_{i + 1}_title": job_at(i).get("title") or ""
            for i in range(3)
        },
        **{
            f"recent_job_{i + 1}_rating": job_at(i).get("client_rating") or ""
            for i in range(3)
        },
        **{
            f"recent_job_{i + 1}_spent": job_at(i).get("total_billed") or job_at(i).get("price") or ""
            for i in range(3)
        },
        "client_job_history_full": json.dumps(job_history),
        "skills": json.dumps(job.get("skills") or []),
        "deliverables": json.dumps(job.get("deliverables") or []),
    }


def is_valid_lead(lead: dict) -> bool:
    # A lead is "valid" (worth forwarding to the CRM) if EITHER:
    #
    #   1. Gemini extracted at least one of firstName/lastName/companyName, OR
    #   2. The Upwork page itself yielded enough client signal that the lead
    #      is worth keeping even without Gemini-derived names.
    #
    # The original (n8n-ported) filter was rule 1 only. That meant whenever
    # Gemini's free-tier quota tripped (500 RPD on gemini-3.1-flash-lite),
    # EVERY scraped lead was dropped — even pages where the scraper had
    # successfully extracted ratings, hires, hours, total_spent, AND a full
    # job_history (sometimes 20+ past jobs). All that rich data went straight
    # to /dev/null. The CRM has its own enrichment pipeline (lead-waterfall)
    # that fills firstName/lastName/companyName/email later from LinkedIn +
    # email-finder providers, so we shouldn't strand a perfectly enriched
    # lead just because the name extractor was rate-limited.
    if any((lead.get(k) or "Not Found") != "Not Found"
           for k in ("firstName", "lastName", "companyName")):
        return True
    # Strong client-side signal: a populated job history means the page
    # rendered in logged-in mode and we have substantive intel.
    try:
        jh = json.loads(lead.get("client_job_history_full") or "[]")
        if isinstance(jh, list) and len(jh) > 0:
            return True
    except Exception:
        pass
    # Fallback signal cluster — at least 2 of these populated indicates a
    # logged-in page with real client data, not just placeholder shell.
    score = 0
    if (lead.get("client_rating") or "N/A") not in ("N/A", "", "0"):
        score += 1
    if (lead.get("client_total_spent_label") or "").strip():
        score += 1
    if (lead.get("client_industry") or "").strip():
        score += 1
    if (lead.get("client_hires") or "").strip():
        score += 1
    if (lead.get("client_hours") or "").strip():
        score += 1
    member_since = (lead.get("client_member_since") or "").strip().lower()
    if member_since.startswith("member since"):
        score += 1
    return score >= 2


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {SCRAPER_API_KEY}"}


def _post_event(payload: dict) -> None:
    if not NEXTCRM_URL or not SCRAPER_API_KEY:
        return
    try:
        requests.post(
            f"{NEXTCRM_URL}/api/ingest/scraper-event",
            json=payload,
            headers=_auth_headers(),
            timeout=5,
        )
    except Exception as e:
        log.debug("event POST failed: %s", e)


def _post_heartbeat(**fields) -> None:
    """Upsert the scraper_heartbeat row — UI shows cookies/gemini/service state from this."""
    if not NEXTCRM_URL or not SCRAPER_API_KEY:
        return
    try:
        requests.post(
            f"{NEXTCRM_URL}/api/ingest/scraper-heartbeat",
            json=fields,
            headers=_auth_headers(),
            timeout=5,
        )
    except Exception as e:
        log.debug("heartbeat POST failed: %s", e)


def _start_heartbeat_ticker(interval_s: int = 60) -> None:
    """Background daemon: bump scraper_heartbeat.updated_at every N
    seconds so the CRM's stale-heartbeat banner doesn't fire mid-cycle.
    The click-walk Phase-2 takes ~15-25 min per cycle and the
    per-keyword _post_heartbeat() calls left gaps wider than the CRM's
    staleness threshold — falsely tripping the 'container likely down'
    alert and panicking the client. This ticker runs independently of
    the scrape work so the heartbeat stays fresh during a long cycle.
    Empty payload is fine — every heartbeat field is optional + nullable
    in the CRM Zod schema; the upsert still advances updated_at."""

    def _tick():
        while True:
            try:
                _post_heartbeat()
            except Exception:
                pass  # never block on heartbeat failure
            time.sleep(interval_s)

    t = threading.Thread(target=_tick, name="hb-ticker", daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# remote cookie updater — polls the CRM for a newer cookies.json upload
# ---------------------------------------------------------------------------

_last_cookie_upload_at: Optional[str] = None
COOKIES_FILE = Path("/app/upwork_cookies.json")


def sync_cookies_from_crm() -> Optional[str]:
    """Check CRM for a newer cookies.json. If one exists, write it to disk so
    the next scrape picks it up. Returns the new uploaded_at or None."""
    global _last_cookie_upload_at
    if not NEXTCRM_URL or not SCRAPER_API_KEY:
        return None
    try:
        params = {"since": _last_cookie_upload_at} if _last_cookie_upload_at else {}
        r = requests.get(
            f"{NEXTCRM_URL}/api/ingest/scraper-cookies",
            headers=_auth_headers(),
            params=params,
            timeout=10,
        )
        if not r.ok:
            log.debug("cookies fetch %d", r.status_code)
            return None
        data = r.json()
        if not data.get("uploaded_at"):
            return None  # nothing uploaded yet
        if data.get("unchanged"):
            return data["uploaded_at"]
        cookies = data.get("cookies")
        if not isinstance(cookies, list) or not cookies:
            return None
        COOKIES_FILE.write_text(json.dumps(cookies, indent=2))
        _last_cookie_upload_at = data["uploaded_at"]
        log.info(
            "cookies refreshed from CRM (%d cookies, uploaded %s)",
            len(cookies),
            data["uploaded_at"],
        )
        return _last_cookie_upload_at
    except Exception as e:
        log.warning("cookie sync failed: %s", e)
        return None


_AUTH_RELEVANT_PREFIXES = (
    # Upwork's own persistent auth / identity cookies (~1 year TTL)
    "master_access_token",
    "oauth2_global_js_token",
    "user_uid",
    "user_oauth2_token",
    "_upw_id",
    # Forter — anti-fraud, persistent; its absence implies full re-login
    "forterToken",
    # Upwork visitor/session id — short but genuinely needed
    "visitor_id",
    "XSRF-TOKEN",
    "assumedRole",
)

_SHORT_TTL_SKIP = (
    "__cf_bm",        # Cloudflare bot-management — 30min, refreshes every request
    "cf_clearance",   # Cloudflare challenge clearance — re-issued on bypass
    "_upw_ses",       # Upwork session analytics — short
    "_ga",            # Google Analytics — not auth
    "_gid",
    "_fbp",
    "_clck",
    "_clsk",
    "_tt_enable_cookie",
    "_ttp",
    "_tt_sessionId",
    "_cq_",
    "_pin_unauth",
    "AMP_",
)


def _is_auth_relevant(name: str) -> bool:
    """True if this cookie is one we actually need to keep the session alive.
    Short-lived tracking cookies are ignored for expiry purposes because the
    scraper re-issues them on every request."""
    if not name:
        return False
    if any(name == p or name.startswith(p) for p in _AUTH_RELEVANT_PREFIXES):
        return True
    # Everything else is considered non-critical (analytics, bot-management, etc.)
    return False


def analyse_cookies_file() -> dict:
    """Read /app/upwork_cookies.json and report:
      - cookies_count: total entries
      - cookies_min_expiry: earliest expiration among AUTH cookies only
      - cookies_hard_expired: True iff every known auth cookie has expired

    Key insight: tracking cookies like `__cf_bm` and `_upw_ses` expire every
    ~30 minutes by design and are auto-regenerated on each request. Using
    their expiration to judge session health yields constant false positives.
    We only inspect the cookies that actually carry identity.
    """
    out = {
        "cookies_count": None,
        "cookies_min_expiry": None,
        "cookies_hard_expired": None,
    }
    try:
        path = "/app/upwork_cookies.json"
        if not os.path.exists(path):
            return out
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, list):
            return out
        out["cookies_count"] = len(data)

        auth_exps: list[float] = []
        auth_names: list[str] = []
        for c in data:
            if not isinstance(c, dict):
                continue
            name = c.get("name") or ""
            if not _is_auth_relevant(name):
                continue
            auth_names.append(name)
            exp = c.get("expirationDate")
            if isinstance(exp, (int, float)) and exp > 0:
                auth_exps.append(float(exp))

        # If no auth cookies at all → hard expired (login required).
        if not auth_names:
            out["cookies_hard_expired"] = True
            return out

        # Min over AUTH cookies only. Session cookies (no expiration set) are
        # browser-session-scoped — in a headless scraper they effectively
        # never expire, so we skip them for this check.
        if auth_exps:
            min_exp = min(auth_exps)
            out["cookies_min_expiry"] = datetime.fromtimestamp(
                min_exp, tz=timezone.utc
            ).isoformat()
            out["cookies_hard_expired"] = min_exp < time.time()
        else:
            # auth cookies present but none have explicit expiration — treat
            # as live (session cookie, will die when scraper restarts at worst)
            out["cookies_hard_expired"] = False
    except Exception as e:
        log.debug("cookies file analysis failed: %s", e)
    return out


def probe_scraper_and_cookies() -> dict:
    """Call the in-container scraper's /health and inspect the cookies file."""
    info = {
        "scraper_healthy": False,
        "scraper_version": None,
        "cookies_present": None,
        "cookies_count": None,
        "cookies_min_expiry": None,
        "cookies_hard_expired": None,
        # `gemini_enabled` is the CRM health panel's "name enrichment alive?"
        # signal. Since 2026-06-01 enrichment runs via OpenRouter (a Gemini
        # model) — the direct Google key is gone — so report enabled when
        # EITHER LLM path is configured. Reporting only the legacy
        # GEMINI_API_KEY here made the panel show a false red "disabled —
        # set GEMINI_API_KEY" even though OpenRouter enrichment was healthy.
        "gemini_enabled": bool(OPENROUTER_API_KEY or GEMINI_API_KEY),
        "openrouter_enabled": bool(OPENROUTER_API_KEY),
        "openrouter_model": OPENROUTER_MODEL if OPENROUTER_API_KEY else None,
        "keywords": KEYWORDS,
    }
    try:
        r = requests.get(f"{SCRAPER_URL}/health", timeout=5)
        if r.ok:
            j = r.json()
            info["scraper_healthy"] = j.get("status") == "healthy"
            info["scraper_version"] = str(j.get("version") or "")
            info["cookies_present"] = bool(j.get("cookies_present"))
    except Exception as e:
        log.warning("scraper /health probe failed: %s", e)

    ck = analyse_cookies_file()
    info.update(ck)
    if info["cookies_present"] is None and info["cookies_count"] is not None:
        info["cookies_present"] = info["cookies_count"] > 0

    return info


def _client_info_score(job: dict) -> int:
    """How many logged-in-only signals does this job carry?

    Upwork strips the whole 'About the client' section when the session is
    dead, which leaves these fields with placeholder values ('Unknown',
    'N/A', 0) or empty arrays. We count each real signal separately — a job
    is 'low info' when fewer than 2 fire.

    Originally we counted only history / payment_verified / rating / reviews
    / jobs_posted. After Upwork's May 2026 About-the-client redesign,
    `data-testid="buyer-rating"`, `data-qa="client-job-posting-stats"` and
    the "Payment method verified" text all disappeared, so even fully
    logged-in pages were scoring 0. We now also count fields that the new
    layout still exposes (industry, hires, hours, total_spent,
    member_since, location). Logged-out pages don't render any of these,
    so the threshold remains a faithful proxy for "session alive".
    """
    client = job.get("client_info") if isinstance(job.get("client_info"), dict) else {}
    if not isinstance(client, dict):
        client = {}
    score = 0
    # 1. Non-empty job history (strongest — appears only when logged in)
    hist = client.get("job_history")
    if isinstance(hist, list) and len(hist) > 0:
        score += 1
    # 2. Payment verified (boolean true)
    if client.get("payment_verified") is True:
        score += 1
    # 3. Rating is a real number
    rating = str(client.get("rating") or "").strip()
    if rating and rating != "N/A" and rating != "0":
        try:
            if float(rating) > 0:
                score += 1
        except Exception:
            pass
    # 4. Review count > 0
    rc = str(client.get("review_count") or "").strip()
    try:
        if rc and int(rc) > 0:
            score += 1
    except Exception:
        pass
    # 5. jobs_posted is a real count (not 'Unknown' / missing)
    jp = str(client.get("jobs_posted") or "").strip()
    if jp and jp.lower() not in {"unknown", "n/a", "0", ""}:
        score += 1
    # 6. Industry (new layout's data-qa="client-company-profile-industry")
    if str(client.get("industry") or "").strip():
        score += 1
    # 7. Hires count parsed from "X hires, Y active"
    if str(client.get("hires") or "").strip():
        score += 1
    # 8. Hours parsed from "X hours"
    if str(client.get("hours") or "").strip():
        score += 1
    # 9. total_spent string present (e.g. "$1.4M") — only logged-in
    ts = str(client.get("total_spent") or "").strip()
    if ts and ts.lower() not in {"unknown", "n/a", ""}:
        score += 1
    # 10. member_since (e.g. "Member since Mar 12, 2014") — section-only
    ms = str(client.get("member_since") or "").strip().lower()
    if ms.startswith("member since"):
        score += 1
    # 11. location (data-qa="client-location" inside the section)
    loc = str(client.get("location") or "").strip().lower()
    if loc and loc not in {"unknown", "not found", ""}:
        score += 1
    return score


def job_has_client_info(job: dict) -> bool:
    """A job has useful client info when at least two independent signals fire."""
    return _client_info_score(job) >= 2


def behavioural_cookie_health(jobs: list) -> dict:
    """Rate of jobs carrying logged-in-only client data. Signals:

      working  — majority (≥ 0.5) carry it
      degraded — partial (0.15..0.5)
      no-info  — near-zero

    This signal USED to be called 'expired' at the low end, interpreting
    0% client_info as dead cookies. That was wrong: Upwork changed their
    job-page DOM in late Apr 2026 and logged-in users stopped receiving
    the 'About the client' block in server-rendered HTML — so 0% can
    mean 'auth is fine, scraper selectors need updating' rather than
    'cookies expired'. The CRM UI now treats 'no-info' as a scraper
    problem, not an auth problem.
    """
    if not jobs:
        return {
            "cookies_working": None,
            "cookies_signal": "no-data",
            "cookies_client_info_rate": None,
        }
    with_info = sum(1 for j in jobs if job_has_client_info(j))
    rate = with_info / len(jobs)
    if rate >= 0.5:
        signal = "working"
    elif rate >= 0.15:
        signal = "degraded"
    else:
        signal = "no-info"
    return {
        "cookies_working": True if rate > 0 else None,
        "cookies_signal": signal,
        "cookies_client_info_rate": round(rate, 2),
    }


def fetch_known_job_ids(days: int = 7) -> list[str]:
    """Job ids already in the CRM, so the scraper can skip their cards.

    Fetched once per cycle and shared by every keyword. Fails OPEN: on any
    error we return [] and the scraper behaves exactly as before (scrape
    everything, dedupe CRM-side) — never let this stop the pipeline.
    """
    if not NEXTCRM_URL or not SCRAPER_API_KEY:
        return []
    try:
        resp = requests.get(
            f"{NEXTCRM_URL}/api/ingest/known-jobs",
            params={"days": days},
            headers=_auth_headers(),
            timeout=60,
        )
        resp.raise_for_status()
        ids = list(resp.json().get("jobIds") or [])
        log.info("known-jobs: %d id(s) will be skipped on sight", len(ids))
        return ids
    except Exception as e:
        log.warning("known-jobs fetch failed (%s) — scraping without skip list", e)
        return []


def call_scraper(query: str, skip_job_ids: list[str] | None = None) -> list[dict]:
    resp = requests.post(
        f"{SCRAPER_URL}/scrape/search",
        json={
            "query": query,
            "limit": LIMIT,
            "skip_job_ids": skip_job_ids or [],
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(data.get("error") or "scraper success=false")
    return list(data.get("jobs") or [])


def forward_to_crm(leads: list[dict]) -> dict:
    items = []
    for l in leads:
        items.append(
            {
                "upwork_job_url": l.get("upworkLink"),
                "upwork_job_id": l.get("job_id"),
                # Always use UTC now(). The forked scraper sets
                # `scraped_at = datetime.now().isoformat()` — naive IST
                # inside the container — which the CRM then parses as UTC
                # and stores 5h30m in the future. Ignore the scraper's
                # value and use an unambiguous UTC timestamp here.
                "extracted_at": datetime.now(timezone.utc).isoformat(),
                "company": l.get("companyName"),
                "first_name": l.get("firstName"),
                "last_name": l.get("lastName"),
                "email": None,  # n8n workflow never extracts email
                "job_title": l.get("jobTitle"),
                "description": l.get("job_description"),
                "payload": l,
            }
        )
    resp = requests.post(
        f"{NEXTCRM_URL}/api/ingest/upwork",
        json={"items": items},
        headers=_auth_headers(),
        timeout=120,
    )
    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text[:200]}
    if not resp.ok:
        raise RuntimeError(f"ingest {resp.status_code}: {body}")
    return body


# ---------------------------------------------------------------------------
# main loop
# ---------------------------------------------------------------------------

def run_keyword(
    tick_id: str, keyword: str, skip_job_ids: list[str] | None = None
) -> None:
    _post_event({
        "type": "start",
        "tick_id": tick_id,
        "query": keyword,
        "jobs_expected": LIMIT,
    })

    try:
        log.info("scrape keyword=%r limit=%d", keyword, LIMIT)
        jobs = call_scraper(keyword, skip_job_ids)
        # Behavioural cookie-health — infer from whether jobs carry client info.
        signals = behavioural_cookie_health(jobs)
        log.info(
            "cookie signal: %s (rate=%s)",
            signals["cookies_signal"],
            signals["cookies_client_info_rate"],
        )
        _post_heartbeat(**signals)
    except Exception as e:
        log.error("scrape failed: %s", e)
        _post_event({
            "type": "finish",
            "tick_id": tick_id,
            "query": keyword,
            "status": "failed",
            "error": f"scrape: {e}",
        })
        return

    if not jobs:
        log.info("0 jobs for %r", keyword)
        _post_event({
            "type": "finish",
            "tick_id": tick_id,
            "query": keyword,
            "status": "completed",
            "jobs_found": 0,
            "jobs_inserted": 0,
            "jobs_updated": 0,
        })
        return

    log.info("Gemini-enriching %d jobs…", len(jobs))
    enriched = []
    for j in jobs:
        extracted = gemini_extract_contact(j)
        enriched.append(enrich_lead(j, extracted, keyword))

    valid = [l for l in enriched if is_valid_lead(l)]
    log.info(
        "scrape=%d enriched=%d valid=%d (Gemini name OR non-empty job_history OR ≥2 client signals)",
        len(jobs), len(enriched), len(valid),
    )

    if not valid:
        _post_event({
            "type": "finish",
            "tick_id": tick_id,
            "query": keyword,
            "status": "completed",
            "jobs_found": len(jobs),
            "jobs_inserted": 0,
            "jobs_updated": 0,
        })
        return

    try:
        body = forward_to_crm(valid)
        log.info("ingest ok: %s", body)
        _post_event({
            "type": "finish",
            "tick_id": tick_id,
            "query": keyword,
            "status": "completed",
            "jobs_found": len(jobs),
            "jobs_inserted": int(body.get("inserted") or 0),
            "jobs_updated": int(body.get("updated") or 0),
        })
    except Exception as e:
        log.error("forward failed: %s", e)
        _post_event({
            "type": "finish",
            "tick_id": tick_id,
            "query": keyword,
            "status": "failed",
            "jobs_found": len(jobs),
            "error": f"forward: {e}"[:500],
        })


def main() -> None:
    log.info(
        "pusher starting: crm=%s, keywords=%s, limit=%d, parallel=%d, wait=%ds, gemini=%s, openrouter=%s",
        NEXTCRM_URL or "(unset)",
        KEYWORDS,
        LIMIT,
        MAX_PARALLEL_KEYWORDS,
        WAIT_SECONDS,
        "on" if GEMINI_API_KEY else "off",
        OPENROUTER_MODEL if OPENROUTER_API_KEY else "off",
    )

    # A previous pusher instance may have died mid-scrape, leaving
    # scrape_runs rows stuck in status='running'. Tell the CRM to reap them
    # so the UI doesn't show orphans as "Running".
    _post_event({"type": "cleanup"})

    while True:
        if not NEXTCRM_URL or not SCRAPER_API_KEY:
            log.warning("NEXTCRM_URL/SCRAPER_API_KEY unset — skipping")
            time.sleep(60)
            continue

        cycle_id = uuid.uuid4().hex[:12]
        log.info(
            "═══ cycle %s: %d keywords, %d parallel ═══",
            cycle_id,
            len(KEYWORDS),
            MAX_PARALLEL_KEYWORDS,
        )

        # Cookies are shared across the parallel scrapes — refresh once per
        # cycle, before fan-out, so all workers start with the same fresh
        # session.
        sync_cookies_from_crm()
        probe = probe_scraper_and_cookies()
        _post_heartbeat(**probe, current_keyword=None, last_error=None)

        cycle_started_at = time.time()

        # Fan out: each keyword gets its own tick_id and runs on its own
        # worker thread. The scraper service's BoundedSemaphore caps actual
        # browser concurrency at MAX_CONCURRENT_SCRAPES (set in lockstep);
        # any excess workers block on the permit and serialize naturally.
        # One shared skip list per cycle — cards we already hold are dropped
        # before the click-through, which is what makes a wide keyword list
        # affordable.
        known_ids = fetch_known_job_ids()

        with ThreadPoolExecutor(
            max_workers=MAX_PARALLEL_KEYWORDS,
            thread_name_prefix="kw",
        ) as pool:
            futures = {
                pool.submit(run_keyword, uuid.uuid4().hex[:12], kw, known_ids): kw
                for kw in KEYWORDS
            }
            for fut in as_completed(futures):
                kw = futures[fut]
                try:
                    fut.result()
                except Exception as e:
                    # run_keyword should already report failures via events;
                    # this is a safety net for anything that escapes it.
                    log.exception("unexpected error on %r: %s", kw, e)
                    _post_heartbeat(last_error=f"{kw}: {e}"[:500])

        elapsed = time.time() - cycle_started_at
        log.info(
            "═══ cycle %s done in %.1fs; sleeping %ds ═══",
            cycle_id,
            elapsed,
            WAIT_SECONDS,
        )
        time.sleep(WAIT_SECONDS)


if __name__ == "__main__":
    _start_heartbeat_ticker()
    main()
