"""Jev semantic enrichment: run the rubric over a lead, score it, gate it, store it.

This is the playbook's middle layers wired together for Knape:

  evidence (state)  ->  Jev atomic judgments  ->  CODE composite score + confidence
  gate  ->  provenance written to lead_semantic + hot columns on accounts.

Jev interprets meaning; all arithmetic (weights, thresholds, routing) stays here
in code, as the playbook requires. Nothing here sends emails or spends provider
credits; it only decides and records. Callers use the verdicts to gate spend.
"""

from __future__ import annotations

import os
from typing import Any

from config import JEV_MODEL
from outreach import cockpit_api as C
from outreach import jev_llm as J
from outreach import jev_questions as Q
from utils.exclusions import normalize_company_key


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# Composite weights (playbook defaults; tune against outcomes via env).
WEIGHTS = {
    "icp_fit": _f("JEV_W_ICP_FIT", 0.35),
    "pain": _f("JEV_W_PAIN", 0.25),
    "offer": _f("JEV_W_OFFER", 0.15),
    "maturity": _f("JEV_W_MATURITY", 0.10),
    "evidence": _f("JEV_W_EVIDENCE", 0.15),
}
# Gate thresholds (plot against a labeled set before trusting; see scripts/jev_eval.py).
ACCEPT_CONF = _f("JEV_ACCEPT_CONF", 0.80)
REJECT_CONF = _f("JEV_REJECT_CONF", 0.30)
TARGET_ACCEPT = _f("JEV_TARGET_ACCEPT", 0.80)
TARGET_DROP = _f("JEV_TARGET_DROP", 0.30)
PRIORITY_AUTO = _f("JEV_PRIORITY_AUTO", 70.0)
PRIORITY_NURTURE = _f("JEV_PRIORITY_NURTURE", 40.0)

_PARTNER_KEYS = {normalize_company_key(m) for m in Q.load_icp().get("known_manufacturers", [])}


def partner_match(company_name: str) -> bool:
    """True if the company IS one of Knape's repped manufacturers (a PARTNER).

    Exact/normalized match in CODE, not Jev: a known partner must never be
    prospected as a customer, and this is an identity question, not a judgment.
    """
    key = normalize_company_key(company_name or "")
    return bool(key) and key in _PARTNER_KEYS


_MATURITY_N = {"enterprise": 1.0, "mid_market": 0.8, "small": 0.4, "unknown": 0.3}


def _band_norm(val: float, bands: int = 4) -> float:
    """A score answer runs 0..bands-1; normalize to 0..1."""
    if bands <= 1:
        return 0.0
    return max(0.0, min(1.0, val / (bands - 1)))


# --- cheap target filter (run before paid enrichment) ------------------------
def classify_target(state: dict[str, Any]) -> dict[str, Any]:
    """Run the pre-enrichment filter over a state. Returns verdict + fields."""
    name = (state.get("company") or {}).get("name", "")
    ans = J.jev_decide(state=state, questions=Q.target_filter_questions())
    p = J.noul_prob(ans, "is_target")
    rel = "partner_manufacturer" if partner_match(name) else J.choice_value(ans, "relationship")
    if rel in ("partner_manufacturer", "competitor"):
        verdict = "drop"  # never prospect a partner or a competitor
    else:
        verdict = "pass" if p >= TARGET_ACCEPT else ("drop" if p < TARGET_DROP else "review")
    return {
        "application": J.choice_value(ans, "application"),
        "is_target": p,
        "relationship": rel,
        "verdict": verdict,
        "answers": ans,
    }


def target_filter_account(account_id: int) -> dict[str, Any]:
    """Cheap ICP filter for one account; records the application + target prob."""
    state = C.account_jev_state(account_id)
    if not state:
        return {"verdict": "skip", "reason": "no account"}
    res = classify_target(state)
    src = (state.get("company") or {}).get("website") or ""
    C.save_lead_semantic(account_id, "application", res["application"],
                         confidence=J.confidence(res["answers"], "application"),
                         source_url=src, rubric_version=Q.RUBRIC_VERSION, jev_model=JEV_MODEL)
    C.save_lead_semantic(account_id, "is_target", round(res["is_target"], 4),
                         confidence=abs(res["is_target"] - 0.5) * 2.0,
                         source_url=src, rubric_version=Q.RUBRIC_VERSION, jev_model=JEV_MODEL)
    C.save_lead_semantic(account_id, "relationship", res.get("relationship", ""),
                         source_url=src, rubric_version=Q.RUBRIC_VERSION, jev_model=JEV_MODEL)
    return res


