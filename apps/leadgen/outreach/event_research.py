"""Research a trade-show pool's companies with Claude + web search and tier them.

For each company in an event pool (``lead_source_bucket = 'event:<slug>'``) that
has no tier yet, Claude looks the company up on the web (at most three searches)
and records, through the forced ``record_company`` tool: its domain and how sure
it is of it, what the company does, an industry bucket, its relationship to Knape
and a fit rating with a one-sentence reason. The brief is the one the WorkBoat
research pass used on 24 Oct 2026, with a show-specific paragraph per event.

The tier then follows by fixed rules (``tier_for``), the same as WorkBoat's:
partner manufacturer -> T3-PARTNER; competitor -> X-COMPETITOR; school or
university name or domain -> X-ACADEMIC; Excellent fit -> T0-HOT with a strong
show presence, else T1-WARM; Good, or Weak end customer/OEM -> T2-ICP; the rest
-> X-OTHER.

"Strong show presence" was "3 or more people registered" at WorkBoat, whose
registrant roster we hold. WEFTEC and SEMICON West have no registrant roster:
their contacts were found afterwards by enrichment (Hunter, LinkedIn, search),
so a contact count says how reachable a company is, not how present it was. For
those pools an exhibitor (it took a booth, the strongest presence a company can
have) counts as strong presence, and a non-exhibitor (SEMICON booth scans and
registered attendees) needs 3 or more contacts on the account, as at WorkBoat.

Writes per account: tier, tier_reason (the fit reason), tier_source
('ai-research-YYYYMMDD'), tier_model, tier_at, industry, icp_fit; spark_brief
(the description) only when it is empty or the importer's placeholder; website
only when empty, the domain confidence is high or medium, and no other account
of the same name already holds that website (the (company, website) unique
index). Only accounts whose tier is empty, T4-UNKNOWN or set by an earlier AI
pass are written, so a tier set by hand is never overwritten. Before the first
write the pool's rows are copied to ``_bak_accounts_tier_<slug>_<YYYYMMDD>``.

Every raw result is appended to a JSONL file (one line per company name, with
the account ids it covers, token usage and web searches), so a re-run skips
companies already done and retries only failures. Accounts sharing a company
name (normalize_company_key) are researched once and all get the result.

    python -m outreach.event_research --event weftec-2026 --limit 10 --dry-run
    python -m outreach.event_research --event weftec-2026 --concurrency 6
    python -m outreach.event_research --event semicon-2026 --apply-only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

from outreach import db
from outreach.claude_llm import WEB_SEARCH_TOOL, ClaudeError, claude_messages, claude_model
from utils.exclusions import normalize_company_key

# $ per million tokens (input, output, cache read, cache write) and per search;
# used only for the cost estimate printed at the end.
PRICES = {"claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125)}
SEARCH_PRICE = 10.0 / 1000

PARTNERS = [
    "American Warming & Ventilating", "AbsolutAire", "Aprilaire", "Barry Blowers", "Soler & Palau",
    "Tuttle & Bailey", "CaptiveAire", "USAIRE", "SEIHO", "Delta Breez", "Halton", "Hartzell Air Movement",
    "Indeeco", "Sterling HVAC", "United Enertech", "Flexable Specialty Products", "Woodcock & Wilson",
    "Industrial Air Technology", "Loren Cook", "QMark", "Rotork", "Schischek", "Woods Air Movement",
    "Acudor", "INTEC", "Pottorff", "Fan Equipment Co.",
]
INDUSTRY_BUCKETS = [
    "Marine & offshore", "Oil, gas & chemical", "Utilities & infrastructure",
    "EPC & engineering", "Specialty mechanical", "Industrial & OEM", "Other", "Off-ICP",
]
FIT_SCORE = {"Excellent": 0.9, "Good": 0.7, "Weak": 0.4, "Poor": 0.1}
ACADEMIC = re.compile(r"universit|college|institute of tech|academy|school|\.edu$", re.I)
PLACEHOLDER_BRIEF = "matches the target buyer profile"
FREE_MAIL = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com",
    "msn.com", "comcast.net", "att.net", "me.com", "protonmail.com", "naver.com", "qq.com", "163.com",
}
TIERABLE = ("", "T4-UNKNOWN")

KNAPE = """You research companies for Knape Associates, a Houston-based representative and \
distributor of industrial air-movement equipment (fans, blowers, dampers, louvers, \
industrial heaters, make-up air, dust collection) founded in 1949. Knape helps engineers, \
contractors, facility and vessel operators and equipment builders specify and source that \
equipment, with marine and offshore as a core market alongside oil and gas, power, \
wastewater and heavy industry. The sales territory is Texas and part of Louisiana."""

SHOWS: dict[str, dict[str, str]] = {
    "workboat-2026": {
        "name": "International WorkBoat Show 2026",
        "context": """Every company you are given is attending or exhibiting at the International \
