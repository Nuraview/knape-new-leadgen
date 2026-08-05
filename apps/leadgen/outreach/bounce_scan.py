"""Detect bounced outreach by scanning the mailbox for delivery-status reports
(DSNs / MAILER-DAEMON) and matching them back to sent email steps.

Matching priority:
  1. original Message-ID in the DSN == the Message-ID we stored when sending
     (exact: identifies the precise email that bounced);
  2. otherwise the failed recipient address == a sent step's recipient.
"""

from __future__ import annotations

import email
import imaplib
import json
import re
import ssl
import time
from email.message import Message
from typing import Any

from outreach import email_store, outreach_store

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_MSGID_RE = re.compile(r"<[^>]+>")


def bounce_scan_configured() -> bool:
    """We can scan for bounces as long as at least one sending mailbox exists —
    each has its own IMAP creds; DSNs land in the mailbox that sent the message."""
    return bool(outreach_store.list_inboxes())


def _looks_like_bounce(headers_blob: str) -> bool:
    h = headers_blob.lower()
    return (
        "mailer-daemon" in h
        or "postmaster@" in h
        or "report-type=delivery-status" in h
        or "undelivered mail" in h
        or "delivery status notification" in h
        or "mail delivery failed" in h
        or "returned to sender" in h
    )


def _parse_dsn(msg: Message) -> dict[str, Any]:
    """Extract failed recipients, original message-ids, and a short reason."""
    failed_emails: set[str] = set()
    orig_msgids: set[str] = set()
    reason = ""
    subject = str(msg.get("Subject") or "")

    for part in msg.walk():
        ctype = part.get_content_type()
        if ctype == "message/delivery-status":
            payload = part.get_payload()
            blocks = payload if isinstance(payload, list) else []
            for blk in blocks:
                if not hasattr(blk, "items"):
                    continue
                action = str(blk.get("Action") or "").lower()
                for key in ("Final-Recipient", "Original-Recipient"):
                    val = blk.get(key)
                    if val:
                        m = _EMAIL_RE.search(str(val))
                        if m and ("fail" in action or not action):
                            failed_emails.add(m.group(0).lower())
                diag = blk.get("Diagnostic-Code") or blk.get("Status")
                if diag and not reason:
                    reason = " ".join(str(diag).split())[:280]
        elif ctype in ("message/rfc822", "text/rfc822-headers"):
            orig = part.get_payload()
            if isinstance(orig, list):
                orig = orig[0] if orig else None
            if hasattr(orig, "get"):
                mid = orig.get("Message-ID")
                if mid:
                    orig_msgids.add(str(mid).strip())
                to = orig.get("To")
                if to:
                    m = _EMAIL_RE.search(str(to))
                    if m:
                        failed_emails.add(m.group(0).lower())
            elif isinstance(orig, str):
                orig_msgids.update(_MSGID_RE.findall(orig))

    if not reason:
        reason = subject or "Delivery failed"
    return {"failed_emails": failed_emails, "orig_msgids": orig_msgids, "reason": reason}


def _load_uid_state() -> dict[str, int]:
    """Per-inbox IMAP UID high-water marks (so each tick only reads new mail)."""
    try:
        from outreach.app_settings import get_setting

        raw = get_setting("BOUNCE_SCAN_UIDS")
        return {k: int(v) for k, v in json.loads(raw).items()} if raw else {}
    except Exception:  # noqa: BLE001
        return {}


def _save_scan_state(uid_state: dict[str, int], result: dict[str, Any]) -> None:
    try:
        from outreach.app_settings import set_settings

        set_settings({
            "BOUNCE_SCAN_UIDS": json.dumps(uid_state),
            "BOUNCE_SCAN_LAST": json.dumps({"ts": time.time(), **result}),
        })
    except Exception:  # noqa: BLE001 — heartbeat is best-effort
        pass


def scan_bounces(limit_per_inbox: int = 200) -> dict[str, Any]:
    """Scan every sending mailbox for delivery-failure reports (DSNs) and mark
    matching sent steps. Each inbox is scanned with its own IMAP creds, since a
    bounce lands in the mailbox that sent the original. Incremental: only UIDs
    above each inbox's stored high-water mark are read (full window on first
    run). Per-inbox errors are captured, never swallowed. Returns ``{checked,
    bounces, new, inboxes}``."""
    sent = email_store.sent_steps_index()
    if not sent:
        return {"checked": 0, "bounces": 0, "new": 0, "inboxes": {}}
    by_msgid: dict[str, dict[str, Any]] = {}
    by_email: dict[str, list[dict[str, Any]]] = {}
    for st in sent:
        if st.get("message_id"):
            by_msgid[str(st["message_id"]).strip()] = st
        em = (st.get("to_email") or "").lower().strip()
        if em:
            by_email.setdefault(em, []).append(st)

    uid_state = _load_uid_state()
    checked = bounces = new = 0
    per_inbox: dict[str, dict[str, Any]] = {}
    for ib in outreach_store.list_inboxes(include_secrets=True):
        host = ib.get("imap_host") or ib.get("smtp_host")
        if not host or not ib.get("smtp_password"):
            continue
        stat = per_inbox.setdefault(ib["email"], {"checked": 0, "new": 0, "error": None})
        try:
            m = imaplib.IMAP4_SSL(host, int(ib.get("imap_port") or 993), timeout=25)
            m.login(ib.get("smtp_user") or ib["email"], ib["smtp_password"])
        except (imaplib.IMAP4.error, OSError, ssl.SSLError) as e:
            stat["error"] = f"{type(e).__name__}: {e}"[:200]
            continue
        try:
            m.select("INBOX", readonly=True)
            typ, data = m.uid("search", None, "ALL")
            uids = [int(u) for u in (data[0].split() if data and data[0] else [])]
            last = int(uid_state.get(ib["email"]) or 0)
            if uids and last > uids[-1]:
                last = 0  # UIDVALIDITY reset — rescan the window
            fresh = [u for u in uids if u > last][-limit_per_inbox:]
            for u in reversed(fresh):
                typ, d = m.uid("fetch", str(u), "(RFC822)")
                if typ != "OK" or not d or not isinstance(d[0], tuple):
                    continue
                msg = email.message_from_bytes(d[0][1])
                checked += 1
                stat["checked"] += 1
                blob = f"{msg.get('From','')} {msg.get('Subject','')} {msg.get_content_type()} {msg.get('Content-Type','')}"
                if not _looks_like_bounce(blob):
                    continue
                info = _parse_dsn(msg)
                if not info["failed_emails"] and not info["orig_msgids"]:
                    continue
                bounces += 1
                matched: dict[str, Any] | None = None
                for mid in info["orig_msgids"]:
                    if mid in by_msgid:
                        matched = by_msgid[mid]
                        break
                if matched is None:
                    for em in info["failed_emails"]:
                        cands = by_email.get(em)
                        if cands:
                            matched = max(cands, key=lambda s: s.get("sent_at") or 0)
                            break
                if matched is not None and email_store.mark_step_bounced(matched["id"], info["reason"]):
                    new += 1
                    stat["new"] += 1
            if uids:
                uid_state[ib["email"]] = uids[-1]  # clean pass — advance the mark
        except Exception as e:  # noqa: BLE001 — one bad inbox must not kill the pass
            stat["error"] = f"{type(e).__name__}: {e}"[:200]
        finally:
            try:
                m.logout()
            except Exception:
                pass
    result = {"checked": checked, "bounces": bounces, "new": new, "inboxes": per_inbox}
    _save_scan_state(uid_state, result)
    return result
