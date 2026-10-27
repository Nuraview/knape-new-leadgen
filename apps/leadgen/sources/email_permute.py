"""Find show contacts' work emails by permuting their names and keeping only
addresses the mail server vouches for.

WHY. Show rosters give a name and a company, often no email, and sometimes only
a first initial ("J. Smith"). Peter Knape and the team agreed on 27 Oct 2026 to
try the usual address formats and keep only what verifies.

HOW, per contact without an email in one event pool (``event:<slug>``):

1. Mail domain. The domain real addresses at the same account already use, else
   the account website's domain. Social/job-board hosts, freemail, and shared
   service domains (tied to three or more different companies in the pool, e.g.
   a show's registration agency) are refused, and the domain must have MX (or
   A) records (``pipeline.email_validate.mx_hosts``).
2. Format. If real addresses on that domain anywhere in our database match
   their owner's name in a known format (the votes ``build_load.detect_format``
   used for WorkBoat on 24 Oct 2026), the domain's format is EVIDENCED and the
   person gets only addresses in the evidenced format(s), most used first.
   Otherwise the formats the name allows
   are tried in order of how common they are: only initial-based ones (jsmith,
   j.smith, smithj, j_smith, smith) when the roster gives just an initial, and
   the full-first-name ones too when it gives a full first name. Like the
   WorkBoat finder, discovery runs on at most two people per domain (best
   subject first); a confirmed address teaches the domain its format for
   everyone else.
3. Verification: the self-hosted Reacher through ``outreach.reacher_verify``,
   so verdicts land in the same 30-day cache the send gate reads and no address
   is probed twice. Probing stops for a person at the first accepted address.

ACCEPTANCE POLICY (stricter than ``reacher_verify.send_gate``, on purpose: the
gate judges addresses we were GIVEN, this judges addresses we INVENTED):

  * ``safe`` with a confirmed mailbox (not catch-all)         -> accept, 0.9,
    email_status ``deliverable``.
  * catch-all or ``unknown`` (no SMTP answer), format EVIDENCED by real
    addresses at the domain, and ``send_gate`` says ``send`` (verifier
    answered, not invalid, not an unconfirmed role address) and the mailbox is
    not full/disabled                                           -> accept, 0.7,
    email_status ``format_evidenced``. A timeout is never accepted.
  * ``risky`` on a domain that is not catch-all (the server answered and did
    not confirm: role-like local part, full or disabled box) -> reject.
  * catch-all, format not evidenced -> reject, and stop the domain (every
    guess would "pass", so nothing can be learned there).
  * ``unknown``, format not evidenced -> reject; two on a domain stop it.
  * ``invalid`` -> reject; next format. When the evidenced formats are invalid
    for three people in a row at a domain with nobody found, the domain is
    treated as refusing probes and left alone.

Everything accepted is a subset of what ``send_gate`` would send, so a found
address never sits in a queue the gate would then hold.

A probe that times out while Reacher itself still answers (a mail server slower
than the 30s timeout) is recorded as ``unknown`` for that address and the run
moves on. Reacher itself not answering ends the run. Mail servers of two
different domains replying with blocklist/ban wording, or no answer from six
distinct domains among the last twelve new checks, also end it: this box is
the Knape/tec5 sending IP.

WRITES. ``contacts.email`` only where it is still empty, with
``source_kind = 'permutation-verified'``. Each row is copied to
``_bak_permute_contacts_<YYYYMMDD>`` before its first change. An address
already held by a differently named contact is never assigned. Every probe and
every per-person outcome is appended to a JSONL log; a rerun skips people
already settled on the same domain, so it adds nothing new unless a contact
gained a domain (e.g. a website from the show research pass).

Run from apps/leadgen (with the .env loaded):

    python -m sources.email_permute --event weftec-2026 --dry-run
    python -m sources.email_permute --event weftec-2026 --log /path/weftec.jsonl
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import time
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from outreach import reacher_verify as R
from pipeline.email_validate import mx_hosts
from utils.domain import website_domain_usable_for_corporate_email, website_to_domain

SOURCE_KIND = "permutation-verified"
CONF_CONFIRMED = 0.9
CONF_EVIDENCED = 0.7

# Tiers that are never prospects: partners, competitors, schools, unrelated.
DEFAULT_SKIP_TIERS = ("T3-PARTNER", "X-COMPETITOR", "X-ACADEMIC", "X-OTHER")
_TIER_ORDER = {"T0-HOT": 0, "T1-WARM": 1, "T2-ICP": 2, "T4-UNKNOWN": 3}

FREEMAIL = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "comcast.net",
    "att.net", "me.com", "live.com", "msn.com", "bellsouth.net", "cox.net", "verizon.net",
    "protonmail.com", "proton.me", "ymail.com", "sbcglobal.net", "charter.net", "mac.com",
    "qq.com", "163.com", "126.com", "naver.com", "yahoo.co.jp", "hanmail.net", "foxmail.com",
})
SUFFIX = frozenset({"jr", "sr", "ii", "iii", "iv", "phd", "pe", "md", "esq", "mba", "cpa", "pmp", "dr", "mr", "mrs", "ms"})
# A "name" with one of these words is a mailbox or a department, not a person
# ("Support Team ." on an ABB row became steam@abb.com on 27 Oct 2026).
NOT_A_PERSON = frozenset({"team", "support", "sales", "info", "office", "admin", "marketing", "service",
                          "services", "department", "dept", "contact", "customer", "booth", "staff",
                          "reception", "inquiry", "inquiries", "general", "hr", "purchasing", "accounts",
                          "exhibitor", "exhibitors", "attendee", "guest", "visitor", "unknown", "tbd"})

# (needs a full first name, builder(first, initial, last))
FORMATS: dict[str, tuple[bool, Callable[[str, str, str], str]]] = {
    "first.last": (True, lambda f, i, l: f"{f}.{l}"),
    "flast": (False, lambda f, i, l: f"{i}{l}"),
    "firstlast": (True, lambda f, i, l: f"{f}{l}"),
    "f.last": (False, lambda f, i, l: f"{i}.{l}"),
    "first": (True, lambda f, i, l: f),
    "firstl": (True, lambda f, i, l: f"{f}{l[0]}"),
    "lastf": (False, lambda f, i, l: f"{l}{i}"),
    "first_last": (True, lambda f, i, l: f"{f}_{l}"),
    "last.first": (True, lambda f, i, l: f"{l}.{f}"),
    "first-last": (True, lambda f, i, l: f"{f}-{l}"),
    "f_last": (False, lambda f, i, l: f"{i}_{l}"),
    "last": (False, lambda f, i, l: l),
}
# Discovery order, most common first.
FULL_ORDER = ["first.last", "flast", "firstlast", "f.last", "first", "firstl",
              "lastf", "first_last", "last.first", "first-last", "f_last", "last"]
INITIAL_ORDER = ["flast", "f.last", "lastf", "f_last", "last"]
MAX_TRIES_FIRST_PERSON = 6
MAX_TRIES_LATER_PERSON = 3
MAX_DISCOVERY_PEOPLE = 2
MAX_UNKNOWNS = 2
MAX_EVIDENCED_MISSES = 3

# Same safety stop as the WorkBoat finder: this box is also the sending IP.
BLOCK_WORDS = ("blocklist", "blacklist", "block list", "black list", "spamhaus", "banned",
               "5.7.606", "5.7.511", "reputation", "listed at")
RECENT = 12
MAX_DEAD_DOMAINS = 6

# Outcomes that settle a person for a given domain; a rerun skips them.
FINAL = frozenset({"found", "already_has_email", "not_found", "invalid", "risky_mailbox", "collision",
                   "format_needs_first_name", "domain_catch_all", "domain_unverifiable", "domain_exhausted",
                   "domain_rejecting"})


class Stop(Exception):
    """End the run: Reacher is down, or mail servers are refusing this box."""


# ── names and formats ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Name:
    first: str  # "" when the roster gives only an initial
    initial: str
    last: str


def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def parse_name(raw: str) -> Name | None:
    """'J. Smith' -> (first='', initial='j', last='smith'); 'Smith, John' is
    swapped; suffixes, titles and (nicknames) are dropped. None if unusable."""
    s = re.sub(r"\([^)]*\)", " ", _fold(raw or ""))
    if "," in s:
        head, _, tail = s.partition(",")
        tail_tokens = [re.sub(r"[^a-z]", "", t) for t in tail.split()]
        if all(not t or t in SUFFIX for t in tail_tokens):
            s = head
        elif len(head.split()) == 1:
            s = f"{tail} {head}"
        else:
            s = head
    tokens = [re.sub(r"[^a-z]", "", t) for t in s.split()]
    tokens = [t for t in tokens if t and t not in SUFFIX]
    if len(tokens) < 2 or len(tokens[-1]) < 2 or any(t in NOT_A_PERSON for t in tokens):
        return None
    last, given = tokens[-1], tokens[:-1]
    first = next((t for t in given if len(t) >= 2), "")
    initial = first[0] if first else given[0][0]
    return Name(first=first, initial=initial, last=last)


def build(fmt: str, name: Name) -> str | None:
    needs_first, fn = FORMATS[fmt]
    if needs_first and not name.first:
        return None
    return fn(name.first, name.initial, name.last)


def detect_format(local: str, name: Name) -> str | None:
    """The format ``local`` is in for this person's name, if any."""
    for fmt in FULL_ORDER:
        if build(fmt, name) == local:
            return fmt
    return None