WorkBoat Show 2026 (New Orleans, December 2026), the main US show for commercial vessels: \
towboats, barges, offshore supply, ferries, tugs, patrol and government boats, plus the \
shipyards, naval architects, marine engineers, equipment makers and service firms around them.""",
        "excellent": """shipyard, vessel operator with a fleet, naval architect or marine \
engineering firm, marine HVAC/mechanical contractor, offshore operator""",
    },
    "weftec-2026": {
        "name": "WEFTEC 2026",
        "context": """Every company you are given exhibited at WEFTEC 2026 (Water Environment \
Federation, Chicago, October 2026), the largest North American show for water and \
wastewater: makers of treatment and process equipment, pumps, aeration, odor control, \
instruments and chemicals, plus consulting engineers, contractors, utilities and software \
firms. Treatment plants need ventilation and exhaust for headworks, blower, pump and \
chemical buildings (often corrosion-resistant or explosion-proof), odor-control fans, \
make-up air, unit heaters, dampers and louvers. Water and wastewater companies go in the \
"Utilities & infrastructure" industry bucket unless another bucket fits better.""",
        "excellent": """consulting or design engineering firm or EPC that designs water or \
wastewater treatment plants, contractor that builds them, water or wastewater utility or \
plant operator, maker of odor-control, scrubber, biofilter, sludge-drying or packaged \
treatment systems that builds fans, blowers or heaters into its products""",
    },
    "semicon-2026": {
        "name": "SEMICON West 2026",
        "context": """Every company you are given exhibited at or attended SEMICON West 2026 \
(San Francisco, October 2026), the main North American show for semiconductor \
manufacturing: chipmakers and fabs, wafer-fab equipment makers, materials, chemical and \
gas suppliers, subsystem and component makers, cleanroom and fab builders, automation, \
test and software firms. A fab needs very large volumes of general and scrubbed process \
exhaust (acid, solvent, toxic), make-up air, process air and cleanroom air handling, and \
its support buildings need ventilation and heat; fab tools and abatement systems carry \
blowers and fans as components. Texas has major fabs (Samsung in Taylor and Austin, Texas \
Instruments in Sherman and Richardson, GlobalWafers in Sherman, NXP and others in Austin).""",
        "excellent": """chipmaker or foundry operating fabs (above all in Texas), fab or \
cleanroom design-build, MEP engineering or mechanical contracting firm, maker of exhaust \
abatement, scrubbers, fume extraction or wet benches that builds fans or blowers into its \
products""",
    },
}

SYSTEM = """{knape}

{context}

Your job for each company:
1. Use web search to find its official website. The name may be abbreviated, misspelled \
or a division of a larger group. Use the location, booth, titles and email domains given \
to pick the right company when several share a name. If you cannot tell which company it \
is, say so with low confidence rather than picking one.
2. Decide how it relates to Knape:
   - end_customer: builds, owns, operates, repairs or designs plants, facilities, vessels \
or buildings that need ventilation, heating or air-moving equipment; or an engineering/MEP \
firm or mechanical contractor that specifies or buys it.
   - oem_target: builds machines or equipment that need fans, blowers, heaters or dampers \
as components.
   - partner_manufacturer: one of the manufacturers Knape already represents: {partners}.
   - competitor: another air-movement or ventilation equipment rep or distributor, or a \
