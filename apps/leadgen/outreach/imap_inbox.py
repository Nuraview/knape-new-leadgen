"""Read-side IMAP access for the in-app inbox (list + fetch a message)."""

from __future__ import annotations

import email
import imaplib
import re
import ssl
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

from config import (
    OUTREACH_IMAP_HOST,
    OUTREACH_IMAP_PORT,
    OUTREACH_SMTP_PASSWORD,
    OUTREACH_SMTP_USER,
)


class InboxError(RuntimeError):
    pass


def _creds() -> tuple[str, int, str, str]:
    """(host, port, user, password) — global config, else the first enabled
    Mailu outreach inbox (the sends already use those; the in-app Inbox should
    read the same mailbox instead of demanding a separate global IMAP config)."""
    if OUTREACH_IMAP_HOST and OUTREACH_SMTP_USER and OUTREACH_SMTP_PASSWORD:
        return OUTREACH_IMAP_HOST, OUTREACH_IMAP_PORT, OUTREACH_SMTP_USER, OUTREACH_SMTP_PASSWORD
    try:
        from outreach import outreach_store

        for ib in outreach_store.list_inboxes(include_secrets=True):
            if int(ib.get("enabled") or 0) and ib.get("smtp_password"):
                host = ib.get("imap_host") or ib.get("smtp_host") or ""
                return (
                    host,
                    int(ib.get("imap_port") or 993),
                    ib.get("smtp_user") or ib.get("email") or "",
                    ib.get("smtp_password") or "",
                )
    except Exception:  # noqa: BLE001
        pass
    return "", 993, "", ""


def imap_configured() -> bool:
    host, _port, user, pw = _creds()
    return bool(host and user and pw)


def _decode(s: Any) -> str:
    if not s:
        return ""
    try:
        return str(make_header(decode_header(str(s))))
    except Exception:
        return str(s)


def _connect() -> imaplib.IMAP4_SSL:
    host, port, user, pw = _creds()
    if not (host and user and pw):
        raise InboxError("IMAP not configured")
    try:
        m = imaplib.IMAP4_SSL(host, port, timeout=25)
        m.login(user, pw)
        return m
    except (imaplib.IMAP4.error, OSError, ssl.SSLError) as e:
        raise InboxError(f"IMAP login failed: {e}") from e


def _iso_date(raw: str) -> str:
    try:
        return parsedate_to_datetime(raw).isoformat()
    except Exception:
        return raw or ""


_UID_RE = re.compile(rb"UID (\d+)")