def candidate_formats(name: Name, *, first_subject: bool) -> list[str]:
    order = FULL_ORDER if name.first else INITIAL_ORDER
    return order[: MAX_TRIES_FIRST_PERSON if first_subject else MAX_TRIES_LATER_PERSON]


def mail_domain_of(website: str) -> str:
    """Registrable mail domain of a website, or '' if it cannot be a company's."""
    host = website_to_domain(website)
    if not host or not website_domain_usable_for_corporate_email(host) or host in FREEMAIL:
        return ""
    parts = host.split(".")
    keep = 3 if len(parts) >= 3 and (parts[-2] in ("co", "com", "ne", "or", "ac", "go", "net", "org", "gov", "edu")
                                       and len(parts[-1]) == 2) else 2
    return ".".join(parts[-keep:])


def accept(verdict: dict[str, Any], email: str, *, evidenced: bool) -> tuple[bool, str]:
    """The acceptance policy in the module docstring. Returns (accepted, status)."""
    if verdict["reachable"] == "safe" and verdict["confirmed_mailbox"]:
        return True, "deliverable"
    # The evidenced exception covers exactly what a probe cannot settle: a
    # catch-all domain, or a server that gave no answer. "risky" on a domain
    # that is not catch-all means the server did answer and did not confirm
    # the mailbox (role-like local part, full or disabled box), so it is refused.
    if not evidenced or not (verdict["catch_all"] or verdict["reachable"] == "unknown"):
        return False, ""
    smtp = (verdict.get("result") or {}).get("smtp") or {}
    if smtp.get("has_full_inbox") is True or smtp.get("is_disabled") is True:
        return False, ""
    action, _why = R.send_gate(email, verdict)  # type: ignore[arg-type]
    return (action == "send"), ("format_evidenced" if action == "send" else "")