maker of competing fans, blowers, dampers, louvers or heaters.
   - other: no plausible need (insurance, finance, law, staffing, media, software-only, \
associations, schools and universities, pure government agencies that buy through \
procurement contracts, and so on).
3. Rate fit for Knape: Excellent ({excellent}), Good (plausible buyer or OEM with a real \
air-moving need), Weak (indirect or small), Poor (no plausible need, partner, or \
competitor). Knape sells in Texas and Louisiana: rate Excellent only when the company \
has, or plausibly has, operations, projects or buying offices in the United States; a \
company with no US presence is at most Good.
4. fit_reason is shown to the sales team as the justification for the rating: one plain \
sentence of at most 30 words, specific to this company, saying what in its business \
creates (or lacks) a need for Knape's equipment. Write about the company, not about your \
research (no "I found" or "I could not verify"). Mention a Texas or Louisiana office, \
plant or project when you found one; do not mention its absence. Only state what you \
found; never invent facts.

Be efficient: two or three searches are usually enough. When you are done, call \
record_company exactly once. Do not write anything else."""

RECORD_TOOL: dict[str, Any] = {
    "name": "record_company",
    "description": "Save the research result for this company. Call exactly once, at the end.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "domain", "domain_confidence", "description", "industry_bucket",
            "relationship", "fit", "fit_reason",
        ],
        "properties": {
            "domain": {"type": "string", "description": "Bare domain such as example.com, or empty if not found."},
            "domain_confidence": {"type": "string", "enum": ["high", "medium", "low", "none"]},
            "description": {"type": "string", "description": "One plain sentence on what the company does and where."},
            "industry_bucket": {"type": "string", "enum": INDUSTRY_BUCKETS},
            "relationship": {
                "type": "string",
                "enum": ["end_customer", "oem_target", "partner_manufacturer", "competitor", "other"],
            },
            "fit": {"type": "string", "enum": ["Excellent", "Good", "Weak", "Poor"]},
            "fit_reason": {"type": "string", "description": "One short sentence: why this fit rating."},
        },
    },
}


def system_prompt(slug: str) -> str:
    show = SHOWS[slug]
    return (
        SYSTEM.replace("{knape}", KNAPE)
        .replace("{context}", show["context"])
        .replace("{excellent}", show["excellent"])
        .replace("{partners}", ", ".join(PARTNERS))
    )


def is_exhibitor(acc: dict[str, Any]) -> bool:
    return (acc.get("signal_category") or "") == "event_exhibitor" or (
        acc.get("signal_evidence") or ""
    ).startswith("Exhibiting company")


def tier_for(res: dict[str, Any], company: str, people: int, exhibitor: bool) -> str:
    rel, fit = res.get("relationship"), res.get("fit")
    if rel == "partner_manufacturer":
        return "T3-PARTNER"
    if rel == "competitor":
        return "X-COMPETITOR"
    if ACADEMIC.search(company) or ACADEMIC.search(res.get("domain") or ""):
        return "X-ACADEMIC"
    if fit == "Excellent":
        return "T0-HOT" if exhibitor or people >= 3 else "T1-WARM"
    if fit == "Good" or (fit == "Weak" and rel in ("end_customer", "oem_target")):
        return "T2-ICP"
    return "X-OTHER"


def load_pool(conn: db._Conn, slug: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT a.id, a.company, COALESCE(a.website, '') AS website, COALESCE(a.location, '') AS location,
               COALESCE(a.segment, '') AS segment, COALESCE(a.signal_category, '') AS signal_category,
               COALESCE(a.signal_evidence, '') AS signal_evidence, COALESCE(a.spark_brief, '') AS spark_brief,
               COALESCE(a.tier, '') AS tier, COALESCE(a.tier_source, '') AS tier_source
        FROM accounts a WHERE lower(COALESCE(a.lead_source_bucket, '')) = ?
        ORDER BY a.id
        """,
        (f"event:{slug}",),
    ).fetchall()
    pool = [dict(r) for r in rows]
    by_id = {a["id"]: a for a in pool}
    for a in pool:
        a.update(people=0, titles=[], email_domains=set())
    for c in conn.execute(
        "SELECT account_id, COALESCE(job_title, '') AS t, COALESCE(email, '') AS e FROM contacts WHERE account_id = ANY(?)",
        (list(by_id),),
    ).fetchall():
        a = by_id[c["account_id"]]
        a["people"] += 1
        if c["t"].strip() and len(a["titles"]) < 8:
            a["titles"].append(c["t"].strip())
        dom = c["e"].lower().rsplit("@", 1)[-1] if "@" in c["e"] else ""
        if dom and dom not in FREE_MAIL:
            a["email_domains"].add(dom)
    return pool


