"""Turn what happened into what the agent knows.

Every email carries which of the ten angles it used, and every send records
whether it was opened, clicked, bounced or replied to. That is a labelled
dataset sitting unused: it can already say which message works on which kind of
school, and nothing ever asked it.

This runs on a timer, measures, and writes conclusions into agent_memory. The
assistant then opens every conversation already knowing them, and the campaign
wizard can be told which angle to pick rather than rotating blindly.

WHY IT IS ARITHMETIC AND NOT A MODEL

Counting is not a language problem. A model asked "which angle is best" would
paraphrase the numbers back with a confident tone and occasionally invent one.
SQL cannot. The model's job is to explain a finding to a person; producing the
finding is this file's job.

WHAT KEEPS IT HONEST

Small samples lie loudly. An angle that is 1-for-2 is not "50% reply rate", so
every finding carries a sample size, nothing below MIN_SAMPLE is written at
all, and confidence scales with the evidence. Findings expire, because a
conclusion drawn from 600 sends should not still be quoted at 6,000.
"""

from __future__ import annotations

import time
from typing import Any

from outreach import agent_memory, db
from utils import pipeline_events

# Below this, a difference is noise. Cold outreach reply rates live around 1%,
# so a handful of sends cannot separate a good angle from a lucky one.
MIN_SAMPLE = 25
FACT_TTL_DAYS = 14.0