# --- full semantic enrichment + composite score + gate -----------------------
def _route_from(priority: float, confidence: float, is_target: float, pain_present: float) -> tuple[str, str]:
    """Deterministic three-band gate. Returns (outreach_route, review_state)."""
    if is_target < TARGET_DROP:
        return "suppress", "auto_rejected"
    if priority >= PRIORITY_AUTO and confidence >= ACCEPT_CONF and pain_present >= 0.5:
        return "auto_sequence", "auto_approved"
    if confidence < REJECT_CONF:
        return "enrich_more", "needs_evidence"
    if priority >= PRIORITY_NURTURE:
        return "human_review", "needs_review"
    return "nurture", "low_priority"


def semantic_enrich_account(account_id: int) -> dict[str, Any]:
    """Full website-to-ICP pass for one account: classify, score in code, gate, store."""
    state = C.account_jev_state(account_id)
    if not state:
        return {"ok": False, "reason": "no account"}
    if not (state.get("evidence") or "").strip():
        return {"ok": False, "reason": "no evidence text (capture pages first)"}

    name = (state.get("company") or {}).get("name", "")
    if partner_match(name):
        src = (state.get("company") or {}).get("website") or ""
        C.save_lead_semantic(account_id, "relationship", "partner_manufacturer",
                             source_url=src, extractor="code", rubric_version=Q.RUBRIC_VERSION)
        C.set_account_jev_summary(account_id, outreach_route="suppress",
                                  review_state="partner_not_prospect", rubric_version=Q.RUBRIC_VERSION)
        return {"ok": True, "account_id": account_id, "route": "suppress",
                "review_state": "partner_not_prospect", "relationship": "partner_manufacturer"}

    ans = J.jev_decide(state=state, questions=Q.website_icp_questions())
    src = (state.get("company") or {}).get("website") or ""

    icp_fit_raw = J.score_value(ans, "icp_fit")          # 0..3
    icp_fit_n = _band_norm(icp_fit_raw)
    pain_present = J.noul_prob(ans, "pain_present")
    pain_strength_raw = J.score_value(ans, "pain_strength")
    pain_n = _band_norm(pain_strength_raw) * (1.0 if pain_present >= 0.5 else 0.3)
    offer = J.choice_value(ans, "offer_angle")
    offer_conf = J.confidence(ans, "offer_angle")
    offer_n = 0.0 if offer in ("", "none") else offer_conf
    maturity = J.choice_value(ans, "maturity")
    maturity_n = _MATURITY_N.get(maturity, 0.3)

    # Evidence quality proxy: mean confidence of the semantic answers (the only
    # component Jev can supply here; source authority/recency would be code-side).
    confs = [J.confidence(ans, q) for q in ("application", "icp_fit", "pain_present", "offer_angle")]
    evidence_n = sum(confs) / len(confs) if confs else 0.0

    priority = 100.0 * (
        WEIGHTS["icp_fit"] * icp_fit_n
        + WEIGHTS["pain"] * pain_n
        + WEIGHTS["offer"] * offer_n
        + WEIGHTS["maturity"] * maturity_n
        + WEIGHTS["evidence"] * evidence_n
    )
    overall_conf = min(J.confidence(ans, "icp_fit"), evidence_n)
    is_target = 1.0 if icp_fit_n >= 0.34 else evidence_n  # fit itself implies targethood
    route, review_state = _route_from(priority, overall_conf, is_target, pain_present)

    # Persist every interpreted field with provenance (source columns untouched).
    fields = {
        "application": (J.choice_value(ans, "application"), J.confidence(ans, "application")),
        "customer_type": (J.choice_value(ans, "customer_type"), J.confidence(ans, "customer_type")),
        "icp_fit": (round(icp_fit_n * 10, 2), J.confidence(ans, "icp_fit")),
        "maturity": (maturity, J.confidence(ans, "maturity")),
        "pain_present": (round(pain_present, 4), abs(pain_present - 0.5) * 2.0),
        "pain_strength": (round(pain_n * 10, 2), J.confidence(ans, "pain_strength")),
        "pain_theme": (J.choice_value(ans, "pain_theme"), J.confidence(ans, "pain_theme")),
        "offer_angle": (offer, offer_conf),
        "tech_class": (J.choice_value(ans, "tech_class"), J.confidence(ans, "tech_class")),
        "account_priority": (round(priority, 1), overall_conf),
        "outreach_route": (route, overall_conf),
        "review_state": (review_state, overall_conf),
    }
    for field, (value, conf) in fields.items():
        C.save_lead_semantic(account_id, field, value, confidence=conf, source_url=src,
                             rubric_version=Q.RUBRIC_VERSION, jev_model=JEV_MODEL, raw=ans.get(field.split("_")[0]))

    C.set_account_jev_summary(
        account_id,
        icp_fit=round(icp_fit_n * 10, 2),
        pain_strength=round(pain_n * 10, 2),
        account_priority=round(priority, 1),
        offer_angle=offer,
        outreach_route=route,
        review_state=review_state,
        rubric_version=Q.RUBRIC_VERSION,
    )
    return {
        "ok": True, "account_id": account_id, "priority": round(priority, 1),
        "icp_fit": round(icp_fit_n * 10, 2), "pain_present": round(pain_present, 3),
        "offer": offer, "route": route, "review_state": review_state,
        "confidence": round(overall_conf, 3),
    }