def tierable(acc: dict[str, Any], source: str = "") -> bool:
    """Untiered, or tiered by this very research pass (so a re-apply is idempotent)."""
    return acc["tier"] in TIERABLE or bool(source and acc["tier_source"] == source)


def group_pool(pool: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for a in pool:
        key = normalize_company_key(a["company"]) or a["company"].strip().lower()
        groups.setdefault(key, []).append(a)
    return groups


def company_prompt(group: list[dict[str, Any]]) -> str:
    rep = max(group, key=lambda a: (bool(a["website"]), a["people"]))
    lines = [f"Company: {rep['company']}"]
    websites = sorted({a["website"] for a in group if a["website"]})
    if websites:
        lines.append(f"Website on file (may be wrong): {', '.join(websites[:3])}")
    locs = sorted({a["location"] for a in group if a["location"]})
    if locs:
        lines.append(f"Location on file: {'; '.join(locs[:3])}")
    ev = next((a["signal_evidence"] for a in group if a["signal_evidence"]), "")
    if ev:
        lines.append(f"Show record: {ev[:200]}")
    seg = next((a["segment"] for a in group if a["segment"]), "")
    if seg:
        lines.append(f"Show segment: {seg}")
    blurb = next((a["spark_brief"] for a in group if a["spark_brief"] and PLACEHOLDER_BRIEF not in a["spark_brief"]), "")
    if blurb:
        lines.append(f"Exhibitor blurb: {blurb[:400]}")
    titles = [t for a in group for t in a["titles"]][:8]
    if titles:
        lines.append(f"Some contact titles: {'; '.join(titles)[:300]}")
    doms = sorted({d for a in group for d in a["email_domains"]})
    if doms:
        lines.append(f"Email domains seen for its contacts: {', '.join(doms[:4])}")
    return "\n".join(lines)


def _add_usage(total: dict[str, int], usage: dict[str, Any]) -> None:
    total["in"] += int(usage.get("input_tokens") or 0)
    total["out"] += int(usage.get("output_tokens") or 0)
    total["cache_read"] += int(usage.get("cache_read_input_tokens") or 0)
    total["cache_write"] += int(usage.get("cache_creation_input_tokens") or 0)
    total["searches"] += int((usage.get("server_tool_use") or {}).get("web_search_requests") or 0)


def research(system: str, prompt: str) -> dict[str, Any]:
    tools = [{"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": 3}, RECORD_TOOL]
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "searches": 0}
    choice: dict[str, Any] = {"type": "auto"}
    model = ""
    for _ in range(5):
        data: dict[str, Any] = {}
        for attempt in range(3):
            try:
                data = claude_messages(
                    system=system, messages=messages, tools=tools, tool_choice=choice,
                    max_tokens=3000, timeout=180.0,
                )
                break
            except ClaudeError as e:
                # The client already retried quickly; a sustained rate limit or
                # overload gets a longer pause before giving up on this company.
                if attempt < 2 and any(f"HTTP {c}" in str(e) for c in (429, 529, 500, 503)):
                    time.sleep(30 * (attempt + 1))
                    continue
                return {"ok": False, "error": str(e)[:300], "usage": usage, "model": model}
        _add_usage(usage, data.get("usage") or {})
        model = data.get("model") or model
        content = data.get("content") or []
        for block in content:
            if block.get("type") == "tool_use" and block.get("name") == "record_company":
                return {"ok": True, "result": block.get("input") or {}, "usage": usage, "model": model}
        stop = data.get("stop_reason")
        if stop == "refusal":
            return {"ok": False, "error": "refusal", "usage": usage, "model": model}
        messages = [*messages, {"role": "assistant", "content": content}]
        if stop != "pause_turn":
            # It answered in prose (or ran out of room) instead of recording:
            # force the tool on the next turn.
            messages.append({"role": "user", "content": "Call record_company now with what you found."})
            choice = {"type": "tool", "name": "record_company"}
    return {"ok": False, "error": "no record after 5 turns", "usage": usage, "model": model}


