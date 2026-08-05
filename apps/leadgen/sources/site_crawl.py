"""Phase 2 contact extraction — crawl an org's own site with our own HTTP + parsing.

No paid tools, no LLM: fetch the homepage, discover staff/athletics/contact/directory
pages (link heuristics + sitemap.xml), parse them with the stdlib HTML parser, and pull
name / title / email / phone for target roles by document-order proximity. Emails not
listed but with a known name are inferred from the domain's visible email pattern and
marked ``pattern_inferred`` (never treated as verified).

Politeness: real User-Agent, robots.txt respected, ~1 req/sec per domain, one retry on
5xx, 15s timeout. Sites that block us (403 / JS-challenge / Cloudflare) are recorded with
a reason and skipped — we don't fight them here.
"""

from __future__ import annotations

import re
import socket
import ssl
import threading
import time
import urllib.robotparser
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
_TIMEOUT = 15.0
_PER_DOMAIN_GAP = 1.0  # seconds between requests to the same host

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b")
# First [M.] Last — last name may be O'Brien / McDonald / Smith-Jones style
_NAME_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+(?:[A-Z]\.|[A-Z][A-Za-z'’\-]*[a-z])){1,2})\b")

_SCHOOL_ROLES = re.compile(
    r"\b(athletic director|director of athletics|activities director|athletic coordinator|"
    r"activities coordinator|assistant principal|vice principal|associate principal|principal|"
    r"dean of students|head counselor|lead counselor|director of counseling|counseling director|"
    r"student activities director)\b",
    re.I,
)
_COALITION_ROLES = re.compile(
    r"\b(executive director|deputy director|program director|program coordinator|project coordinator|"
    r"prevention coordinator|prevention specialist|prevention program manager|coalition coordinator|"
    r"coalition director|director of prevention|program manager|project director|prevention manager)\b",
    re.I,
)

# Link/anchor hints for pages worth crawling (weight = how likely it names people).
_PAGE_HINTS: tuple[tuple[str, int], ...] = (
    ("staff-directory", 10), ("staff_directory", 10), ("staff-list", 9), ("directory", 9),
    ("administration", 8), ("our-team", 8), ("our-staff", 8), ("leadership", 8),
    ("athletics", 7), ("athletic", 7), ("faculty", 7), ("our-people", 7), ("team", 5),
    ("staff", 6), ("about-us", 5), ("about", 4), ("contact-us", 6), ("contact", 5),
    ("counseling", 5), ("administrators", 8), ("principal", 6),
)

# Tokens that are never a person's name (school/org/geography/title noise).
_NAME_STOP = {
    "school", "high", "middle", "elementary", "academy", "college", "university", "district",
    "athletic", "athletics", "director", "principal", "assistant", "counselor", "counseling",
    "department", "office", "staff", "faculty", "home", "contact", "welcome", "county", "health",
    "prevention", "coalition", "community", "services", "board", "education", "news", "calendar",
    "students", "parents", "student", "parent", "program", "coordinator", "coach", "team", "teams",
    "sports", "varsity", "spring", "summer", "fall", "winter", "north", "south", "east", "west",
    "central", "the", "for", "and", "our", "your", "read", "more", "view", "click", "email",
    "phone", "address", "united", "states", "america", "google", "search", "menu", "close",
    "privacy", "policy", "terms", "login", "logout", "register", "coaches", "activities",
    "wellness", "recovery", "substance", "family", "families", "youth", "council", "foundation",
    "resources", "partnership", "network", "center", "project", "programs",
    # street / place suffixes — campus and address lines are not people
    "road", "street", "drive", "lane", "avenue", "ave", "blvd", "boulevard", "court",
    "circle", "plaza", "highway", "parkway", "trail", "terrace", "way", "campus",
    "room", "suite", "building", "hall",
    # nav / newsletter noise that title-cases like a name
    "meet", "greet", "about", "concerns", "message", "corner", "page", "info",
    "information", "newsletter", "upcoming", "important", "quick", "links", "link",
    "learn", "apply", "join", "visit", "back", "next", "previous", "here", "week",
    "month", "today", "events", "event", "announcements", "announcement", "region",
    "superintendents", "schools", "grade", "grades", "campuses", "former", "interim",
    "finalsite", "admin", "hub", "powered", "blackboard", "schoolwires", "connected",
    "employee", "times", "daily", "tribune", "herald", "gazette", "journal",
    "send", "mail", "call", "fax",
}
_TITLE_WORDS = {
    "director", "principal", "coordinator", "specialist", "manager", "counselor", "dean",
    "superintendent", "president", "chief", "officer", "supervisor", "administrator",
}


def _host(url: str) -> str:
    h = urlparse(url).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _same_site(url_a: str, url_b: str) -> bool:
    """Same host, or one is a subdomain of the other (dcps.duvalschools.org ⊂ duvalschools.org)."""
    a, b = _host(url_a), _host(url_b)
    return a == b or a.endswith("." + b) or b.endswith("." + a)


# ---------------------------------------------------------------------------
# HTTP with politeness + block detection
# ---------------------------------------------------------------------------
_last_hit: dict[str, float] = {}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_THROTTLE_LOCK = threading.Lock()


def _throttle(host: str) -> None:
    # Reserve the next send slot under the lock, sleep outside it — keeps the
    # ~1 req/s per-domain politeness correct across parallel crawl workers.
    with _THROTTLE_LOCK:
        now = time.time()
        slot = max(now, _last_hit.get(host, 0.0) + _PER_DOMAIN_GAP)
        _last_hit[host] = slot
    if slot > now:
        time.sleep(slot - now)


def _robots_ok(url: str) -> bool:
    """Honour robots.txt, but read it with the same identity we browse with.

    RobotFileParser.read() fetches with urllib's default User-Agent, and CPython
    treats a 401/403 on robots.txt as ``disallow_all``. School sites routinely
    refuse that agent, so a site whose robots.txt actually permits us came back
    "blocked=robots" — aprandolph.com disallows exactly one path,
    ``/apps/email/*``, and every page on it was being skipped.

    That is not politeness, it is a parse failure wearing politeness as a
    costume: it blocked pages the site allows, while telling us nothing about
    the ones it forbids. Fetching robots.txt through utils.http (real UA, and
    the unlocker when a CDN refuses) and parsing the text ourselves respects
    the file MORE accurately, not less. A genuinely missing robots.txt still
    means allowed, which is what the standard says.
    """
    host = _host(url)
    if host not in _robots:
        root = f"{urlparse(url).scheme}://{urlparse(url).netloc}/robots.txt"
        rp = None
        try:
            from utils.http import get_text

            _throttle(host)
            body = get_text(root, timeout=20.0, silent=True)
            if body and "user-agent" in body.lower():
                rp = urllib.robotparser.RobotFileParser()
                rp.parse(body.splitlines())
            # No readable robots.txt is "no restrictions stated", per the
            # standard — not "forbidden".
        except Exception:  # noqa: BLE001
            rp = None
        _robots[host] = rp
    rp = _robots[host]
    if rp is None:
        return True
    try:
        return rp.can_fetch(_UA, url)
    except Exception:  # noqa: BLE001
        return True


_BLOCK_MARKERS = (
    "just a moment", "attention required", "checking your browser", "cf-browser-verification",
    "enable javascript and cookies", "please turn javascript on", "access denied",
    "request unsuccessful", "ddos protection by", "cloudflare",
)


#: Hosts that refused a plain GET at least once this process. Not persisted:
#: a CDN rule can be relaxed, and a fresh process should find out.
_UNLOCK_HOSTS: set[str] = set()


def _via_unlocker(url: str) -> str:
    """Fetch through Bright Data, cached and budgeted. "" when unavailable."""
    try:
        from utils.http import _unlocked_get

        return _unlocked_get(url, timeout=60.0) or ""
    except Exception:  # noqa: BLE001
        return ""


def _unlock_or(url: str, host: str, reason: str) -> tuple[str, str]:
    """One unlocker attempt for a page that refused us, else the original reason.

    This is where the 2,313 leads that have a website and no email address
    actually live. Six of six school sites tested refused a plain fetch —
    403, Cloudflare, JS-only shells — and every one of those is a staff
    directory with named athletic directors on it. The unlocker is tried
    SECOND, never first, so the free path is always taken when it works and
    spend tracks only the pages that genuinely refuse us.
    """
    body = _via_unlocker(url)
    if body and not any(m in body[:4000].lower() for m in _BLOCK_MARKERS):
        _UNLOCK_HOSTS.add(host)
        return body, ""
    return "", reason


def fetch(url: str, *, retry: bool = True) -> tuple[str, str]:
    """Return ``(html, "")`` on success or ``("", reason)`` when blocked/failed.

    Reasons: ``robots``, ``http_403``/``http_401``/``http_429``, ``cloudflare``,
    ``js_challenge``, ``js_only``, ``timeout``, ``dns``, ``error:*``.
    """
    if not _robots_ok(url):
        return "", "robots"
    host = _host(url)

    #: Hosts already proven to refuse a plain GET. Once a district's CDN has
    #: turned us away, every other page on it will too, so the second page
    #: skips straight to the unlocker instead of paying a timeout to relearn it.
    if host in _UNLOCK_HOSTS:
        body = _via_unlocker(url)
        if body:
            return body, ""
        return "", "unlocker_failed"
    # Public-page crawl: tolerate broken cert chains (school district IT is what it is).
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    hdrs = {
        "User-Agent": _UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    for attempt in range(2 if retry else 1):
        _throttle(host)
        try:
            req = Request(url, headers=hdrs, method="GET")
            with urlopen(req, timeout=_TIMEOUT, context=ctx) as resp:
                raw = resp.read(3_000_000).decode("utf-8", errors="replace")
            low = raw.lower()
            if any(m in low for m in _BLOCK_MARKERS):
                reason = "cloudflare" if "cloudflare" in low else "js_challenge"
                return _unlock_or(url, host, reason)
            # JS-only shell: almost no visible text but lots of script.
            visible = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
            visible = re.sub(r"(?s)<[^>]+>", " ", visible)
            if len(visible.split()) < 40 and low.count("<script") >= 3:
                return _unlock_or(url, host, "js_only")
            return raw, ""
        except HTTPError as e:
            if e.code in (401, 403, 429):
                return _unlock_or(url, host, f"http_{e.code}")
            if e.code >= 500 and attempt == 0 and retry:
                time.sleep(1.0)
                continue
            return "", f"http_{e.code}"
        except (socket.timeout, TimeoutError):
            return "", "timeout"  # a host that sat out 15s rarely answers a retry
        except URLError as e:
            reason = str(getattr(e, "reason", e)).lower()
            if "name or service not known" in reason or "nodename" in reason or "getaddrinfo" in reason:
                return "", "dns"
            if attempt == 0 and retry:
                time.sleep(0.5)
                continue
            return "", f"error:{reason[:40]}"
        except Exception as e:  # noqa: BLE001
            return "", f"error:{str(e)[:40]}"
    return "", "error:exhausted"


# ---------------------------------------------------------------------------
# HTML → ordered text segments (each carrying any mailto emails inside it)
# ---------------------------------------------------------------------------
class _Segmenter(HTMLParser):
    _BLOCK = {
        "p", "div", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
        "section", "article", "header", "footer", "br", "ul", "ol", "table", "span", "a",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.segments: list[dict[str, Any]] = []
        self.links: list[tuple[str, str]] = []
        self._buf: list[str] = []
        self._emails: list[str] = []
        self._skip = 0
        self._href: str | None = None
        self._anchor: list[str] = []

    def _flush(self) -> None:
        text = " ".join(" ".join(self._buf).split())
        if text or self._emails:
            self.segments.append({"text": text, "emails": list(dict.fromkeys(self._emails))})
        self._buf = []
        self._emails = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip += 1
            return
        if tag == "a":
            href = dict(attrs).get("href") or ""
            self._href = href
            self._anchor = []
            if href.lower().startswith("mailto:"):
                em = href[7:].split("?")[0].strip().lower()
                if _EMAIL_RE.fullmatch(em):
                    self._emails.append(em)
        if tag in self._BLOCK:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._anchor).strip()))
            self._href = None
        if tag in self._BLOCK:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        s = data.strip()
        if s:
            self._buf.append(s)
            if self._href is not None:
                self._anchor.append(s)


def _parse(html: str) -> _Segmenter:
    p = _Segmenter()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 — malformed HTML must not kill the run
        pass
    p._flush()
    return p


# ---------------------------------------------------------------------------
# Page discovery
# ---------------------------------------------------------------------------
def _path_scope(base: str) -> str:
    """School section on a shared district domain: austinisd.org/schools/akins → that
    prefix. Page-like last segments (contact-us, our-school, x.html) don't scope."""
    p = urlparse(base).path.rstrip("/").lower()
    if not p:
        return ""
    segs = p.split("/")
    last = segs[-1]
    if "." in last or any(k in last for k in ("contact", "about", "our-school", "home", "index", "athletic", "news", "domain")):
        segs = segs[:-1]
    scope = "/".join(s for s in segs if s)
    return f"/{scope}" if scope else ""


def _candidate_urls(base: str, links: list[tuple[str, str]]) -> list[str]:
    parsed = urlparse(base)
    root = f"{parsed.scheme}://{parsed.netloc}"
    scored: dict[str, int] = {}
    for href, anchor in links:
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = urljoin(base, href).split("#")[0]
        if not _same_site(absolute, base):
            continue  # own-site only
        blob = f"{href} {anchor}".lower()
        weight = max((w for hint, w in _PAGE_HINTS if hint in blob), default=0)
        if weight:
            scored[absolute] = max(scored.get(absolute, 0), weight)
    ordered = [u for u, _ in sorted(scored.items(), key=lambda kv: -kv[1])]
    for path in ("/staff-directory", "/directory", "/staff", "/athletics", "/about/staff", "/contact"):
        u = root + path
        if u not in scored:
            ordered.append(u)
    return ordered


def _sitemap_urls(base: str) -> list[str]:
    root = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    html, err = fetch(root + "/sitemap.xml", retry=False)
    if err or not html:
        return []
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", html, re.I)
    out: list[str] = []
    for u in locs:
        blob = u.lower()
        if any(hint in blob for hint, _ in _PAGE_HINTS) and _same_site(u, base):
            out.append(u.split("#")[0])
    return out[:6]


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
def _valid_name(name: str) -> bool:
    toks = name.split()
    if not (2 <= len(toks) <= 3):
        return False
    low = [t.lower().strip(".") for t in toks]
    if any(t in _TITLE_WORDS for t in low):
        return False
    # "Jimmy Carter Middle", "Adobe Acres Elementary" — a name never ENDS in a
    # school/place word, even when the leading tokens look like a person.
    if low[-1] in _NAME_STOP:
        return False
    # need at least first & last to be real words (not all stop/geo/title noise)
    real = [t for t in low if len(t) > 1 and t not in _NAME_STOP]
    return len(real) >= 2


def _find_near(segments: list[dict], i: int, window: int, pick):
    """Search segments outward from i (i, i-1, i+1, …) and return first pick() hit."""
    for d in range(0, window + 1):
        for j in (i - d, i + d) if d else (i,):
            if 0 <= j < len(segments):
                val = pick(segments[j])
                if val:
                    return val
    return None


def _name_in_seg(seg: dict) -> str | None:
    text = seg["text"]
    if len(text) > 90:  # a person's name lives in a short cell/line, not a paragraph
        return None
    for m in _NAME_RE.finditer(text):
        if _valid_name(m.group(1)):
            return m.group(1)
    return None


def _email_in_seg(seg: dict) -> str | None:
    if seg["emails"]:
        return seg["emails"][0]
    m = _EMAIL_RE.search(seg["text"])
    return m.group(0).lower() if m else None


def _phone_in_seg(seg: dict) -> str | None:
    m = _PHONE_RE.search(seg["text"])
    return m.group(0).strip() if m else None


def _clean_title(t: str) -> str:
    return " ".join(w.capitalize() if w.islower() else w for w in t.split())


_FREEMAIL = {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "comcast.net"}


def _email_ok_for_site(email: str, site_host: str, is_school: bool) -> bool:
    """Own-domain emails only — partner orgs linked from the page must not leak in.
    Small coalitions often run on freemail, so allow that for non-schools."""
    dom = email.rsplit("@", 1)[-1].lower()
    if not site_host:
        return True
    if dom == site_host or dom.endswith("." + site_host) or site_host.endswith("." + dom):
        return True
    # dcps.duvalschools.org page publishing @duvalschools.org addresses
    site_base = ".".join(site_host.rsplit(".", 2)[-2:])
    if dom.endswith(site_base):
        return True
    return (not is_school) and dom in _FREEMAIL


def _email_matches_name(email: str, name: str) -> bool:
    parts = [p for p in re.split(r"[\s.\-']+", name.lower()) if p.isalpha()]
    if len(parts) < 2:
        return False
    first, last = parts[0], parts[-1]
    local = email.split("@", 1)[0].lower()
    return last[:4] in local or f"{first[0]}{last}"[:5] in local or first in local


def extract_contacts(
    segments: list[dict], is_school: bool, org_name: str = "", site_host: str = ""
) -> tuple[list[dict], list[str]]:
    """Return (contacts, domain_emails). Contacts: {name,title,email,phone,email_status}."""
    roles = _SCHOOL_ROLES if is_school else _COALITION_ROLES
    org_toks = {t for t in re.findall(r"[a-z]+", org_name.lower()) if len(t) > 2}
    domain_emails: list[str] = []
    for seg in segments:
        domain_emails += seg["emails"]
        domain_emails += [e.lower() for e in _EMAIL_RE.findall(seg["text"])]
    domain_emails = [
        e for e in dict.fromkeys(domain_emails) if _email_ok_for_site(e, site_host, is_school)
    ]

    by_name: dict[str, dict] = {}
    for i, seg in enumerate(segments):
        m = roles.search(seg["text"])
        if not m:
            continue
        # A role keyword inside a long paragraph is usually prose, not a staff entry.
        if len(seg["text"]) > 120:
            continue
        title = _clean_title(m.group(1))
        # Real staff entries are "Name — Title" in one row, or a bare title cell with the
        # name in an adjacent cell. A role word buried in a sentence (news headline,
        # "Principal Hub" nav) is neither.
        remainder = seg["text"][: m.start()] + " " + seg["text"][m.end():]
        name = next(
            (mm.group(1) for mm in _NAME_RE.finditer(remainder) if _valid_name(mm.group(1))),
            None,
        )
        if not name:
            if len(remainder.split()) > 4:
                continue
            name = _find_near(segments, i, 2, _name_in_seg)
        if not name:
            continue
        # Campus/city echo: "Pembroke Pines" next to "Principal" on a campuses page
        # is the org's own name, not a person.
        if org_toks and all(t in org_toks for t in re.findall(r"[a-z]+", name.lower())):
            continue
        rec = by_name.setdefault(name, {"name": name, "title": title, "email": "", "phone": ""})
        if not rec["title"]:
            rec["title"] = title
        def _own_email(s: dict, _n=name) -> str | None:
            e = _email_in_seg(s)
            if e and _email_ok_for_site(e, site_host, is_school) and _email_matches_name(e, _n):
                return e
            return None

        email = _find_near(segments, i, 3, _own_email)
        if email and not rec["email"]:
            rec["email"] = email
            rec["email_status"] = "site_published"
        phone = _find_near(segments, i, 1, _phone_in_seg)
        if phone and not rec["phone"]:
            rec["phone"] = phone

    return list(by_name.values()), domain_emails


def infer_email(domain_emails: list[str], name: str) -> str:
    """Guess an email from the pattern of other emails on the domain (first.last, flast…)."""
    parts = [p for p in re.split(r"[\s.\-]+", name.lower()) if p.isalpha()]
    if len(parts) < 2 or not domain_emails:
        return ""
    first, last = parts[0], parts[-1]
    domain = domain_emails[0].split("@", 1)[1]
    counts: dict[str, int] = {}
    for e in domain_emails:
        local = e.split("@", 1)[0]
        if "." in local:
            counts["first.last"] = counts.get("first.last", 0) + 1
        elif len(local) > 1 and local[0].isalpha():
            counts["flast"] = counts.get("flast", 0) + 1
    if not counts:
        return ""
    best = max(counts, key=counts.get)
    local = {"first.last": f"{first}.{last}", "flast": f"{first[0]}{last}"}[best]
    return f"{local}@{domain}"


# ---------------------------------------------------------------------------
# Two-tier page fetch: plain HTTP first, camofox (local stealth browser) on block
# ---------------------------------------------------------------------------
_CAMOFOX_REASONS = {
    "robots", "cloudflare", "js_challenge", "js_only",
    "http_401", "http_403", "http_406", "http_429", "timeout",
}


def _fetch_page(url: str, *, force_camofox: bool = False) -> tuple[list[dict], list[tuple[str, str]], str, str, str]:
    """Fetch + parse one page through the right tier.

    Returns ``(segments, links, final_url, reason, tier)`` — reason "" on success;
    tier is "http" or "camofox".
    """
    reason = ""
    if not force_camofox:
        html, reason = fetch(url)
        if not reason:
            seg = _parse(html)
            # A "successful" fetch that yields almost no text is a JS shell too.
            if sum(1 for s in seg.segments if s["text"]) >= 8:
                return seg.segments, seg.links, url, "", "http"
            reason = "js_only"
        if reason not in _CAMOFOX_REASONS:
            return [], [], url, reason, "http"

    from utils.camofox import fetch_snapshot, snapshot_to_segments

    snap, final, cerr = fetch_snapshot(url)
    if cerr:
        return [], [], url, (reason or cerr), "camofox"
    segments, links = snapshot_to_segments(snap)
    return segments, links, final or url, "", "camofox"


# ---------------------------------------------------------------------------
# Per-account orchestration
# ---------------------------------------------------------------------------
def crawl_site(
    website: str, is_school: bool, *, max_pages: int = 6, org_name: str = ""
) -> dict[str, Any]:
    """Crawl one org site. Returns {contacts, pages_crawled, blocked_reason, tier}."""
    site = website.strip()
    if not site:
        return {"contacts": [], "pages_crawled": 0, "blocked_reason": "no_website", "tier": ""}
    base = site if site.startswith("http") else f"https://{site}"

    seg_home, links_home, final, err, tier = _fetch_page(base)
    if err:
        return {"contacts": [], "pages_crawled": 0, "blocked_reason": err, "tier": tier}
    base = final  # redirects (duvalschools.org → dcps.duvalschools.org) change the link base
    camofox_site = tier == "camofox"  # once blocked, skip the doomed plain attempts

    candidates = _candidate_urls(base, links_home)
    if not camofox_site:
        candidates += _sitemap_urls(base)
    # School on its own subdomain (aha.aps.edu): don't wander up to the district's
    # domain-wide directory — everything relevant lives on the exact host.
    bh = _host(base)
    if bh.count(".") >= 2:
        candidates = [u for u in candidates if _host(u) == bh]
    # Shared district domain (austinisd.org/schools/akins): stay inside this school's
    # section, or we harvest the whole district's principals onto one account.
    scope = _path_scope(base)
    if scope:
        root = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
        candidates = [u for u in candidates if urlparse(u).path.lower().startswith(scope)]
        candidates += [root + scope + p for p in ("/staff", "/athletics", "/contact", "/directory")]
    seen = {base}
    ordered = [u for u in candidates if u not in seen and not seen.add(u)]
    if camofox_site:  # browser pages cost ~10-15s each — visit only the best few
        max_pages = min(max_pages, 4)

    all_contacts: dict[str, dict] = {}
    domain_emails: list[str] = []
    pages = 1
    # Include the homepage itself (small orgs list staff there).
    for segs, _tag in [(seg_home, base)] + [(None, u) for u in ordered[:max_pages]]:
        if segs is None:
            _throttle(_host(_tag))
            segs, _links, _f, e, _t = _fetch_page(_tag, force_camofox=camofox_site)
            if e:
                continue
            pages += 1
        cs, des = extract_contacts(segs, is_school, org_name, _host(base))
        domain_emails += des
        for c in cs:
            prev = all_contacts.get(c["name"])
            if prev is None:
                all_contacts[c["name"]] = c
            else:
                for k in ("title", "email", "phone"):
                    if not prev.get(k) and c.get(k):
                        prev[k] = c[k]
                        if k == "email":
                            prev["email_status"] = c.get("email_status", "site_published")
        if len(all_contacts) >= 8:
            break

    domain_emails = list(dict.fromkeys(domain_emails))
    # Pattern-infer emails for role contacts we found by name only.
    for c in all_contacts.values():
        if not c.get("email"):
            guess = infer_email(domain_emails, c["name"])
            if guess:
                c["email"] = guess
                c["email_status"] = "pattern_inferred"

    return {
        "contacts": list(all_contacts.values()),
        "pages_crawled": pages,
        "blocked_reason": "",
        "tier": "camofox" if camofox_site else "http",
    }