# --- per-contact buyer routing -----------------------------------------------
def classify_buyer_contact(contact_id: int, title: str, company: str, context: str = "") -> dict[str, Any]:
    """Classify one contact's buyer role/proximity and persist it."""
    state = {"contact": {"title": title, "name": ""}, "company": {"name": company}, "evidence": context[:3000]}
    ans = J.jev_decide(state=state, questions=Q.buyer_questions())
    role = J.choice_value(ans, "buyer_role")
    prox = _band_norm(J.score_value(ans, "buyer_proximity")) * 10.0
    C.set_contact_buyer(contact_id, role, round(prox, 2))
    return {"contact_id": contact_id, "buyer_role": role, "buyer_proximity": round(prox, 2),
            "confidence": round(J.confidence(ans, "buyer_role"), 3)}


# --- verification + dedup (Jev for ambiguous cases only) ---------------------
def verify_claim(claim: str, evidence: str) -> dict[str, Any]:
    ans = J.jev_decide(state={"claim": claim, "evidence": evidence[:4000]}, questions=Q.proof_question())
    p = J.noul_prob(ans, "evidence_supported")
    return {"supported": p >= 0.5, "probability": round(p, 4)}


def dedup_pair(record_a: dict[str, Any], record_b: dict[str, Any]) -> dict[str, Any]:
    ans = J.jev_decide(state={"record_a": record_a, "record_b": record_b}, questions=Q.dedup_question())
    p = J.noul_prob(ans, "duplicate_probability")
    return {"same_entity": p >= 0.5, "probability": round(p, 4)}


# --- evidence capture (persist page text Jev reads) --------------------------
_CAPTURE_PATHS = ("", "/about", "/about-us", "/services", "/products", "/applications", "/company")


def capture_account_evidence(account_id: int, website: str = "", max_pages: int = 4) -> int:
    """Fetch and store a few readable pages for an account. Returns pages saved.

    Reuses contact_crawl's HTML-to-text reader. Best-effort: a page that fails or
    is blocked is skipped. Treat all captured text as UNTRUSTED (it can contain
    prompt-injection); it only ever enters Jev `state`, never instructions.
    """
    from urllib.parse import urljoin

    from sources.contact_crawl import _fetch_page

    if not website:
        st = C.account_jev_state(account_id)
        website = (st.get("company") or {}).get("website") or ""
    website = (website or "").strip()
    if not website:
        return 0
    if not website.startswith("http"):
        website = "https://" + website
    saved = 0
    seen: set[str] = set()
    for path in _CAPTURE_PATHS:
        if saved >= max_pages:
            break
        url = urljoin(website, path) if path else website
        if url in seen:
            continue
        seen.add(url)
        try:
            page = _fetch_page(url)
        except Exception:
            page = None
        text = (page.text if page else "") or ""
        if len(text.strip()) < 120:
            continue
        kind = "home" if path in ("", "/") else path.strip("/").split("/")[0]
        C.save_account_page(account_id, url, text, kind=kind)
        saved += 1
    return saved