def valid(res: dict[str, Any]) -> bool:
    return (
        res.get("fit") in FIT_SCORE
        and res.get("industry_bucket") in INDUSTRY_BUCKETS
        and bool((res.get("fit_reason") or "").strip())
    )


def ensure_backup(conn: db._Conn, slug: str) -> str:
    name = f"_bak_accounts_tier_{re.sub(r'[^a-z0-9]+', '_', slug.lower())}_{datetime.now():%Y%m%d}"
    if not conn.execute("SELECT to_regclass(?) AS t", (name,)).fetchone()["t"]:
        conn.execute(f"CREATE TABLE {name} AS SELECT * FROM accounts WHERE false")
        conn.execute(
            f"INSERT INTO {name} SELECT * FROM accounts WHERE lower(COALESCE(lead_source_bucket, '')) = ?",
            (f"event:{slug}",),
        )
        conn.commit()
    return name


_DOMAIN = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}")


def clean_domain(raw: str | None) -> str:
    """Bare host from the model's domain field, which sometimes carries a scheme,
    a path or stray markup ("ny-creates.org</domain>"); "" if none."""
    s = (raw or "").strip().lower()
    s = re.sub(r"^[a-z]+://", "", s).removeprefix("www.")
    m = _DOMAIN.match(s)
    return m.group(0) if m else ""


def apply_result(conn: db._Conn, rec: dict[str, Any], accounts: list[dict[str, Any]]) -> dict[str, str]:
    """Write one company's result to its accounts. Returns {account id: tier} written."""
    res = rec["result"]
    source = rec.get("source") or f"ai-research-{datetime.fromtimestamp(rec.get('at') or time.time()):%Y%m%d}"
    domain = clean_domain(res.get("domain"))
    url = f"https://{domain}" if domain and res.get("domain_confidence") in ("high", "medium") else ""
    written: dict[str, str] = {}
    for acc in accounts:
        if not tierable(acc, source):
            continue
        tier = tier_for(res, acc["company"], acc["people"], is_exhibitor(acc))
        cur = conn.execute(
            """
            UPDATE accounts SET tier = ?, tier_reason = ?, tier_source = ?, tier_model = ?, tier_at = ?,
                   industry = ?, icp_fit = ?,
                   spark_brief = CASE WHEN COALESCE(spark_brief, '') = '' OR strpos(spark_brief, ?) > 0
                                      THEN COALESCE(?, spark_brief) ELSE spark_brief END
            WHERE id = ? AND (COALESCE(tier, '') IN ('', 'T4-UNKNOWN') OR COALESCE(tier_source, '') = ?)
            """,
            (
                tier, res["fit_reason"].strip(), source, rec.get("model") or "", rec.get("at") or time.time(),
                res["industry_bucket"], FIT_SCORE[res["fit"]],
                PLACEHOLDER_BRIEF, (res.get("description") or "").strip() or None, acc["id"], source,
            ),
        )
        if not cur.rowcount:
            continue
        if url and not acc["website"]:
            conn.execute(
                """
                UPDATE accounts a SET website = ? WHERE a.id = ? AND COALESCE(a.website, '') = ''
                AND NOT EXISTS (SELECT 1 FROM accounts b WHERE b.company = a.company AND b.website = ?)
                """,
                (url, acc["id"], url),
            )
        conn.commit()
        written[str(acc["id"])] = tier
    return written


def load_done(path: Path, slug: str) -> dict[str, dict[str, Any]]:
    done: dict[str, dict[str, Any]] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("event") == slug and rec.get("ok"):
                done[rec["key"]] = rec
    return done


