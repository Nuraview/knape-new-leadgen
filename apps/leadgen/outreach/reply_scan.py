"""Reply detection: scan each outreach inbox for replies to our sent steps and
auto-stop the sequence (mark replied, cancel pending follow-ups).

Matches by In-Reply-To / References against stored step Message-IDs, then falls
back to matching the reply's From address to a sequence recipient.
"""

from __future__ import annotations

import email
import email.utils
import imaplib
import ssl
import time
from typing import Any

from outreach import db, outreach_store
from outreach.bounce_scan import _looks_like_bounce


def _is_dsn_or_auto(hdr: email.message.Message) -> bool:
    """True for bounce DSNs / autoresponders — these must never count as replies
    (a MAILER-DAEMON report carries References: to our Message-ID and would
    otherwise match as a reply from the very address that bounced)."""
    frm = email.utils.parseaddr(hdr.get("From", ""))[1].lower()
    if not frm or frm.startswith(("mailer-daemon", "postmaster", "double-bounce")):
        return True
    auto = str(hdr.get("Auto-Submitted", "")).strip().lower()
    if auto and auto != "no":
        return True
    if str(hdr.get("Return-Path", "")).strip() == "<>":
        return True

    # Auto-Submitted is the standard header and plenty of autoresponders never
    # set it — school-district ticket systems in particular. Every one of the
    # fourteen sequences this scanner had marked "replied" was a role account
    # (webmaster@, info@, techhelp@, attendanceoffice@) answering automatically,
    # and the client was told he had replies he did not have. That is worse than
    # reporting zero, so the checks below are deliberately broad: a missed real
    # reply still sits in the inbox to be read, while a false one corrupts the
    # only number anybody is judging this campaign by.
    for header in ("X-Autoreply", "X-Autorespond", "X-Auto-Response-Suppress",
                   "X-Autoreply-From", "X-Mailer-Daemon"):
        if hdr.get(header):
            return True
    precedence = str(hdr.get("Precedence", "")).strip().lower()
    if precedence in ("bulk", "auto_reply", "junk", "list"):
        return True
    if str(hdr.get("X-Failed-Recipients", "")).strip():
        return True

    subject = str(hdr.get("Subject", "")).lower()
    AUTO_SUBJECT_MARKERS = (
        "out of office", "out-of-office", "automatic reply", "auto-reply",
        "autoreply", "away from my", "on vacation", "on leave",
        "thank you for contacting", "thanks for contacting",
        "we have received your", "your request has been received",
        "case has been created", "ticket has been created", "support ticket",
        "case #", "ticket #", "[request received]", "do not reply",
        "undeliverable", "delivery status notification",
    )
    if any(m in subject for m in AUTO_SUBJECT_MARKERS):
        return True

    # A no-reply sender is by definition not a person replying.
    if any(m in frm for m in ("noreply", "no-reply", "donotreply",
                              "do-not-reply", "notifications@", "automated")):
        return True

    blob = f"{hdr.get('From','')} {hdr.get('Subject','')} {hdr.get('Content-Type','')}"
    return _looks_like_bounce(blob)


def _sent_message_ids() -> dict[str, int]:
    """message_id -> sequence_id for sent steps of non-replied sequences."""
    c = db.connect()
    try:
        rows = c.execute(
            """SELECT st.message_id AS mid, st.sequence_id AS sid
               FROM email_steps st JOIN email_sequences sq ON sq.id=st.sequence_id
               WHERE st.status='sent' AND COALESCE(st.message_id,'')<>'' AND COALESCE(sq.replied,0)=0"""
        ).fetchall()
        return {r["mid"]: int(r["sid"]) for r in rows if r["mid"]}
    finally:
        c.close()


def _recipient_to_sequence() -> dict[str, int]:
    c = db.connect()
    try:
        rows = c.execute(
            "SELECT id, lower(to_email) AS to_email FROM email_sequences WHERE COALESCE(replied,0)=0 AND status IN ('sent','sending')"
        ).fetchall()
        return {r["to_email"]: int(r["id"]) for r in rows if r["to_email"]}
    finally:
        c.close()


def _mark_replied(sequence_id: int) -> None:
    c = db.connect()
    try:
        c.execute("UPDATE email_sequences SET replied=1, status='replied', updated_at=? WHERE id=?", (time.time(), sequence_id))
        # cancel pending follow-ups
        c.execute("UPDATE email_steps SET status='stopped' WHERE sequence_id=? AND status='pending'", (sequence_id,))
        c.commit()
    finally:
        c.close()


def scan_replies(limit_per_inbox: int = 40) -> dict[str, Any]:
    inboxes = outreach_store.list_inboxes(include_secrets=True)
    if not inboxes:
        return {"ok": True, "inboxes": 0, "replies": 0}
    by_mid = _sent_message_ids()
    by_rcpt = _recipient_to_sequence()
    replies = 0
    scanned = 0
    per_inbox: dict[str, dict[str, Any]] = {}
    for ib in inboxes:
        host = ib.get("imap_host") or ib.get("smtp_host")
        if not host or not ib.get("smtp_password"):
            continue
        stat = per_inbox.setdefault(ib["email"], {"scanned": 0, "replies": 0, "error": None})
        try:
            m = imaplib.IMAP4_SSL(host, int(ib.get("imap_port") or 993), timeout=20)
            m.login(ib.get("smtp_user") or ib["email"], ib["smtp_password"])
            m.select("INBOX")
            typ, data = m.search(None, "ALL")
            ids = data[0].split()[-limit_per_inbox:]
            for i in ids:
                typ, md = m.fetch(i, "(BODY.PEEK[HEADER])")
                if not md or not md[0]:
                    continue
                hdr = email.message_from_bytes(md[0][1])
                if _is_dsn_or_auto(hdr):
                    continue
                refs = (hdr.get("In-Reply-To", "") + " " + hdr.get("References", "")).strip()
                seq = None
                for mid, sid in by_mid.items():
                    if mid and mid in refs:
                        seq = sid
                        break
                if seq is None:
                    frm = email.utils.parseaddr(hdr.get("From", ""))[1].lower()
                    seq = by_rcpt.get(frm)
                if seq is not None:
                    _mark_replied(seq)
                    replies += 1
                    stat["replies"] += 1
                scanned += 1
                stat["scanned"] += 1
            m.logout()
        except Exception as e:  # noqa: BLE001 — one bad inbox must not kill the pass
            stat["error"] = f"{type(e).__name__}: {e}"[:200]
            continue
    result = {"ok": True, "inboxes": len(inboxes), "scanned": scanned, "replies": replies, "per_inbox": per_inbox}
    _record_last_run(result)
    return result


def _record_last_run(result: dict[str, Any]) -> None:
    """Persist the last scan summary so the dashboard can show scan health."""
    try:
        import json

        from outreach.app_settings import set_settings

        set_settings({"REPLY_SCAN_LAST": json.dumps({"ts": time.time(), **result})})
    except Exception:  # noqa: BLE001 — heartbeat is best-effort
        pass