def _rows(sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    c = db.connect()
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def _rate(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def _confidence(sample: int) -> float:
    """More evidence, more confidence — capped, because this is observational.

    Nothing here is a controlled experiment: angles are assigned by a hash of
    the account, not at random, so a finding is a strong hint and never proof.
    """
    if sample >= 400:
        return 0.85
    if sample >= 200:
        return 0.75
    if sample >= 100:
        return 0.65
    if sample >= 50:
        return 0.55
    return 0.45


def learn_angle_performance() -> list[str]:
    """Which message works, measured per angle."""
    rows = _rows(
        """
        SELECT COALESCE(NULLIF(sq.angle,''),'(none)') AS angle,
               COUNT(*) AS sent,
               COUNT(*) FILTER (WHERE COALESCE(st.open_count,0) > 0)  AS opened,
               COUNT(*) FILTER (WHERE COALESCE(st.click_count,0) > 0) AS clicked,
               COUNT(*) FILTER (WHERE COALESCE(st.bounced,0) = 1)     AS bounced
        FROM email_steps st
        JOIN email_sequences sq ON sq.id = st.sequence_id
        WHERE st.status = 'sent'
        GROUP BY 1
        HAVING COUNT(*) >= %d
        ORDER BY 2 DESC
        """.replace("%d", str(MIN_SAMPLE))
    )
    if not rows:
        return []

    written: list[str] = []
    for r in rows:
        sent = int(r["sent"])
        click_rate = _rate(int(r["clicked"]), sent)
        open_rate = _rate(int(r["opened"]), sent)
        bounce_rate = _rate(int(r["bounced"]), sent)
        agent_memory.remember(
            kind="learned",
            subject=f"angle:{r['angle']}",
            fact=(
                f"The '{r['angle']}' message has been sent {sent} times: "
                f"{open_rate}% opened, {click_rate}% clicked, {bounce_rate}% bounced."
            ),
            confidence=_confidence(sent),
            evidence=r,
            source="agent_learn",
            ttl_days=FACT_TTL_DAYS,
        )

    ranked = sorted(rows, key=lambda r: _rate(int(r["clicked"]), int(r["sent"])), reverse=True)
    best, worst = ranked[0], ranked[-1]
    if best["angle"] != worst["angle"]:
        b = _rate(int(best["clicked"]), int(best["sent"]))
        w = _rate(int(worst["clicked"]), int(worst["sent"]))
        if b - w >= 3.0:
            fact = (
                f"'{best['angle']}' is the strongest message so far at {b}% clicked "
                f"over {best['sent']} sends; '{worst['angle']}' is the weakest at {w}% "
                f"over {worst['sent']}. Prefer the former until this changes."
            )
            agent_memory.remember(
                kind="learned",
                subject="angle:ranking",
                fact=fact,
                confidence=_confidence(int(best["sent"]) + int(worst["sent"])),
                evidence={"best": best, "worst": worst},
                source="agent_learn",
                ttl_days=FACT_TTL_DAYS,
            )
            written.append(fact)
    return written


def learn_deliverability() -> list[str]:
    """Where the bounces actually come from, by recipient domain suffix."""
    rows = _rows(
        """
        SELECT CASE
                 WHEN sq.to_email LIKE '%%.k12.%%' THEN 'k12 district'
                 WHEN sq.to_email LIKE '%%.edu'   THEN 'university (.edu)'
                 WHEN sq.to_email LIKE '%%.org'   THEN 'nonprofit (.org)'
                 WHEN sq.to_email LIKE '%%.gov'   THEN 'government (.gov)'
                 ELSE 'other'
               END AS segment,
               COUNT(*) AS sent,
               COUNT(*) FILTER (WHERE COALESCE(st.bounced,0) = 1) AS bounced
        FROM email_steps st
        JOIN email_sequences sq ON sq.id = st.sequence_id
        WHERE st.status = 'sent'
        GROUP BY 1
        HAVING COUNT(*) >= %d
        ORDER BY 2 DESC
        """.replace("%d", str(MIN_SAMPLE))
    )
    written: list[str] = []
    for r in rows:
        sent, bounced = int(r["sent"]), int(r["bounced"])
        rate = _rate(bounced, sent)
        agent_memory.remember(
            kind="learned",
            subject=f"deliverability:{r['segment']}",
            fact=(
                f"{r['segment']} addresses bounce at {rate}% "
                f"({bounced} of {sent} sent)."
                + (" That is above the 5% healthy threshold." if rate > 5 else "")
            ),
            confidence=_confidence(sent),
            evidence=r,
            source="agent_learn",
            ttl_days=FACT_TTL_DAYS,
        )
        if rate > 8:
            written.append(f"{r['segment']} bounces at {rate}%")
    return written


def learn_engagement_shape() -> list[str]:
    """How many openers go on to click, and whether anyone replies at all."""
    r = _rows(
        """
        SELECT COUNT(*) AS sent,
               COUNT(*) FILTER (WHERE COALESCE(open_count,0) > 0)  AS opened,
               COUNT(*) FILTER (WHERE COALESCE(click_count,0) > 0) AS clicked
        FROM email_steps WHERE status = 'sent'
        """
    )
    if not r:
        return []
    sent, opened, clicked = int(r[0]["sent"]), int(r[0]["opened"]), int(r[0]["clicked"])
    if sent < MIN_SAMPLE:
        return []

    replies = _rows("SELECT COUNT(*) AS n FROM email_sequences WHERE status = 'replied'")
    replied = int(replies[0]["n"]) if replies else 0

    written: list[str] = []

    # Clicks approaching opens is the signature of security scanners fetching
    # every link, not of unusually engaged readers. Districts run Proofpoint and
    # Safe Links; treating that as interest overstates the funnel badly.
    if opened and clicked / max(1, opened) > 0.7:
        fact = (
            f"Clicks ({clicked}) are close to opens ({opened}), which is the "
            "signature of security scanners rather than real readers. Treat both "
            "figures as an upper bound."
        )
        agent_memory.remember(
            kind="learned", subject="engagement:scanner-inflation", fact=fact,
            confidence=0.7, evidence={"sent": sent, "opened": opened, "clicked": clicked},
            source="agent_learn", ttl_days=FACT_TTL_DAYS,
        )
        written.append(fact)

    if sent >= 300 and replied == 0:
        fact = (
            f"{sent} emails have been sent and no human has replied. At a normal "
            "1% reply rate that is well below expectation, so the problem is the "
            "list or the offer, not the volume."
        )
        agent_memory.remember(
            kind="learned", subject="engagement:zero-replies", fact=fact,
            confidence=0.8, evidence={"sent": sent, "replied": replied},
            source="agent_learn", ttl_days=FACT_TTL_DAYS,
        )
        written.append(fact)

    return written


def learn_pipeline_health() -> list[str]:
    """Whether the machine that feeds the campaign is actually feeding it."""
    r = _rows(
        """
        SELECT COUNT(*) AS accounts,
               COUNT(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM contacts c
                   WHERE c.account_id = accounts.id AND c.email LIKE '%@%'
               )) AS no_contact
        FROM accounts
        """
    )
    if not r:
        return []
    total, no_contact = int(r[0]["accounts"]), int(r[0]["no_contact"])
    if not total:
        return []
    share = _rate(no_contact, total)
    fact = (
        f"{no_contact} of {total} leads ({share}%) have no contact address yet. "
        "Contact-finding, not the send cap, is what limits how many emails can go out."
    )
    agent_memory.remember(
        kind="learned", subject="pipeline:address-coverage", fact=fact,
        confidence=0.9, evidence={"accounts": total, "no_contact": no_contact},
        source="agent_learn", ttl_days=3.0,
    )
    return [fact] if share > 50 else []


def run() -> dict[str, Any]:
    """One learning pass. Cheap, idempotent, safe on a timer."""
    agent_memory.init_db()
    headlines: list[str] = []
    for step in (
        learn_angle_performance,
        learn_deliverability,
        learn_engagement_shape,
        learn_pipeline_health,
    ):
        try:
            headlines.extend(step())
        except Exception as e:  # noqa: BLE001 — one bad query must not stop the rest
            print(f"  agent-learn: {step.__name__} failed ({type(e).__name__}: {e})")

    s = agent_memory.stats()
    if headlines:
        pipeline_events.emit(
            "learning", f"Learned: {headlines[0]}", level="info"
        )
    return {"ok": True, "headlines": headlines, "facts": s.get("facts", 0)}


# ------------------------------------------------------------- scheduler ---

_LOCK = __import__("threading").Lock()
_STARTED = False


def _loop(interval_sec: int) -> None:
    while True:
        try:
            run()
        except Exception as e:  # noqa: BLE001
            print(f"  agent-learn: pass failed ({type(e).__name__}: {e})", flush=True)
        time.sleep(max(600, interval_sec))


def ensure_scheduler(interval_sec: int = 3600) -> None:
    """Learn once an hour. The underlying counts move slowly; anything faster
    burns queries to restate the same conclusion."""
    global _STARTED
    import threading

    with _LOCK:
        if _STARTED:
            return
        threading.Thread(
            target=_loop, args=(interval_sec,), daemon=True, name="agent-learn"
        ).start()
        _STARTED = True