# --- batch runner ------------------------------------------------------------
def _scope_where(scope: str) -> tuple[str, list[Any]]:
    s = (scope or "all").strip()
    if s in ("all", ""):
        return "COALESCE(website,'') <> ''", []
    if s.startswith("event:"):
        return "lower(COALESCE(lead_source_bucket,'')) = ?", [s.lower()]
    # a plain slug: match its event bucket or its data_batch
    return "(lower(COALESCE(lead_source_bucket,'')) = ? OR COALESCE(data_batch,'') = ?)", [f"event:{s}".lower(), s]


def _account_ids(scope: str, limit: int, only_new: bool) -> list[int]:
    where, args = _scope_where(scope)
    if only_new:
        where += " AND jev_evaluated_at IS NULL"
    conn = C._connect()
    try:
        rows = conn.execute(
            f"SELECT id FROM accounts WHERE {where} ORDER BY COALESCE(icp_enhanced_score, icp_score) DESC LIMIT ?",
            tuple(args) + (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [int(r["id"]) for r in rows]


def classify_account_buyers(account_id: int) -> int:
    """Classify every not-yet-classified contact of an account. Returns count."""
    conn = C._connect()
    try:
        comp = conn.execute("SELECT company FROM accounts WHERE id = ?", (account_id,)).fetchone()
        rows = conn.execute(
            "SELECT id, person_name, job_title FROM contacts "
            "WHERE account_id = ? AND COALESCE(job_title,'') <> '' AND jev_role_class IS NULL",
            (account_id,),
        ).fetchall()
    finally:
        conn.close()
    company = str(comp["company"]) if comp else ""
    ctx = C.get_account_evidence_text(account_id, limit_chars=2000)
    n = 0
    for r in rows:
        try:
            classify_buyer_contact(int(r["id"]), str(r["job_title"] or ""), company, ctx)
            n += 1
        except Exception as e:  # noqa: BLE001
            print(f"  buyer classify contact {r['id']} failed: {str(e)[:120]}")
    return n


def run_batch(scope: str = "all", limit: int = 50, capture: bool = True, only_new: bool = True, buyer: bool = False) -> dict[str, Any]:
    """Capture evidence (optional) then semantically enrich a scope of accounts.

    This is the primary insertion point: it runs the cheap target read and the
    full website-to-ICP pass, writing scores/routes/provenance. It spends NO
    contact-provider credits; a caller gates paid enrichment on `outreach_route`.
    """
    C._init_db()
    ids = _account_ids(scope, limit, only_new)
    done = skipped = errors = 0
    routes: dict[str, int] = {}
    for aid in ids:
        try:
            if capture and not C.get_account_evidence_text(aid).strip():
                capture_account_evidence(aid)
            res = semantic_enrich_account(aid)
            if res.get("ok"):
                done += 1
                routes[res["route"]] = routes.get(res["route"], 0) + 1
                if buyer:
                    classify_account_buyers(aid)
            else:
                skipped += 1
        except Exception as e:  # noqa: BLE001 - one bad account must not stop the batch
            errors += 1
            print(f"  jev-enrich account {aid} failed: {str(e)[:160]}")
    return {"scope": scope, "considered": len(ids), "enriched": done,
            "skipped": skipped, "errors": errors, "routes": routes}


def _cli() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Run Jev semantic enrichment over a scope of accounts.")
    p.add_argument("--scope", default="all", help='"all", an event slug (weftec-2026), or "event:<slug>"')
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--no-capture", action="store_true", help="do not fetch page text; use what is stored")
    p.add_argument("--all-accounts", action="store_true", help="re-run even accounts already evaluated")
    p.add_argument("--one", type=int, default=0, help="enrich a single account id and print the result")
    p.add_argument("--buyer", action="store_true", help="also classify the contacts of each account")
    args = p.parse_args()

    C._init_db()
    if args.one:
        if not C.get_account_evidence_text(args.one).strip():
            print("capturing evidence:", capture_account_evidence(args.one), "pages")
        print(semantic_enrich_account(args.one))
        return
    res = run_batch(scope=args.scope, limit=args.limit, capture=not args.no_capture, only_new=not args.all_accounts, buyer=args.buyer)
    print("jev-enrich:", res)


if __name__ == "__main__":
    _cli()
