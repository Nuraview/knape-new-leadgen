"""Persistence for outreach email sequences + per-step send log / schedule.

Tables live in the cockpit Postgres DB so the dashboard can read them directly.

- ``email_sequences``: one per (account, send action). Holds recipient + status.
- ``email_steps``: the first email + follow-ups, each with its scheduled/sent
  time and outcome. The background scheduler sends steps whose ``scheduled_at``
  has passed and whose ``status`` is still ``pending``.
"""

from __future__ import annotations

import json
import secrets
import time
from typing import Any

from outreach import db


def _conn() -> db._Conn:
    return db.connect()


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS email_sequences (
                id BIGSERIAL PRIMARY KEY,
                account_id INTEGER,
                company TEXT,
                person_name TEXT,
                to_email TEXT NOT NULL,
                from_email TEXT,
                provider TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at DOUBLE PRECISION NOT NULL,
                started_at DOUBLE PRECISION,
                updated_at DOUBLE PRECISION
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS email_steps (
                id BIGSERIAL PRIMARY KEY,
                sequence_id INTEGER NOT NULL,
                step_index INTEGER NOT NULL,
                subject TEXT,
                body TEXT,
                delay_after_prev_days INTEGER DEFAULT 0,
                scheduled_at DOUBLE PRECISION,
                sent_at DOUBLE PRECISION,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                message_id TEXT
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_steps_seq ON email_steps(sequence_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_steps_due ON email_steps(status, scheduled_at)")
        # Append-only log of every actual SMTP send (lead steps + compose), used
        # for the per-send gap + rolling daily cap reputation guards.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS email_send_log (
                id BIGSERIAL PRIMARY KEY,
                ts DOUBLE PRECISION NOT NULL,
                to_email TEXT,
                kind TEXT
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_send_log_ts ON email_send_log(ts)")
        # Manually composed + sent messages (the "Outbox"). Lead-sequence emails
        # live in email_sequences/email_steps; this is only the compose-box sends.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS outbox_messages (
                id BIGSERIAL PRIMARY KEY,
                ts DOUBLE PRECISION NOT NULL,
                to_email TEXT,
                subject TEXT,
                body TEXT,
                message_id TEXT
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_outbox_ts ON outbox_messages(ts)")
        # Bounce tracking columns on email_steps (idempotent for existing DBs).
        c.execute("ALTER TABLE email_steps ADD COLUMN IF NOT EXISTS bounced INTEGER DEFAULT 0")
        c.execute("ALTER TABLE email_steps ADD COLUMN IF NOT EXISTS bounce_at DOUBLE PRECISION")
        c.execute("ALTER TABLE email_steps ADD COLUMN IF NOT EXISTS bounce_info TEXT")
        # Open/click engagement tracking (pixel + click-redirect). Each sent email
        # carries a unique track_token embedded in its pixel + rewritten links.
        c.execute("ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS angle TEXT")
        for col, ddl in (
            ("track_token", "TEXT"),
            ("open_at", "DOUBLE PRECISION"),
            ("first_open_at", "DOUBLE PRECISION"),
            ("open_count", "INTEGER DEFAULT 0"),
            ("click_at", "DOUBLE PRECISION"),
            ("click_count", "INTEGER DEFAULT 0"),
        ):
            c.execute(f"ALTER TABLE email_steps ADD COLUMN IF NOT EXISTS {col} {ddl}")
            c.execute(f"ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS {col} {ddl}")
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_steps_token ON email_steps(track_token)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_outbox_token ON outbox_messages(track_token)")
        # Append-only raw engagement events (for the who-opened/clicked drill-down).
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS email_events (
                id BIGSERIAL PRIMARY KEY,
                ts DOUBLE PRECISION NOT NULL,
                kind TEXT NOT NULL,
                token TEXT,
                to_email TEXT,
                url TEXT,
                ip TEXT,
                user_agent TEXT
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_events_ts ON email_events(ts)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_events_token ON email_events(token)")
        # Scanner filtering: security gateways (Proofpoint/Mimecast/Safe-Links) and
        # provider proxies auto-open + auto-click every link. Such hits are logged
        # with is_bot=1 and do NOT count toward a lead's open/click counters.
        c.execute("ALTER TABLE email_events ADD COLUMN IF NOT EXISTS is_bot INTEGER DEFAULT 0")
        c.execute("CREATE INDEX IF NOT EXISTS idx_email_events_ip ON email_events(ip)")
        c.commit()
    finally:
        c.close()


def sent_steps_index() -> list[dict[str, Any]]:
    """Sent steps with their message-id + recipient, for bounce matching."""
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT st.id, st.sequence_id, sq.to_email AS to_email, st.message_id, st.sent_at,
                   COALESCE(st.bounced, 0) AS bounced
            FROM email_steps st
            JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status = 'sent'
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def mark_step_bounced(step_id: int, info: str) -> bool:
    """Flag a step as bounced AND stop the rest of that lead's sequence — a dead
    address won't accept the follow-ups either, and re-hitting it just piles on
    reputation damage. Returns True only when it newly transitions (idempotent
    re-scans don't double-count)."""
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT COALESCE(bounced,0) AS b, sequence_id FROM email_steps WHERE id=?", (step_id,)).fetchone()
        if not row or int(row["b"]) == 1:
            return False
        seq_id = row["sequence_id"]
        c.execute(
            "UPDATE email_steps SET bounced=1, bounce_at=?, bounce_info=? WHERE id=?",
            (now, (info or "")[:600], step_id),
        )
        # Cancel every still-pending follow-up for this lead and stop the sequence.
        c.execute("UPDATE email_steps SET status='canceled' WHERE sequence_id=? AND status='pending'", (seq_id,))
        c.execute(
            "UPDATE email_sequences SET status='stopped', updated_at=? WHERE id=? AND status <> 'replied'",
            (now, seq_id),
        )
        c.commit()
        return True
    finally:
        c.close()


# ---------------------------------------------------------------------------
# Open / click engagement tracking
# ---------------------------------------------------------------------------
def new_token() -> str:
    """A short, unguessable token embedded in one email's pixel + links."""
    return secrets.token_urlsafe(9)


def set_step_token(step_id: int, token: str) -> None:
    c = _conn()
    try:
        c.execute("UPDATE email_steps SET track_token=? WHERE id=?", (token, step_id))
        c.commit()
    finally:
        c.close()


def _bump(table: str, token: str, kind: str) -> bool:
    """Increment open/click counters on the row owning ``token`` in ``table``.
    Returns True if a row matched. (email_steps has no recipient column — the
    address lives on email_sequences — so we don't RETURN it here.)"""
    now = time.time()
    c = _conn()
    try:
        if kind == "open":
            cur = c.execute(
                f"UPDATE {table} SET open_count=COALESCE(open_count,0)+1, open_at=?, "
                f"first_open_at=COALESCE(first_open_at,?) WHERE track_token=?",
                (now, now, token),
            )
        else:
            cur = c.execute(
                f"UPDATE {table} SET click_count=COALESCE(click_count,0)+1, click_at=?, "
                f"first_open_at=COALESCE(first_open_at,?) WHERE track_token=?",
                (now, now, token),
            )
        matched = (cur.rowcount or 0) > 0
        c.commit()
        return matched
    finally:
        c.close()


def _resolve_email(token: str) -> str:
    """Recipient address for a token (sequence step first, else outbox)."""
    c = _conn()
    try:
        r = c.execute(
            "SELECT sq.to_email FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id "
            "WHERE st.track_token=?",
            (token,),
        ).fetchone()
        if r and r["to_email"]:
            return r["to_email"]
        r = c.execute("SELECT to_email FROM outbox_messages WHERE track_token=?", (token,)).fetchone()
        return (r["to_email"] if r else "") or ""
    finally:
        c.close()


def _log_event(kind: str, token: str, to_email: str, url: str, ip: str, ua: str, is_bot: bool = False) -> None:
    c = _conn()
    try:
        c.execute(
            "INSERT INTO email_events (ts, kind, token, to_email, url, ip, user_agent, is_bot) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (time.time(), kind, token, (to_email or "")[:200], (url or "")[:600],
             (ip or "")[:64], (ua or "")[:400], 1 if is_bot else 0),
        )
        c.commit()
    finally:
        c.close()


def _is_scanner(token: str, ip: str, kind: str) -> bool:
    """Heuristic: is this open/click an automated security scanner, not a human?

    Two strong, cheap signals:
      a) IP fan-out — one IP touching >=3 DIFFERENT emails within 2h is a shared
         mail-gateway scanner (a human only ever appears for their own email);
      b) instant hit — a click <60s (or open <20s) after send is a pre-delivery
         scan, not someone who read the email.
    """
    now = time.time()
    c = _conn()
    try:
        if ip:
            n = c.execute(
                "SELECT COUNT(DISTINCT token) AS n FROM email_events WHERE ip=? AND ts > ?",
                (ip, now - 7200),
            ).fetchone()["n"]
            if (n or 0) >= 3:
                return True
        r = c.execute("SELECT sent_at FROM email_steps WHERE track_token=?", (token,)).fetchone()
        if r and r["sent_at"]:
            age = now - float(r["sent_at"])
            if (kind == "click" and age < 60) or (kind == "open" and age < 20):
                return True
    except Exception:  # noqa: BLE001 — filtering must never break tracking
        return False
    finally:
        c.close()
    return False


def record_open(token: str, ip: str = "", ua: str = "") -> bool:
    """Mark an email opened by a HUMAN (a sequence step first, else an outbox
    message). Scanner hits are logged (is_bot=1) but don't touch the counters."""
    if not token:
        return False
    bot = _is_scanner(token, ip, "open")
    matched = False
    if not bot:
        matched = _bump("email_steps", token, "open") or _bump("outbox_messages", token, "open")
    _log_event("open", token, _resolve_email(token), "", ip, ua, is_bot=bot)
    return matched


def record_click(token: str, url: str, ip: str = "", ua: str = "") -> bool:
    """Mark a HUMAN click (also implies an open). Scanner clicks are logged but
    don't count."""
    if not token:
        return False
    bot = _is_scanner(token, ip, "click")
    matched = False
    if not bot:
        matched = _bump("email_steps", token, "click") or _bump("outbox_messages", token, "click")
    _log_event("click", token, _resolve_email(token), url, ip, ua, is_bot=bot)
    return matched


def email_stats(days: int = 7) -> dict[str, Any]:
    """Deliverability + engagement roll-up over sent sequence steps.

    Delivered is the honest self-hosted proxy (sent - bounced): a self-hosted
    SMTP accept is not an inbox-delivery confirmation, and there's no provider
    webhook, so we don't overclaim it.
    """
    since = time.time() - days * 86400
    c = _conn()
    try:
        def _agg(where: str, params: tuple) -> dict[str, int]:
            """One window, counted two different ways on purpose.

            `sent` is NEW PEOPLE: distinct recipients who received a first
            email (step 0) in this window. That is the only number allowed to
            be called "emails sent" — a follow-up is not a new email, it is the
            same conversation continued, and counting them together let a day
            of pure chasing read as a day of prospecting. Measured on 4 Aug:
            232 follow-ups, zero new people, reported as 86 sends.

            Distinct, not merely step-0 rows, because a bounce recovery enrols
            the same address a second time and that is still one person.

            `messages` keeps the total of everything that left, and it is what
            the open / click / bounce rates divide by. Restricting the
            denominator to first contacts would credit a follow-up's opens to
            an opener that was never sent, which inflates every rate on the
            page.
            """
            row = c.execute(
                f"""
                SELECT COUNT(*) AS messages,
                       COUNT(DISTINCT CASE WHEN COALESCE(st.step_index,0)=0
                                           THEN LOWER(sq.to_email) END) AS people,
                       COALESCE(SUM(CASE WHEN COALESCE(st.step_index,0)>0 THEN 1 ELSE 0 END),0) AS followups,
                       COALESCE(SUM(CASE WHEN COALESCE(st.bounced,0)=1 THEN 1 ELSE 0 END),0) AS bounced,
                       COALESCE(SUM(CASE WHEN COALESCE(st.open_count,0)>0 THEN 1 ELSE 0 END),0) AS opened,
                       COALESCE(SUM(CASE WHEN COALESCE(st.click_count,0)>0 THEN 1 ELSE 0 END),0) AS clicked
                FROM email_steps st
                JOIN email_sequences sq ON sq.id = st.sequence_id
                WHERE st.status='sent' {where}
                """,
                params,
            ).fetchone()
            messages = int(row["messages"] or 0)
            people = int(row["people"] or 0)
            followups = int(row["followups"] or 0)
            bounced = int(row["bounced"] or 0)
            opened = int(row["opened"] or 0)
            clicked = int(row["clicked"] or 0)
            delivered = max(0, messages - bounced)
            pct = lambda n, d: round(100.0 * n / d, 1) if d else 0.0
            return {
                # "sent" means new people. Everything on screen labelled
                # "emails sent" reads this key.
                "sent": people,
                "people": people,
                "followups": followups,
                "messages": messages,
                "delivered": delivered, "bounced": bounced,
                "opened": opened, "clicked": clicked,
                "open_rate": pct(opened, delivered),
                "click_rate": pct(clicked, delivered),
                "bounce_rate": pct(bounced, messages),
                "delivered_rate": pct(delivered, messages),
                "ctr_of_opens": pct(clicked, opened),
            }

        window = _agg("AND st.sent_at >= ?", (since,))
        overall = _agg("", ())
        # How many scanner hits we filtered out (so the rates above stay honest).
        scanner_filtered = int(
            c.execute(
                "SELECT COUNT(*) AS n FROM email_events WHERE is_bot=1 AND ts >= ?", (since,)
            ).fetchone()["n"]
            or 0
        )

        # Per-angle A/B (which of the 10 angles performs best), windowed.
        angle_rows = c.execute(
            """
            SELECT COALESCE(sq.angle,'(unset)') AS angle,
                   COUNT(*) AS sent,
                   COALESCE(SUM(CASE WHEN COALESCE(st.bounced,0)=1 THEN 1 ELSE 0 END),0) AS bounced,
                   COALESCE(SUM(CASE WHEN COALESCE(st.open_count,0)>0 THEN 1 ELSE 0 END),0) AS opened,
                   COALESCE(SUM(CASE WHEN COALESCE(st.click_count,0)>0 THEN 1 ELSE 0 END),0) AS clicked
            FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='sent' AND st.sent_at >= ?
            GROUP BY COALESCE(sq.angle,'(unset)')
            ORDER BY sent DESC
            """,
            (since,),
        ).fetchall()
        by_angle = []
        for r in angle_rows:
            sent = int(r["sent"] or 0)
            deliv = max(0, sent - int(r["bounced"] or 0))
            pct = lambda n, d: round(100.0 * n / d, 1) if d else 0.0
            by_angle.append({
                "angle": r["angle"], "sent": sent, "delivered": deliv,
                "opened": int(r["opened"] or 0), "clicked": int(r["clicked"] or 0),
                "open_rate": pct(int(r["opened"] or 0), deliv),
                "click_rate": pct(int(r["clicked"] or 0), deliv),
            })

        # Recent sent emails (newest first) for the dashboard table.
        recent = c.execute(
            """
            SELECT st.id, st.sent_at, st.subject, sq.company, sq.to_email, sq.person_name,
                   COALESCE(sq.angle,'') AS angle,
                   COALESCE(st.open_count,0) AS open_count, st.first_open_at,
                   COALESCE(st.click_count,0) AS click_count, COALESCE(st.bounced,0) AS bounced
            FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='sent'
            ORDER BY st.sent_at DESC NULLS LAST LIMIT 50
            """,
        ).fetchall()
        return {
            "days": days,
            "window": window,
            "overall": overall,
            "by_angle": by_angle,
            "recent": [dict(r) for r in recent],
            "scanner_filtered": scanner_filtered,
        }
    finally:
        c.close()


#: The reporting timezone for every per-day figure in the product.
#:
#: Not the server's (UTC), and deliberately not the browser's. The people who
#: read this dashboard are in India; the business, the schools being emailed
#: and the client are all US Eastern. A day bucketed by the reader's own clock
#: put a 6am IST scrape into "today" when it was still the previous evening in
#: Ohio, which is exactly the confusion that made a send count unreadable.
#: One fixed zone means two people in different countries discussing "yesterday"
#: mean the same 24 hours.
REPORTING_TZ = "America/New_York"

#: Where the reporting day starts, in REPORTING_TZ. Not midnight.
#:
#: "I would like this in a format it is from 6am to 6am next morning, so here
#: it needs to be as per the US timing" — VK, 2026-08-05. A run that starts in
#: the Indian afternoon lands in the small hours in Ohio, and a midnight
#: boundary split one working session across two reported days. 6am puts the
#: whole of a night's sending on the day whose morning it arrives for.
REPORTING_DAY_START_HOUR = 6


def sent_by_day(days: int = 14, tz: str = REPORTING_TZ) -> dict[str, Any]:
    """Emails out per calendar day, split into first contacts and follow-ups.

    There was no per-day send figure anywhere in the product. Every number on
    screen was either a seven-day roll-up or a queue depth, so "how many did we
    send yesterday?" had no answer, and the first small number to hand got read
    as one. It was the reply scanner's `scanned` count.

    `sent` counts ONLY step 0, a first email to someone never written to before.
    That is what "we sent 200 today" has to mean; counting follow-ups in it lets
    a day of pure chasing look like a day of prospecting. Follow-ups are counted
    beside it, because they are the visible proof the automation is working
    rather than idle.

    Bucketing happens in Python rather than SQL on purpose. `AT TIME ZONE` is
    Postgres-only and this module is written against a placeholder shim that
    also serves SQLite, and a day boundary is a presentation decision.

    Returns the newest `days` buckets oldest-first, plus today and yesterday
    named outright so the caller never has to work out which bucket is which.
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    try:
        zone = ZoneInfo(tz)
    except Exception:  # noqa: BLE001 — an unknown tz is a bad param, not an outage
        zone = ZoneInfo("UTC")

    # The reporting day runs 06:00 to 06:00, so shifting the clock back by six
    # hours makes an ordinary .date() land every timestamp in the right bucket:
    # 02:00 Wednesday becomes 20:00 Tuesday, which is the day it belongs to.
    def _report_date(ts: float):
        return (datetime.fromtimestamp(ts, zone)
                - timedelta(hours=REPORTING_DAY_START_HOUR)).date()

    today = _report_date(time.time())
    since = (
        datetime.combine(today - timedelta(days=days), datetime.min.time(), zone)
    ).timestamp()

    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT st.sent_at, COALESCE(st.bounced,0) AS bounced,
                   COALESCE(st.step_index,0) AS step_index,
                   LOWER(sq.to_email) AS to_email
            FROM email_steps st
            JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='sent' AND st.sent_at IS NOT NULL AND st.sent_at >= ?
            """,
            (since,),
        ).fetchall()
    finally:
        c.close()

    buckets: dict[str, dict[str, int]] = {}
    for i in range(days - 1, -1, -1):
        key = (today - timedelta(days=i)).isoformat()
        buckets[key] = {"date": key, "sent": 0, "followups": 0, "bounced": 0}
    # Distinct recipients per day, not step-0 rows: a bounce recovery enrols the
    # same address again and that is still one person contacted.
    seen: dict[str, set[str]] = {k: set() for k in buckets}
    for r in rows:
        key = _report_date(float(r["sent_at"])).isoformat()
        b = buckets.get(key)
        if b is None:
            continue
        if int(r["step_index"] or 0) == 0:
            addr = str(r["to_email"] or "")
            if addr and addr not in seen[key]:
                seen[key].add(addr)
                b["sent"] += 1
        else:
            b["followups"] += 1
        b["bounced"] += 1 if int(r["bounced"] or 0) else 0

    series = list(buckets.values())
    today_key = today.isoformat()
    yesterday_key = (today - timedelta(days=1)).isoformat()
    blank = {"sent": 0, "followups": 0}
    return {
        "timezone": str(zone),
        # Spelled out for the UI. "US Eastern" on screen is the difference
        # between a number someone trusts and a number someone argues about.
        "timezone_label": "US Eastern",
        #: The day runs 6am to 6am, so say so rather than let someone assume
        #: midnight and query why an early-hours send is on the previous day.
        "day_boundary": f"{REPORTING_DAY_START_HOUR}am to {REPORTING_DAY_START_HOUR}am US Eastern",
        "days": series,
        "today": buckets.get(today_key, blank)["sent"],
        "yesterday": buckets.get(yesterday_key, blank)["sent"],
        "followups_today": buckets.get(today_key, blank)["followups"],
        "followups_yesterday": buckets.get(yesterday_key, blank)["followups"],
        "followups_total": sum(b["followups"] for b in series),
        "sent_total": sum(b["sent"] for b in series),
    }


def send_capacity() -> dict[str, Any]:
    """What the mailboxes are allowed to send in a rolling 24h, and what's left.

    Sits next to the per-day counts because "we sent 86" only means something
    against "we were allowed 250". Without it a low day looks like a fault when
    it is a cap, and a capped day looks fine when it is a fault.
    """
    c = _conn()
    try:
        rows = c.execute(
            "SELECT id, email, COALESCE(daily_cap,25) AS daily_cap FROM outreach_inboxes WHERE COALESCE(enabled,1)=1"
        ).fetchall()
        cutoff = time.time() - 86400.0
        used_rows = c.execute(
            "SELECT inbox_email, COUNT(*) AS n FROM email_send_log WHERE ts >= ? GROUP BY inbox_email",
            (cutoff,),
        ).fetchall()
    finally:
        c.close()

    used_by = {str(r["inbox_email"] or ""): int(r["n"] or 0) for r in used_rows}
    mailboxes = []
    for r in rows:
        cap = int(r["daily_cap"] or 25)
        used = used_by.get(str(r["email"]), 0)
        mailboxes.append({
            "email": str(r["email"]),
            "daily_cap": cap,
            "used_24h": used,
            "remaining": max(0, cap - used),
        })
    return {
        "mailboxes": mailboxes,
        "capacity": sum(m["daily_cap"] for m in mailboxes),
        "used_24h": sum(m["used_24h"] for m in mailboxes),
        "remaining": sum(m["remaining"] for m in mailboxes),
    }


def recent_sent(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """Paginated 'recent sent emails' for the dashboard table (newest first)."""
    c = _conn()
    try:
        total = int(c.execute("SELECT COUNT(*) AS n FROM email_steps WHERE status='sent'").fetchone()["n"] or 0)
        rows = c.execute(
            """
            SELECT st.id, st.sequence_id, st.step_index, st.sent_at, st.subject,
                   sq.company, sq.to_email, sq.person_name,
                   sq.from_email, COALESCE(sq.angle,'') AS angle, sq.status AS sequence_status,
                   COALESCE(st.open_count,0) AS open_count, st.first_open_at,
                   COALESCE(st.click_count,0) AS click_count, COALESCE(st.bounced,0) AS bounced
            FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='sent'
            ORDER BY st.sent_at DESC NULLS LAST LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}
    finally:
        c.close()


def email_preview(step_id: int) -> dict[str, Any] | None:
    """Full detail for one sent email: lead/school, to, from, subject, the copy,
    the rendered HTML (what the recipient saw), and its engagement."""
    c = _conn()
    try:
        r = c.execute(
            """
            SELECT st.id, st.step_index, st.subject, st.body, st.sent_at, st.status,
                   COALESCE(st.open_count,0) AS open_count, st.first_open_at,
                   COALESCE(st.click_count,0) AS click_count, st.click_at,
                   COALESCE(st.bounced,0) AS bounced, st.bounce_info,
                   sq.company, sq.person_name, sq.to_email, sq.from_email,
                   COALESCE(sq.angle,'') AS angle, sq.account_id
            FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.id = ?
            """,
            (step_id,),
        ).fetchone()
        if not r:
            return None
        d = dict(r)
        try:  # render exactly what the recipient saw (greeting + copy + signature)
            import re as _re

            from outreach.email_sender import _body_to_html, _strip_body_links

            b = _strip_body_links(d.get("body") or "")
            b = _re.sub(r"^(hi|hey|hello)\b", "Hey", b, count=1, flags=_re.IGNORECASE)
            d["html"] = _body_to_html(b, d.get("from_email") or "", "Dan Rigby")
        except Exception:  # noqa: BLE001
            d["html"] = ""
        return d
    finally:
        c.close()


# Local-parts that mean "shared mailbox", for excluding bot replies from the
# attention counts. Kept in sync in spirit with pipeline.email_validate._ROLE —
# duplicated rather than imported because email_store must not depend on the
# pipeline package, which pulls in the whole scraping stack.
_ROLE_HINTS = (
    "info", "webmaster", "postmaster", "office", "contact", "support", "help",
    "admin", "noreply", "no-reply", "techhelp", "attendance", "counseling",
    "publicinformation", "communications", "parents", "registrar", "enrollment",
    "reception", "general", "mail", "team",
)

_NOT_ROLE_SQL = " AND ".join(
    f"split_part(lower(sq.to_email), '@', 1) NOT LIKE '%{h}%'" for h in _ROLE_HINTS
)


def attention_summary(limit: int = 10) -> dict[str, Any]:
    """What actually needs a human, and who.

    The dashboard could say how many emails went out but never what to DO about
    them. This is that: schools that clicked and heard nothing back are a call
    list, and nothing surfaced them.

    Replies from shared mailboxes are excluded rather than counted. All fourteen
    sequences marked "replied" before the reply detector was fixed came from
    role accounts — webmaster@, techhelp@, attendanceoffice@ — i.e. ticket
    systems acknowledging receipt. Telling the client he has fourteen replies
    and then handing him fourteen auto-acknowledgements is worse than saying
    zero, so the filter lives here and covers future false positives too.
    """
    c = _conn()
    try:
        def rows(where: str) -> list[dict[str, Any]]:
            return [
                dict(r)
                for r in c.execute(
                    f"""
                    SELECT DISTINCT ON (sq.id)
                           st.id, sq.id AS sequence_id, sq.company, sq.person_name,
                           sq.to_email, st.subject, COALESCE(sq.angle,'') AS angle,
                           st.sent_at, st.first_open_at,
                           COALESCE(st.open_count,0) AS open_count,
                           st.click_at, COALESCE(st.click_count,0) AS click_count
                    FROM email_steps st
                    JOIN email_sequences sq ON sq.id = st.sequence_id
                    WHERE {where}
                    ORDER BY sq.id, st.click_at DESC NULLS LAST, st.first_open_at DESC NULLS LAST
                    """
                ).fetchall()
            ]

        def count(where: str) -> int:
            r = c.execute(
                f"""
                SELECT COUNT(DISTINCT sq.id) AS n
                FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
                WHERE {where}
                """
            ).fetchone()
            return int(r["n"] or 0)

        live = "COALESCE(st.bounced,0) = 0 AND sq.status <> 'replied'"
        warm_where = f"COALESCE(st.click_count,0) > 0 AND {live}"
        open_where = (
            f"COALESCE(st.open_count,0) > 0 AND COALESCE(st.click_count,0) = 0 AND {live}"
        )

        warm = rows(warm_where)
        warm.sort(key=lambda r: (r.get("click_at") or 0), reverse=True)

        replies = int(
            c.execute(
                f"SELECT COUNT(*) AS n FROM email_sequences sq "
                f"WHERE sq.status = 'replied' AND {_NOT_ROLE_SQL}"
            ).fetchone()["n"]
            or 0
        )

        return {
            "warm": {"count": count(warm_where), "items": warm[:limit]},
            "opened": {"count": count(open_where)},
            "replies": {"count": replies},
            "bounced": {
                "count": int(
                    c.execute(
                        "SELECT COUNT(DISTINCT sequence_id) AS n FROM email_steps "
                        "WHERE COALESCE(bounced,0) = 1"
                    ).fetchone()["n"]
                    or 0
                )
            },
        }
    finally:
        c.close()


def engagement_list(kind: str, limit: int = 200) -> list[dict[str, Any]]:
    """Drill-down: recipients who opened / clicked / bounced (newest first)."""
    c = _conn()
    try:
        if kind == "clicked":
            cond = "COALESCE(st.click_count,0) > 0"
            order = "st.click_at DESC NULLS LAST"
        elif kind == "bounced":
            cond = "COALESCE(st.bounced,0) = 1"
            order = "st.bounce_at DESC NULLS LAST"
        else:  # opened
            cond = "COALESCE(st.open_count,0) > 0"
            order = "st.first_open_at DESC NULLS LAST"
        rows = c.execute(
            f"""
            SELECT st.id, sq.company, sq.person_name, sq.to_email, st.subject,
                   COALESCE(sq.angle,'') AS angle, st.sent_at, st.first_open_at,
                   COALESCE(st.open_count,0) AS open_count, st.click_at,
                   COALESCE(st.click_count,0) AS click_count, st.bounce_at, st.bounce_info
            FROM email_steps st JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='sent' AND {cond}
            ORDER BY {order} LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def record_send(to_email: str, kind: str, inbox_email: str | None = None) -> None:
    c = _conn()
    try:
        c.execute(
            "INSERT INTO email_send_log (ts, to_email, kind, inbox_email) VALUES (?, ?, ?, ?)",
            (time.time(), (to_email or "")[:200], (kind or "")[:40], (inbox_email or None)),
        )
        c.commit()
    finally:
        c.close()


def set_sequence_inbox(sequence_id: int, inbox_id: int, from_email: str) -> None:
    c = _conn()
    try:
        c.execute(
            "UPDATE email_sequences SET inbox_id=?, from_email=?, updated_at=? WHERE id=?",
            (inbox_id, from_email, time.time(), sequence_id),
        )
        c.commit()
    finally:
        c.close()


def sends_in_last_for_inbox(inbox_email: str, window_sec: float = 86400.0) -> int:
    c = _conn()
    try:
        r = c.execute(
            "SELECT COUNT(*) AS n FROM email_send_log WHERE inbox_email=? AND ts >= ?",
            (inbox_email, time.time() - window_sec),
        ).fetchone()
        return int(r["n"]) if r else 0
    finally:
        c.close()


def record_outbox(to_email: str, subject: str, body: str, message_id: str, track_token: str = "") -> int:
    """Store a manually-composed sent message for the Outbox view."""
    c = _conn()
    try:
        cur = c.execute(
            "INSERT INTO outbox_messages (ts, to_email, subject, body, message_id, track_token) "
            "VALUES (?,?,?,?,?,?) RETURNING id",
            (time.time(), (to_email or "")[:200], (subject or "")[:500], body or "",
             (message_id or "")[:500], (track_token or None)),
        )
        c.commit()
        return int(cur.fetchone()["id"])
    finally:
        c.close()


def list_outbox(limit: int = 200) -> list[dict[str, Any]]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT id, ts, to_email, subject, body, message_id FROM outbox_messages ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def delete_outbox(outbox_id: int) -> str | None:
    """Delete an Outbox record. Returns its Message-ID (so the caller can also
    remove it from the IMAP Sent folder), or None if it didn't exist."""
    c = _conn()
    try:
        row = c.execute("SELECT message_id FROM outbox_messages WHERE id=?", (outbox_id,)).fetchone()
        if not row:
            return None
        c.execute("DELETE FROM outbox_messages WHERE id=?", (outbox_id,))
        c.commit()
        return row["message_id"] or ""
    finally:
        c.close()


def mark_replied(sequence_id: int) -> None:
    """A human wrote back: stop the ladder and record it.

    Public counterpart to reply_scan's private version, so the inbox agent does
    not have to reach into another module's internals to say the same thing.
    """
    now = time.time()
    c = _conn()
    try:
        c.execute(
            "UPDATE email_sequences SET replied=1, status='replied', updated_at=? WHERE id=?",
            (now, int(sequence_id)),
        )
        c.execute(
            "UPDATE email_steps SET status='stopped' WHERE sequence_id=? AND status='pending'",
            (int(sequence_id),),
        )
        c.commit()
    finally:
        c.close()


def defer_followups(sequence_id: int, until_ts: float) -> int:
    """Push this sequence's pending follow-ups past ``until_ts``.

    Different from stop_followups, which cancels. An out-of-office is not a no:
    the person is back on a known date, and the right move is to arrive after
    they are, not to give up on them or to keep writing into an empty mailbox.

    Only moves steps that would otherwise land too early, and only forwards, so
    running this twice cannot drag a sequence backwards.
    """
    c = _conn()
    try:
        cur = c.execute(
            """
            UPDATE email_steps SET scheduled_at = ?
             WHERE sequence_id = ? AND status = 'pending'
               AND (scheduled_at IS NULL OR scheduled_at < ?)
            """,
            (until_ts, int(sequence_id), until_ts),
        )
        c.commit()
        return int(getattr(cur, "rowcount", 0) or 0)
    finally:
        c.close()


def add_contact_if_new(
    *, account_id: int, email: str, person_name: str = "", job_title: str = ""
) -> bool:
    """Record a contact we learned about, if the address is not already known.

    Out-of-office replies routinely name a colleague to contact instead. That is
    a better lead than the one we wrote to — a named human, volunteered by the
    organisation — and it was being thrown away with the rest of the auto-reply.
    """
    addr = (email or "").strip().lower()
    if "@" not in addr:
        return False
    c = _conn()
    try:
        exists = c.execute(
            "SELECT 1 FROM contacts WHERE lower(email) = ? LIMIT 1", (addr,)
        ).fetchone()
        if exists:
            return False
        c.execute(
            "INSERT INTO contacts (account_id, person_name, job_title, email, "
            "role_rank, confidence, source_kind) VALUES (?,?,?,?,?,?,?)",
            (int(account_id), person_name or None, job_title or None, addr, 0, 0.6,
             "out_of_office_referral"),
        )
        c.commit()
        return True
    finally:
        c.close()


def sequence_by_recipient(email: str) -> dict[str, Any] | None:
    """Newest sequence written to this address, for matching an inbound reply."""
    addr = (email or "").strip().lower()
    if not addr:
        return None
    c = _conn()
    try:
        r = c.execute(
            "SELECT * FROM email_sequences WHERE lower(to_email) = ? "
            "ORDER BY id DESC LIMIT 1",
            (addr,),
        ).fetchone()
        return dict(r) if r else None
    finally:
        c.close()


def stop_followups(sequence_id: int) -> dict[str, Any]:
    """Cancel all still-pending steps of a sequence and mark it stopped, so the
    background scheduler never sends its remaining follow-ups. Already-sent
    emails are untouched (they're already out)."""
    now = time.time()
    c = _conn()
    try:
        cur = c.execute(
            "UPDATE email_steps SET status='canceled' WHERE sequence_id=? AND status='pending'",
            (sequence_id,),
        )
        canceled = cur.rowcount
        c.execute(
            "UPDATE email_sequences SET status='stopped', updated_at=? WHERE id=?",
            (now, sequence_id),
        )
        c.commit()
        return {"stopped": True, "canceled_steps": canceled}
    finally:
        c.close()


def approve_sequence(sequence_id: int, to_email: str | None = None) -> dict[str, Any] | None:
    """Move a draft into the approved send queue (nothing is sent yet).

    Only draft/failed (or already-approved, to update the recipient) sequences
    can be approved. Returns the hydrated sequence, or None if not approvable."""
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT * FROM email_sequences WHERE id=?", (sequence_id,)).fetchone()
        if not row or row["status"] not in ("draft", "failed", "approved"):
            return None
        if to_email:
            c.execute(
                "UPDATE email_sequences SET to_email=?, status='approved', updated_at=? WHERE id=?",
                (to_email, now, sequence_id),
            )
        else:
            c.execute(
                "UPDATE email_sequences SET status='approved', updated_at=? WHERE id=?",
                (now, sequence_id),
            )
        c.commit()
        return _hydrate(c, c.execute("SELECT * FROM email_sequences WHERE id=?", (sequence_id,)).fetchone())
    finally:
        c.close()


def unapprove_sequence(sequence_id: int) -> dict[str, Any] | None:
    """Pull an approved sequence out of the send queue, back to editable draft."""
    c = _conn()
    try:
        row = c.execute("SELECT * FROM email_sequences WHERE id=?", (sequence_id,)).fetchone()
        if not row or row["status"] != "approved":
            return None
        c.execute(
            "UPDATE email_sequences SET status='draft', updated_at=? WHERE id=?",
            (time.time(), sequence_id),
        )
        c.commit()
        return _hydrate(c, c.execute("SELECT * FROM email_sequences WHERE id=?", (sequence_id,)).fetchone())
    finally:
        c.close()


def list_approved() -> list[dict[str, Any]]:
    """All sequences waiting in the approved send queue, oldest approval first."""
    c = _conn()
    try:
        rows = c.execute(
            "SELECT * FROM email_sequences WHERE status='approved' ORDER BY COALESCE(updated_at, created_at) ASC"
        ).fetchall()
        return [_hydrate(c, r) for r in rows]
    finally:
        c.close()


def delete_sequence(sequence_id: int) -> bool:
    """Remove a sequence and its steps from the dashboard log. Does not unsend
    anything already delivered."""
    c = _conn()
    try:
        row = c.execute("SELECT id FROM email_sequences WHERE id=?", (sequence_id,)).fetchone()
        if not row:
            return False
        c.execute("DELETE FROM email_steps WHERE sequence_id=?", (sequence_id,))
        c.execute("DELETE FROM email_sequences WHERE id=?", (sequence_id,))
        c.commit()
        return True
    finally:
        c.close()


def sends_in_last(window_sec: float = 86400.0) -> int:
    c = _conn()
    try:
        row = c.execute(
            "SELECT COUNT(*) AS n FROM email_send_log WHERE ts >= ?", (time.time() - window_sec,)
        ).fetchone()
        return int(row["n"]) if row else 0
    finally:
        c.close()


def last_send_ts() -> float | None:
    c = _conn()
    try:
        row = c.execute("SELECT MAX(ts) AS t FROM email_send_log").fetchone()
        return float(row["t"]) if row and row["t"] is not None else None
    finally:
        c.close()


def get_sequence_for_account(account_id: int) -> dict[str, Any] | None:
    c = _conn()
    try:
        row = c.execute(
            "SELECT * FROM email_sequences WHERE account_id = ? ORDER BY id DESC LIMIT 1",
            (account_id,),
        ).fetchone()
        if not row:
            return None
        return _hydrate(c, row)
    finally:
        c.close()


def _hydrate(c: db._Conn, seq_row: dict[str, Any]) -> dict[str, Any]:
    steps = c.execute(
        "SELECT * FROM email_steps WHERE sequence_id = ? ORDER BY step_index ASC",
        (seq_row["id"],),
    ).fetchall()
    d = dict(seq_row)
    d["steps"] = [dict(s) for s in steps]
    return d


def upsert_draft(
    *,
    account_id: int,
    company: str,
    person_name: str,
    to_email: str,
    from_email: str,
    provider: str,
    steps: list[dict[str, Any]],
    angle: str | None = None,
) -> dict[str, Any]:
    """Create/replace the DRAFT sequence for an account. Won't touch a sequence
    that is already sending/sent (returns it unchanged)."""
    now = time.time()
    c = _conn()
    try:
        existing = c.execute(
            "SELECT * FROM email_sequences WHERE account_id = ? ORDER BY id DESC LIMIT 1",
            (account_id,),
        ).fetchone()
        if existing and existing["status"] not in ("draft", "failed"):
            return _hydrate(c, existing)
        if existing:
            c.execute("DELETE FROM email_steps WHERE sequence_id = ?", (existing["id"],))
            c.execute(
                "UPDATE email_sequences SET company=?, person_name=?, to_email=?, from_email=?, "
                "provider=?, angle=?, status='draft', updated_at=? WHERE id=?",
                (company, person_name, to_email, from_email, provider, angle, now, existing["id"]),
            )
            seq_id = existing["id"]
        else:
            cur = c.execute(
                "INSERT INTO email_sequences (account_id, company, person_name, to_email, from_email, "
                "provider, angle, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'draft', ?, ?) RETURNING id",
                (account_id, company, person_name, to_email, from_email, provider, angle, now, now),
            )
            seq_id = cur.fetchone()["id"]
        for i, st in enumerate(steps):
            c.execute(
                "INSERT INTO email_steps (sequence_id, step_index, subject, body, "
                "delay_after_prev_days, status) VALUES (?,?,?,?,?, 'pending')",
                (seq_id, i, st.get("subject", ""), st.get("body", ""), int(st.get("delay_after_prev_days", 0))),
            )
        c.commit()
        row = c.execute("SELECT * FROM email_sequences WHERE id = ?", (seq_id,)).fetchone()
        return _hydrate(c, row)
    finally:
        c.close()


def create_sequence(
    *,
    account_id: int,
    company: str,
    person_name: str,
    to_email: str,
    from_email: str,
    provider: str,
    steps: list[dict[str, Any]],
    angle: str | None = None,
) -> dict[str, Any]:
    """ALWAYS insert a fresh draft sequence (used by bounce requeue). Unlike
    ``upsert_draft`` it never touches the account's prior sequence — a bounced/
    stopped one stays behind as history, and ``get_sequence_for_account``
    (newest id wins) surfaces this new one on the lead card."""
    now = time.time()
    c = _conn()
    try:
        cur = c.execute(
            "INSERT INTO email_sequences (account_id, company, person_name, to_email, from_email, "
            "provider, angle, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'draft', ?, ?) RETURNING id",
            (account_id, company, person_name, to_email, from_email, provider, angle, now, now),
        )
        seq_id = cur.fetchone()["id"]
        for i, st in enumerate(steps):
            c.execute(
                "INSERT INTO email_steps (sequence_id, step_index, subject, body, "
                "delay_after_prev_days, status) VALUES (?,?,?,?,?, 'pending')",
                (seq_id, i, st.get("subject", ""), st.get("body", ""), int(st.get("delay_after_prev_days", 0))),
            )
        c.commit()
        row = c.execute("SELECT * FROM email_sequences WHERE id = ?", (seq_id,)).fetchone()
        return _hydrate(c, row)
    finally:
        c.close()


def mark_sequence_started(sequence_id: int) -> None:
    now = time.time()
    c = _conn()
    try:
        c.execute(
            "UPDATE email_sequences SET status='sending', started_at=COALESCE(started_at, ?), updated_at=? WHERE id=?",
            (now, now, sequence_id),
        )
        # Schedule each step relative to now using cumulative delays.
        steps = c.execute(
            "SELECT id, step_index, delay_after_prev_days FROM email_steps WHERE sequence_id=? ORDER BY step_index",
            (sequence_id,),
        ).fetchall()
        cumulative = 0
        for s in steps:
            cumulative += max(0, int(s["delay_after_prev_days"] or 0))
            sched = now + cumulative * 86400
            c.execute("UPDATE email_steps SET scheduled_at=? WHERE id=?", (sched, s["id"]))
        c.commit()
    finally:
        c.close()


def mark_step_sent(step_id: int, message_id: str) -> None:
    now = time.time()
    c = _conn()
    try:
        c.execute(
            "UPDATE email_steps SET status='sent', sent_at=?, message_id=?, error=NULL WHERE id=?",
            (now, message_id, step_id),
        )
        c.commit()
    finally:
        c.close()


def cancel_step(step_id: int, reason: str) -> None:
    """Drop a queued step without counting it as a failure.

    A failure means we tried and the send broke. This is the opposite: we
    looked at the recipient and decided not to spend a send on them, which
    should not colour the delivery stats or trigger a retry.
    """
    c = _conn()
    try:
        c.execute(
            "UPDATE email_steps SET status='canceled', error=? WHERE id=? AND status='pending'",
            ((reason or "")[:300], step_id),
        )
        c.commit()
    finally:
        c.close()


def mark_step_failed(step_id: int, error: str) -> None:
    c = _conn()
    try:
        c.execute("UPDATE email_steps SET status='failed', error=? WHERE id=?", (error[:500], step_id))
        c.commit()
    finally:
        c.close()


def refresh_sequence_status(sequence_id: int) -> None:
    c = _conn()
    try:
        seq = c.execute("SELECT status FROM email_sequences WHERE id=?", (sequence_id,)).fetchone()
        if seq and seq["status"] == "stopped":
            return  # user explicitly stopped it — don't flip it back
        rows = c.execute(
            "SELECT status FROM email_steps WHERE sequence_id=?", (sequence_id,)
        ).fetchall()
        statuses = [r["status"] for r in rows]
        if statuses and all(s == "sent" for s in statuses):
            new = "sent"
        elif any(s == "pending" for s in statuses):
            new = "sending"
        elif any(s == "failed" for s in statuses) and not any(s == "pending" for s in statuses):
            new = "sent" if any(s == "sent" for s in statuses) else "failed"
        else:
            new = "sending"
        c.execute("UPDATE email_sequences SET status=?, updated_at=? WHERE id=?", (new, time.time(), sequence_id))
        c.commit()
    finally:
        c.close()


def scheduled_steps(days: int = 30, limit: int = 2000) -> list[dict[str, Any]]:
    """Pending steps still in the FUTURE, for the follow-up schedule.

    due_steps() answers "what should the scheduler send right now"; this answers
    "what is coming, and when". Nothing exposed either, so a 200-lead run with
    600 follow-ups queued behind it looked identical to one with none — the
    steps were there, the dashboard just had no query for them.

    Ordered by send time so the UI can group by date without sorting.
    """
    now = time.time()
    horizon = now + max(1, int(days)) * 86400.0
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT st.id, st.sequence_id, st.step_index, st.subject, st.scheduled_at,
                   st.delay_after_prev_days,
                   sq.to_email, sq.company, sq.person_name, sq.from_email,
                   COALESCE(sq.angle,'') AS angle, sq.status AS sequence_status
            FROM email_steps st
            JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status = 'pending'
              AND sq.status IN ('sending','sent','approved')
              AND st.scheduled_at IS NOT NULL
              AND st.scheduled_at > ?
              AND st.scheduled_at <= ?
            ORDER BY st.scheduled_at ASC
            LIMIT ?
            """,
            (now, horizon, int(limit)),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def scheduled_summary(days: int = 30) -> dict[str, Any]:
    """Counts behind the schedule: how many follow-ups are queued in total, and
    how many sequences they belong to. The tab badge reads from this rather than
    counting a truncated list."""
    now = time.time()
    horizon = now + max(1, int(days)) * 86400.0
    c = _conn()
    try:
        r = c.execute(
            """
            SELECT COUNT(*) AS steps, COUNT(DISTINCT st.sequence_id) AS sequences
            FROM email_steps st
            JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status = 'pending'
              AND sq.status IN ('sending','sent','approved')
              AND st.scheduled_at IS NOT NULL AND st.scheduled_at > ? AND st.scheduled_at <= ?
            """,
            (now, horizon),
        ).fetchone()
        return {"steps": int(r["steps"] or 0), "sequences": int(r["sequences"] or 0)}
    finally:
        c.close()


def due_steps(now: float | None = None) -> list[dict[str, Any]]:
    """Pending steps whose scheduled time has passed, for sequences that started."""
    now = now if now is not None else time.time()
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT st.*, sq.to_email, sq.company, sq.from_email, sq.inbox_id,
                   COALESCE(sq.angle,'') AS angle
            FROM email_steps st
            JOIN email_sequences sq ON sq.id = st.sequence_id
            WHERE st.status='pending' AND sq.status IN ('sending','sent')
              AND st.scheduled_at IS NOT NULL AND st.scheduled_at <= ?
            ORDER BY st.scheduled_at ASC
            """,
            (now,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def list_sequences(limit: int = 200) -> list[dict[str, Any]]:
    c = _conn()
    try:
        seqs = c.execute(
            "SELECT * FROM email_sequences ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?",
            (limit,),
        ).fetchall()
        out = []
        for s in seqs:
            d = _hydrate(c, s)
            pending = [st for st in d["steps"] if st["status"] == "pending"]
            nxt = min(pending, key=lambda x: x.get("scheduled_at") or 0) if pending else None
            d["next_step"] = nxt
            d["sent_count"] = sum(1 for st in d["steps"] if st["status"] == "sent")
            d["bounced_count"] = sum(1 for st in d["steps"] if st.get("bounced"))
            d["opened_count"] = sum(1 for st in d["steps"] if (st.get("open_count") or 0) > 0)
            d["clicked_count"] = sum(1 for st in d["steps"] if (st.get("click_count") or 0) > 0)
            out.append(d)
        return out
    finally:
        c.close()


def to_lead_context(seq: dict[str, Any]) -> dict[str, Any]:
    return {"company": seq.get("company"), "person_name": seq.get("person_name"), "email": seq.get("to_email")}


def export_event(d: dict[str, Any]) -> str:
    return json.dumps(d, default=str)