# ── verifier ──────────────────────────────────────────────────────────────────


def reacher_alive() -> bool:
    """Is Reacher itself answering? A syntax-invalid address is answered at once
    and makes no SMTP connection, so this never touches a mail server."""
    url = (os.getenv("REACHER_URL") or "").strip()
    token = (os.getenv("REACHER_SECRET") or "").strip()
    if not url or not token:
        return False
    try:
        req = urllib.request.Request(
            f"{url.rstrip('/')}/v1/check_email",
            data=json.dumps({"to_email": "reacher-health-check"}).encode(),
            headers={"Content-Type": "application/json", "X-Reacher-Token": token},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 — configured URL
            return 200 <= res.status < 300 and "is_reachable" in json.loads(res.read().decode() or "{}")
    except (OSError, ValueError):
        return False


class Prober:
    """Reacher with the shared cache, a polite pace and the safety stops."""

    def __init__(self, interval: float, max_new: int | None) -> None:
        self.interval = interval
        self.max_new = max_new
        self.new = 0
        self.cached = 0
        self._last = 0.0
        self._recent: list[tuple[str, str]] = []
        self._refusals: set[str] = set()

    def check(self, email: str) -> tuple[dict[str, Any], bool, bool]:
        """(verdict, cached, timed_out)."""
        if R._cache_get(email) is not None:
            self.cached += 1
            return R.verify_email(email), True, False  # type: ignore[return-value]
        if self.max_new is not None and self.new >= self.max_new:
            raise Stop(f"probe budget of {self.max_new} new checks used")
        wait = self._last + self.interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        v: dict[str, Any] = dict(R.verify_email(email))
        self._last = time.monotonic()
        self.new += 1
        timed_out = False
        if not v["probed"]:
            if not reacher_alive():
                raise Stop(f"Reacher is not answering (last address {email})")
            timed_out = True
            v = {"reachable": "unknown", "probed": True, "catch_all": False,
                 "confirmed_mailbox": False, "result": None}
        smtp = json.dumps((v.get("result") or {}).get("smtp") or {}).lower()
        domain = email.rsplit("@", 1)[1]
        if any(w in smtp for w in BLOCK_WORDS):
            # One server's odd reply is not a reputation problem: Reacher labels
            # "relay not permitted" from a misconfigured MX as IpBlacklisted
            # (reciftech.com, 27 Oct 2026, while no DNSBL listed this IP). Two
            # different domains saying it is, so stop then.
            self._refusals.add(domain)
            if len(self._refusals) >= 2:
                raise Stop(f"{', '.join(sorted(self._refusals))} refused this server: {smtp[:300]}")
        self._recent.append((domain, v["reachable"]))
        del self._recent[:-RECENT]
        dead = {d for d, r in self._recent if r == "unknown"}
        if len(dead) >= MAX_DEAD_DOMAINS:
            raise Stop(f"no answer from {len(dead)} mail servers in the last {RECENT} checks ({', '.join(sorted(dead))})")
        return v, False, timed_out


# ── database ──────────────────────────────────────────────────────────────────

@dataclass
class Person:
    contact_id: int
    account_id: int
    company: str
    raw_name: str
    name: Name | None
    domain: str
    tier: str


@dataclass
class DomainState:
    domain: str
    #: Formats real addresses at the domain use, most used first (or the one a
    #: confirmed mailbox taught it this run). Empty = discover.
    formats: list[str]
    votes: dict[str, int] = field(default_factory=dict)
    status: str = "open"  # open | catch_all | unverifiable | exhausted | rejecting
    unknowns: int = 0
    found: int = 0
    misses: int = 0  # people the evidenced formats were invalid for
    discovery: list[int] = field(default_factory=list)

    @property
    def evidenced(self) -> bool:
        return bool(self.formats)


def _connect():
    from outreach.db import connect

    return connect()


def _company_family(company: str) -> str:
    """First real word of a company name: 'Agilent Technologies India' -> 'agilent'."""
    words = [w for w in re.findall(r"[a-z0-9]+", _fold(company)) if w not in ("the", "a")]
    return words[0] if words else ""


def load_pool(conn: Any, slug: str) -> tuple[list[Person], int, int, set[str]]:
    """People without email in the pool, the pool's contact count, how many
    already have an email, and the shared domains refused.

    A person's mail domain is the one real addresses at the same account use,
    else the account website's. A domain tied (by website or addresses) to
    accounts of three or more different companies is a shared service, not a
    company's mail domain: the SEMICON 2026 registration agency
    (mya2zevents.com) is the website and the registrant email of 25 unrelated
    exhibitors. A guess there could verify as somebody else's real mailbox, so
    such a domain is never used.

    Tiers are the cockpit's effective tier (``_effective_tier_sql``), so a
    blank tier reads exactly as the Events table shows it."""
    from outreach.cockpit_api import _effective_tier_sql

    rows = conn.execute(
        f"""
        SELECT c.id, c.account_id, COALESCE(c.person_name, '') AS person_name,
               lower(trim(COALESCE(c.email, ''))) AS email,
               a.company, COALESCE(a.website, '') AS website, {_effective_tier_sql("a.")} AS tier
          FROM contacts c JOIN accounts a ON a.id = c.account_id
         WHERE a.lead_source_bucket = ?
         ORDER BY c.account_id, c.id
        """,
        (f"event:{slug}",),
    ).fetchall()
    sibling: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    families: dict[str, set[str]] = collections.defaultdict(set)
    for r in rows:
        fam = _company_family(r["company"])
        web = mail_domain_of(r["website"])
        if web:
            families[web].add(fam)
        dom = r["email"].rsplit("@", 1)[-1] if "@" in r["email"] else ""
        if dom and dom not in FREEMAIL:
            sibling[int(r["account_id"])][dom] += 1
            families[dom].add(fam)
    shared = {d for d, fams in families.items() if len(fams) >= 3}
    people = []
    with_email = 0
    for r in rows:
        if r["email"]:
            with_email += 1
            continue
        aid = int(r["account_id"])
        own = [d for d, _n in sibling[aid].most_common() if d not in shared]
        web = mail_domain_of(r["website"])
        domain = own[0] if own else (web if web not in shared else "")
        people.append(Person(int(r["id"]), aid, r["company"], r["person_name"], parse_name(r["person_name"]),
                             domain, r["tier"]))
    return people, len(rows), with_email, shared


def domain_addresses(conn: Any, domains: list[str]) -> tuple[dict[str, collections.Counter],
                                                              dict[str, set[Name | None]]]:
    """For the real addresses on these domains: the format votes (each address
    matched against its owner's name, like ``build_load.detect_format``) and who
    holds each address (so a guess is never handed to a second person)."""
    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    held: dict[str, set[Name | None]] = collections.defaultdict(set)
    if not domains:
        return votes, held
    for r in conn.execute(
        "SELECT lower(trim(email)) AS email, COALESCE(person_name, '') AS person_name FROM contacts "
        "WHERE COALESCE(email, '') <> '' AND lower(split_part(trim(email), '@', 2)) = ANY(?)",
        (domains,),
    ).fetchall():
        name = parse_name(r["person_name"])
        held[r["email"]].add(name)
        local, dom = r["email"].split("@", 1)
        fmt = detect_format(local, name) if name else None
        if fmt:
            votes[dom][fmt] += 1
    return votes, held


def evidenced_formats(votes: collections.Counter) -> list[str]:
    """Every format real addresses at the domain use, most used first (ties in
    order of how common the format is generally). A domain that mixes
    john.smith and john gets both; nothing unevidenced is tried there."""
    return sorted(votes, key=lambda f: (-votes[f], FULL_ORDER.index(f)))


def write_email(conn: Any, backup: str, contact_id: int, email: str, *, confidence: float,
                status: str, fmt: str) -> bool:
    """Back the row up, then set the email only if it is still empty."""
    conn.execute(f"CREATE TABLE IF NOT EXISTS {backup} AS SELECT * FROM contacts WHERE false")
    conn.execute(
        f"INSERT INTO {backup} SELECT * FROM contacts c WHERE c.id = ? AND COALESCE(c.email, '') = '' "
        f"AND NOT EXISTS (SELECT 1 FROM {backup} b WHERE b.id = c.id)",
        (contact_id,),
    )
    extra = {"email": email, "email_status": status, "email_source": SOURCE_KIND, "email_format": fmt,
             "email_verifier": "reacher", "email_verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    cur = conn.execute(
        """
        UPDATE contacts SET email = ?, source_kind = ?, confidence = ?,
               raw_json = ((CASE WHEN COALESCE(raw_json, '') ~ '^\\s*[{]' THEN raw_json::jsonb ELSE '{}'::jsonb END)
                           || ?::jsonb)::text
         WHERE id = ? AND COALESCE(email, '') = ''
        """,
        (email, SOURCE_KIND, confidence, json.dumps(extra), contact_id),
    )
    conn.commit()
    return cur.rowcount == 1


# ── the run ───────────────────────────────────────────────────────────────────


def _settled(log_path: Path) -> set[tuple[int, str]]:
    done: set[tuple[int, str]] = set()
    if log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if rec.get("type") == "person" and rec.get("outcome") in FINAL:
                done.add((int(rec["contact_id"]), rec.get("domain") or ""))
    return done


def run(slug: str, *, log_path: Path, dry_run: bool = False, interval: float = 8.0,
        max_new: int | None = None, limit: int | None = None,
        skip_tiers: tuple[str, ...] = DEFAULT_SKIP_TIERS, retry: bool = False) -> dict[str, Any]:
    conn = _connect()
    stats: collections.Counter = collections.Counter()
    verdicts: collections.Counter = collections.Counter()
    outcomes: collections.Counter = collections.Counter()
    found: list[dict[str, Any]] = []
    backup = f"_bak_permute_contacts_{time.strftime('%Y%m%d')}"
    prober = Prober(interval, max_new)
    stopped = ""
    shared: set[str] = set()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logf = log_path.open("a", encoding="utf-8")
    done = set() if retry else _settled(log_path)

    def log(rec: dict[str, Any]) -> None:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": slug, **rec}
        if not dry_run:
            logf.write(json.dumps(rec) + "\n")
            logf.flush()

    try:
        people, pool_total, with_email, shared = load_pool(conn, slug)
        conn.commit()  # see the note at domain_addresses below
        stats["pool_contacts"], stats["already_had_email"], stats["without_email"] = pool_total, with_email, len(people)

        work: dict[str, list[Person]] = collections.defaultdict(list)
        for p in people:
            if p.tier in skip_tiers:
                outcomes["skipped_tier"] += 1
            elif not p.name:
                outcomes["bad_name"] += 1
            elif not p.domain:
                outcomes["no_domain"] += 1
            elif (p.contact_id, p.domain) in done:
                outcomes["settled_earlier"] += 1
            else:
                work[p.domain].append(p)

        domains = sorted(work)
        mx_ok = [d for d in domains if mx_hosts(d)]
        for d in set(domains) - set(mx_ok):
            outcomes["no_mx"] += len(work.pop(d))
            log({"type": "domain", "domain": d, "status": "no_mx"})
        stats["domains_considered"], stats["domains_with_mx"] = len(domains), len(mx_ok)
        stats["contacts_considered"] = sum(len(v) for v in work.values())

        votes, held = domain_addresses(conn, mx_ok)
        # End each read transaction at once: held open for the hours a run
        # takes, its share locks block any ALTER TABLE (the cockpit's _init_db),
        # and every other query then queues behind that ALTER. It deadlocked on
        # 27 Oct 2026.
        conn.commit()
        states = {d: DomainState(d, evidenced_formats(votes[d]), dict(votes[d])) for d in mx_ok}
        stats["domains_format_evidenced"] = sum(1 for s in states.values() if s.evidenced)

        # Best prospects first; within a domain, full first names make the best
        # discovery subjects.
        def dkey(d: str) -> tuple[int, int]:
            return (min(_TIER_ORDER.get(p.tier, 4) for p in work[d]), -len(work[d]))

        ordered = sorted(mx_ok, key=dkey)
        if limit is not None:
            ordered = ordered[:limit]
        stats["domains_worked"] = len(ordered)

        for d in ordered:
            ds = states[d]
            log({"type": "domain", "domain": d, "status": "start", "formats": ds.formats,
                 "votes": ds.votes, "people": len(work[d])})
            for p in sorted(work[d], key=lambda p: (_TIER_ORDER.get(p.tier, 4), not p.name.first)):  # type: ignore[union-attr]
                outcome, email_found, tried = _work_person(conn, p, ds, prober, held, log, verdicts, stats,
                                                           dry_run=dry_run, backup=backup)
                outcomes[outcome] += 1
                log({"type": "person", "contact_id": p.contact_id, "account_id": p.account_id,
                     "company": p.company, "name": p.raw_name, "domain": d, "tried": tried,
                     "outcome": outcome, "email": email_found})
                if email_found and outcome == "found":
                    found.append({"contact_id": p.contact_id, "name": p.raw_name, "company": p.company,
                                  "email": email_found, "format": tried[-1]})
    except Stop as e:
        stopped = str(e)
        log({"type": "stop", "reason": stopped})
    finally:
        logf.close()
        conn.close()

    stats["new_probes"], stats["cached_probes"] = prober.new, prober.cached
    return {"event": slug, "dry_run": dry_run, "stats": dict(stats), "verdicts": dict(verdicts),
            "outcomes": dict(outcomes), "found": found, "stopped": stopped, "shared_domains": sorted(shared),
            "backup_table": backup if found and not dry_run else ""}


def _work_person(conn: Any, p: Person, ds: DomainState, prober: Prober, held: dict[str, set[Name | None]],
                 log: Callable[[dict[str, Any]], None], verdicts: collections.Counter, stats: collections.Counter,
                 *, dry_run: bool, backup: str) -> tuple[str, str, list[str]]:
    """Try one person's addresses. Returns (outcome, email, formats tried)."""
    name = p.name
    assert name is not None
    if ds.status != "open":
        return f"domain_{ds.status}", "", []
    if ds.formats:
        formats = [f for f in ds.formats if build(f, name) is not None]
        if not formats:
            return "format_needs_first_name", "", []
    else:
        if len(ds.discovery) >= MAX_DISCOVERY_PEOPLE:
            ds.status = "exhausted"
            return "domain_exhausted", "", []
        formats = candidate_formats(name, first_subject=not ds.discovery)
        ds.discovery.append(p.contact_id)
    evidenced = ds.evidenced  # fixed for this person, even if a format is learned mid-way

    tried: list[str] = []
    collided = False
    for fmt in formats:
        local = build(fmt, name)
        if local is None:
            continue
        email = f"{local}@{ds.domain}"
        owners = held.get(email)
        if owners and name not in owners:
            stats["collisions"] += 1
            collided = True
            continue
        tried.append(fmt)
        stats["permutations_tried"] += 1
        if dry_run:
            continue
        v, cached, timed_out = prober.check(email)
        label = "timeout" if timed_out else ("catch_all" if v["catch_all"] else v["reachable"])
        verdicts[label] += 1
        # A timeout is recorded as "unknown", but nothing was learned: never accept it.
        ok, status = (False, "") if timed_out else accept(v, email, evidenced=evidenced)
        log({"type": "probe", "contact_id": p.contact_id, "name": p.raw_name, "company": p.company,
             "domain": ds.domain, "format": fmt, "email": email, "evidenced": evidenced,
             "reachable": v["reachable"], "catch_all": v["catch_all"], "confirmed": v["confirmed_mailbox"],
             "cached": cached, "timed_out": timed_out, "accepted": ok, "status": status})
        if ok:
            if not write_email(conn, backup, p.contact_id, email,
                               confidence=CONF_CONFIRMED if status == "deliverable" else CONF_EVIDENCED,
                               status=status, fmt=fmt):
                return "already_has_email", "", tried
            held.setdefault(email, set()).add(name)
            if not ds.formats:  # a confirmed mailbox teaches the domain its format
                ds.formats = [fmt]
            ds.found += 1
            stats["emails_added"] += 1
            stats[f"emails_added_{status}"] += 1
            return "found", email, tried
        if v["catch_all"]:
            if evidenced:  # accept() refused it (full/disabled/role): this person only
                return "not_found", "", tried
            ds.status = "catch_all"
            return "domain_catch_all", "", tried
        if v["reachable"] == "unknown":
            ds.unknowns += 1
            if ds.unknowns >= MAX_UNKNOWNS:
                ds.status = "unverifiable"
                return "domain_unverifiable", "", tried
            if evidenced:
                return "not_found", "", tried
            continue
        if v["reachable"] == "risky":
            return "risky_mailbox", "", tried
        # invalid: try the next format
    if dry_run:
        return "dry_run", "", tried
    if collided and not tried:
        return "collision", "", tried
    if evidenced:
        # Every evidenced format was refused for this person. A domain that
        # refuses its own format for several people in a row, with nobody
        # found, is refusing probes (or the format moved on): stop spending
        # checks there.
        ds.misses += 1
        if ds.found == 0 and ds.misses >= MAX_EVIDENCED_MISSES:
            ds.status = "rejecting"
        return "invalid", "", tried
    return "not_found", "", tried


def main() -> None:
    ap = argparse.ArgumentParser(description="Permute show contacts' names into emails; keep only verified ones.")
    ap.add_argument("--event", required=True, help="event slug, e.g. weftec-2026")
    ap.add_argument("--log", default=None, help="attempt log (JSONL); default ./email_permute_<slug>.jsonl")
    ap.add_argument("--dry-run", action="store_true", help="list permutations, probe and write nothing")
    ap.add_argument("--interval", type=float, default=8.0, help="seconds between NEW Reacher checks")
    ap.add_argument("--max-probes", type=int, default=None, help="stop after this many new checks")
    ap.add_argument("--limit", type=int, default=None, help="work at most this many domains")
    ap.add_argument("--skip-tiers", default=",".join(DEFAULT_SKIP_TIERS), help="comma list; '' for none")
    ap.add_argument("--retry", action="store_true", help="also redo people settled in the log")
    args = ap.parse_args()
    log_path = Path(args.log or f"email_permute_{args.event}.jsonl")
    res = run(args.event, log_path=log_path, dry_run=args.dry_run, interval=args.interval,
              max_new=args.max_probes, limit=args.limit,
              skip_tiers=tuple(t for t in args.skip_tiers.split(",") if t), retry=args.retry)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