def summarize(path: Path, slug: str) -> None:
    ok = failed = 0
    tot = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "searches": 0}
    errors: dict[str, int] = {}
    seen_ok: set[str] = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line) if line.strip() else {}
            if rec.get("event") != slug:
                continue
            for k in tot:
                tot[k] += int((rec.get("usage") or {}).get(k) or 0)
            if rec.get("ok"):
                ok += 1
                seen_ok.add(rec["key"])
            else:
                failed += 1
                errors[rec.get("error", "")[:60]] = errors.get(rec.get("error", "")[:60], 0) + 1
    pin, pout, pread, pwrite = PRICES.get(claude_model(), PRICES["claude-haiku-5-5"])
    cost = (
        tot["in"] * pin + tot["out"] * pout + tot["cache_read"] * pread + tot["cache_write"] * pwrite
    ) / 1e6 + tot["searches"] * SEARCH_PRICE
    print(
        f"[{slug}] results ok={ok} failed_attempts={failed} tokens in={tot['in']:,} out={tot['out']:,} "
        f"cache_read={tot['cache_read']:,} cache_write={tot['cache_write']:,} web_searches={tot['searches']} "
        f"est_cost=${cost:.2f}"
    )
    for e, n in sorted(errors.items(), key=lambda x: -x[1]):
        print(f"  error x{n}: {e}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Research and tier an event pool's companies with Claude + web search.")
    ap.add_argument("--event", required=True, choices=sorted(SHOWS))
    ap.add_argument("--limit", type=int, default=0, help="Research at most N companies this run (0 = all).")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true", help="Research and log results, write nothing to the DB.")
    ap.add_argument("--apply-only", action="store_true", help="Write logged results to the DB, research nothing.")
    ap.add_argument("--out", default="", help="Results JSONL (default ./event_research_<event>.jsonl).")
    args = ap.parse_args()

    slug = args.event
    out = Path(args.out or f"event_research_{slug}.jsonl")
    source = f"ai-research-{datetime.now():%Y%m%d}"
    conn = db.connect()
    pool = load_pool(conn, slug)
    groups = group_pool(pool)
    done = load_done(out, slug)
    print(f"[{slug}] {len(pool)} accounts, {len(groups)} company names, {len(done)} already researched")

    backup = ""
    applied: dict[str, str] = {}

    def apply(rec: dict[str, Any]) -> None:
        nonlocal backup
        if args.dry_run or not rec.get("ok"):
            return
        if not backup:
            backup = ensure_backup(conn, slug)
            print(f"[{slug}] backup table {backup}")
        applied.update(apply_result(conn, rec, groups.get(rec["key"], [])))

    # Results already in the log (an earlier run, or a dry run) are written first.
    for rec in done.values():
        apply(rec)

    if not args.apply_only:
        todo = [k for k, g in groups.items() if k not in done and any(tierable(a) for a in g)]
        if args.limit:
            todo = todo[: args.limit]
        system = system_prompt(slug)
        print(f"[{slug}] researching {len(todo)} companies, concurrency {args.concurrency}", flush=True)

        def run(key: str) -> dict[str, Any]:
            g = groups[key]
            try:
                rec = research(system, company_prompt(g))
            except Exception as e:  # noqa: BLE001 - one bad company must not stop the pool
                rec = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300], "usage": {}}
            if rec.get("ok") and not valid(rec["result"]):
                rec["ok"], rec["error"] = False, "invalid record"
            rec.update(
                event=slug, key=key, company=g[0]["company"], ids=[a["id"] for a in g],
                at=time.time(), source=source,
            )
            return rec

        with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex, out.open("a", encoding="utf-8") as fh:
            futs = [ex.submit(run, k) for k in todo]
            for i, fut in enumerate(as_completed(futs), 1):
                rec = fut.result()
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                apply(rec)
                r = rec.get("result") or {}
                g = groups[rec["key"]]
                tier = tier_for(r, g[0]["company"], max(a["people"] for a in g), any(is_exhibitor(a) for a in g)) if rec["ok"] else "-"
                print(
                    f"[{i}/{len(todo)}] {rec['company'][:40]:40} {tier:12} {r.get('fit', ''):9} "
                    f"{r.get('relationship', ''):20} {r.get('domain', '')} "
                    f"s={rec['usage'].get('searches', 0)} {'' if rec['ok'] else rec.get('error')}",
                    flush=True,
                )
                if args.dry_run and rec["ok"]:
                    print(f"      {r.get('fit_reason', '')}", flush=True)

    conn.close()
    dist: dict[str, int] = {}
    for t in applied.values():
        dist[t] = dist.get(t, 0) + 1
    if not args.dry_run:
        print(f"[{slug}] accounts written this run: {len(applied)} {dict(sorted(dist.items()))}")
    summarize(out, slug)


if __name__ == "__main__":
    sys.exit(main())