def list_messages(*, mailbox: str = "INBOX", limit: int = 40) -> dict[str, Any]:
    """Return newest-first message headers from a mailbox. ``id`` is the stable
    IMAP UID (safe for fetch/delete even after the mailbox changes)."""
    m = _connect()
    try:
        typ, _ = m.select(mailbox, readonly=True)
        if typ != "OK":
            raise InboxError(f"cannot open mailbox {mailbox!r}")
        typ, data = m.uid("search", None, "ALL")
        uids = data[0].split() if data and data[0] else []
        uids = uids[-limit:][::-1]  # newest first
        items: list[dict[str, Any]] = []
        if uids:
            uid_set = b",".join(uids)
            typ, fetched = m.uid("fetch", uid_set, "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            by_uid: dict[bytes, dict[str, Any]] = {}
            for part in fetched or []:
                if isinstance(part, tuple) and len(part) == 2:
                    meta = part[0] if isinstance(part[0], (bytes, bytearray)) else str(part[0]).encode()
                    um = _UID_RE.search(meta)
                    if not um:
                        continue
                    uid = um.group(1)
                    flags = b"\\Seen" in meta
                    hdr = email.message_from_bytes(part[1]) if isinstance(part[1], (bytes, bytearray)) else email.message_from_string(str(part[1]))
                    name, addr = parseaddr(_decode(hdr.get("From")))
                    by_uid[uid] = {
                        "id": uid.decode(),
                        "from_name": name,
                        "from_email": addr,
                        "subject": _decode(hdr.get("Subject")) or "(no subject)",
                        "date": _iso_date(hdr.get("Date", "")),
                        "seen": flags,
                    }
            for u in uids:
                if u in by_uid:
                    items.append(by_uid[u])
        return {"mailbox": mailbox, "count": len(items), "items": items}
    finally:
        try:
            m.logout()
        except Exception:
            pass


def delete_message(*, message_id: str, mailbox: str = "INBOX") -> dict[str, Any]:
    """Delete a message by UID — moves it to Trash when possible, else flags +
    expunges it. ``message_id`` is the UID from :func:`list_messages`."""
    m = _connect()
    try:
        typ, _ = m.select(mailbox)
        if typ != "OK":
            raise InboxError(f"cannot open mailbox {mailbox!r}")
        uid = message_id.encode()
        moved_to = ""
        for box in ("Trash", "INBOX.Trash", "Deleted Items", "Junk"):
            try:
                cp, _ = m.uid("copy", uid, box)
                if cp == "OK":
                    moved_to = box
                    break
            except imaplib.IMAP4.error:
                continue
        m.uid("store", uid, "+FLAGS", "(\\Deleted)")
        m.expunge()
        return {"deleted": True, "moved_to": moved_to or "(expunged)"}
    finally:
        try:
            m.logout()
        except Exception:
            pass


_SENT_BOXES = ("Sent", "INBOX.Sent", "Sent Items", "Sent Messages")


def delete_by_message_id(message_id: str) -> dict[str, Any]:
    """Best-effort removal of a message from the IMAP Sent folder, matched by its
    RFC-822 Message-ID. Used when an Outbox entry is deleted. Never raises on a
    miss — the local record is the source of truth."""
    mid = (message_id or "").strip()
    if not mid:
        return {"deleted": False, "reason": "no message-id"}
    m = _connect()
    try:
        for box in _SENT_BOXES:
            typ, _ = m.select(box)
            if typ != "OK":
                continue
            typ, data = m.uid("search", None, "HEADER", "Message-ID", mid)
            uids = data[0].split() if typ == "OK" and data and data[0] else []
            if not uids:
                continue
            for uid in uids:
                for trash in ("Trash", "INBOX.Trash", "Deleted Items"):
                    try:
                        cp, _ = m.uid("copy", uid, trash)
                        if cp == "OK":
                            break
                    except imaplib.IMAP4.error:
                        continue
                m.uid("store", uid, "+FLAGS", "(\\Deleted)")
            m.expunge()
            return {"deleted": True, "mailbox": box}
        return {"deleted": False, "reason": "not found in Sent"}
    finally:
        try:
            m.logout()
        except Exception:
            pass


def _body_text(msg: email.message.Message) -> str:
    if msg.is_multipart():
        # Prefer text/plain, fall back to stripped text/html.
        plain = ""
        html = ""
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp.lower():
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                text = payload.decode(charset, "replace")
            except Exception:
                continue
            if ctype == "text/plain" and not plain:
                plain = text
            elif ctype == "text/html" and not html:
                html = text
        if plain:
            return plain
        if html:
            import re

            return re.sub(r"<[^>]+>", " ", html)
        return ""
    try:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        return payload.decode(charset, "replace") if payload else str(msg.get_payload())
    except Exception:
        return str(msg.get_payload())


def get_message(*, message_id: str, mailbox: str = "INBOX") -> dict[str, Any]:
    """Fetch one full message (marks it Seen)."""
    m = _connect()
    try:
        typ, _ = m.select(mailbox)
        if typ != "OK":
            raise InboxError(f"cannot open mailbox {mailbox!r}")
        typ, data = m.uid("fetch", message_id.encode(), "(RFC822)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            raise InboxError("message not found")
        msg = email.message_from_bytes(data[0][1])
        name, addr = parseaddr(_decode(msg.get("From")))
        _to_name, to_addr = parseaddr(_decode(msg.get("To")))
        return {
            "id": message_id,
            "mailbox": mailbox,
            "from_name": name,
            "from_email": addr,
            "to_email": to_addr,
            "subject": _decode(msg.get("Subject")) or "(no subject)",
            "date": _iso_date(msg.get("Date", "")),
            "message_id": msg.get("Message-ID", ""),
            "body": _body_text(msg).strip(),
        }
    finally:
        try:
            m.logout()
        except Exception:
            pass
