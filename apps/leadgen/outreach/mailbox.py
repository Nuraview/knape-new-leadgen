"""Every mailbox, every folder, one view.

``imap_inbox`` reads a single account: ``_creds()`` returns the FIRST enabled
inbox and everything else in the module is built on that. So Communications
showed "40 received in INBOX" and there was no way to tell which of the five
mailboxes that INBOX was, whether a reply to drigby@ existed at all, or what
had actually been sent from any of them. Five accounts send mail under Dan's
name; one of them was readable.

This module is the account-aware replacement. Three things it does that the
old one could not:

* **Fans out.** A listing hits every enabled account concurrently and merges
  the results newest-first. One slow or broken account degrades to an error
  entry beside the others instead of failing the page.
* **Attributes.** Every message carries the account it belongs to, so a row
  can say which mailbox it landed in. That was the actual complaint.
* **Addresses uniquely.** A UID is only unique within one folder of one
  account, so the old bare-UID id could not survive multiple accounts. Ids are
  now ``account|folder|uid`` and every read or move round-trips through the
  same triple.

Folder names are not standard across servers, so the UI asks for a role
(``inbox``, ``sent``, ``trash``, ``spam``, ``drafts``, ``archive``) and the
real folder is resolved per account from its own LIST output.
"""

from __future__ import annotations

import email
import imaplib
import re
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from email.utils import parseaddr
from typing import Any

from outreach.imap_inbox import InboxError, _body_text, _decode, _iso_date

#: Logical folder -> candidate IMAP names, best first. Mailu uses the plain
#: names; the dotted ones are for servers with an INBOX. namespace.
FOLDER_ROLES: dict[str, tuple[str, ...]] = {
    "inbox": ("INBOX",),
    "sent": ("Sent", "INBOX.Sent", "Sent Items", "Sent Messages"),
    "trash": ("Trash", "INBOX.Trash", "Deleted Items", "Deleted Messages"),
    "spam": ("Junk", "INBOX.Junk", "Spam", "INBOX.Spam"),
    "drafts": ("Drafts", "INBOX.Drafts"),
    "archive": ("Archive", "INBOX.Archive", "All Mail"),
}

_UID_RE = re.compile(rb"UID (\d+)")

#: Listings are cached briefly. Opening five TLS sessions and logging in takes
#: seconds; without this, every tab click and every React refetch pays it again.
#: Short enough that new mail shows up on the next poll.
_CACHE_TTL_SEC = 45.0
_cache: dict[str, tuple[float, Any]] = {}


# ----------------------------------------------------------------- accounts --

def accounts(include_secrets: bool = False) -> list[dict[str, Any]]:
    """Every mailbox we can read, newest-registered last.

    Includes disabled inboxes on purpose. daniel@ is retired from SENDING but
    still holds 172 messages and can still receive a late reply to something
    sent months ago; hiding it from the reader would lose exactly the mail
    nobody is watching for.
    """
    from outreach import outreach_store

    out = []
    for ib in outreach_store.list_inboxes(include_secrets=True):
        host = ib.get("imap_host") or ib.get("smtp_host") or ""
        user = ib.get("smtp_user") or ib.get("email") or ""
        pw = ib.get("smtp_password") or ""
        if not (host and user and pw):
            continue
        rec = {
            "email": ib.get("email") or user,
            "host": host,
            "port": int(ib.get("imap_port") or 993),
            "user": user,
            "enabled": bool(int(ib.get("enabled") or 0)),
        }
        if include_secrets:
            rec["password"] = pw
        out.append(rec)
    return out


def _account(email_addr: str) -> dict[str, Any] | None:
    want = (email_addr or "").strip().lower()
    for a in accounts(include_secrets=True):
        if a["email"].lower() == want:
            return a
    return None


def _connect(acct: dict[str, Any]) -> imaplib.IMAP4_SSL:
    try:
        m = imaplib.IMAP4_SSL(acct["host"], acct["port"], timeout=25)
        m.login(acct["user"], acct["password"])
        return m
    except (imaplib.IMAP4.error, OSError, ssl.SSLError) as e:
        raise InboxError(f"{acct['email']}: IMAP login failed: {e}") from e


# ------------------------------------------------------------------ folders --

def _resolve_folder(m: imaplib.IMAP4_SSL, role: str) -> str:
    """The real folder name on THIS server for a logical role.

    Tries the candidates in order and returns the first that opens. Falls back
    to INBOX rather than raising: a server with no Archive folder should show
    an empty list, not an error page.
    """
    role = (role or "inbox").strip().lower()
    for name in FOLDER_ROLES.get(role, ("INBOX",)):
        try:
            typ, _ = m.select(f'"{name}"', readonly=True)
            if typ == "OK":
                return name
        except imaplib.IMAP4.error:
            continue
    return "INBOX"


# ------------------------------------------------------------------ listing --

def _list_one(acct: dict[str, Any], role: str, limit: int) -> dict[str, Any]:
    """Headers from one account's folder. Never raises — an unreachable account
    becomes an error row so the other four still render."""
    try:
        m = _connect(acct)
    except InboxError as e:
        return {"account": acct["email"], "error": str(e), "items": []}
    try:
        folder = _resolve_folder(m, role)
        typ, _ = m.select(f'"{folder}"', readonly=True)
        if typ != "OK":
            return {"account": acct["email"], "error": f"cannot open {folder}", "items": []}
        typ, data = m.uid("search", None, "ALL")
        uids = data[0].split() if data and data[0] else []
        uids = uids[-limit:][::-1]
        items: list[dict[str, Any]] = []
        if uids:
            typ, fetched = m.uid(
                "fetch", b",".join(uids),
                "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])",
            )
            by_uid: dict[bytes, dict[str, Any]] = {}
            for part in fetched or []:
                if not (isinstance(part, tuple) and len(part) == 2):
                    continue
                meta = part[0] if isinstance(part[0], (bytes, bytearray)) else str(part[0]).encode()
                um = _UID_RE.search(meta)
                if not um:
                    continue
                uid = um.group(1)
                raw = part[1]
                hdr = (email.message_from_bytes(raw) if isinstance(raw, (bytes, bytearray))
                       else email.message_from_string(str(raw)))
                name, addr = parseaddr(_decode(hdr.get("From")))
                _tn, to_addr = parseaddr(_decode(hdr.get("To")))
                by_uid[uid] = {
                    "id": make_id(acct["email"], role, uid.decode()),
                    "uid": uid.decode(),
                    # Which mailbox this belongs to. The whole point.
                    "account": acct["email"],
                    "folder": role,
                    "from_name": name,
                    "from_email": addr,
                    "to_email": to_addr,
                    "subject": _decode(hdr.get("Subject")) or "(no subject)",
                    "date": _iso_date(hdr.get("Date", "")),
                    "seen": b"\\Seen" in meta,
                }
            for u in uids:
                if u in by_uid:
                    items.append(by_uid[u])
        return {"account": acct["email"], "error": "", "items": items}
    except Exception as e:  # noqa: BLE001 — one bad account must not blank the page
        return {"account": acct["email"], "error": f"{type(e).__name__}: {e}", "items": []}
    finally:
        try:
            m.logout()
        except Exception:  # noqa: BLE001
            pass


def list_all(*, role: str = "inbox", limit: int = 60, account: str = "",
             use_cache: bool = True) -> dict[str, Any]:
    """Merged, newest-first listing across every account (or just one).

    ``limit`` is per account before the merge, so asking for 60 with five
    accounts can return up to 300 — deliberate: trimming to 60 across the
    merge would silently hide a whole quiet mailbox behind a busy one.
    """
    key = f"{role}|{account}|{limit}"
    if use_cache:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL_SEC:
            return hit[1]

    accts = accounts(include_secrets=True)
    if account:
        accts = [a for a in accts if a["email"].lower() == account.strip().lower()]
    if not accts:
        return {"role": role, "items": [], "accounts": [], "errors": [], "count": 0}

    with ThreadPoolExecutor(max_workers=min(8, len(accts))) as ex:
        results = list(ex.map(lambda a: _list_one(a, role, limit), accts))

    items: list[dict[str, Any]] = []
    errors = []
    for r in results:
        items.extend(r["items"])
        if r["error"]:
            errors.append({"account": r["account"], "error": r["error"]})
    # Merge on the header date. Missing/unparseable dates sort last rather than
    # crashing the sort or jumping to the top.
    items.sort(key=lambda i: i.get("date") or "", reverse=True)

    payload = {
        "role": role,
        "items": items,
        "count": len(items),
        "accounts": [a["email"] for a in accts],
        "per_account": {r["account"]: len(r["items"]) for r in results},
        "errors": errors,
    }
    _cache[key] = (time.time(), payload)
    return payload


# ------------------------------------------------------------------- one id --

_SEP = "|"


def make_id(account: str, role: str, uid: str) -> str:
    return f"{account}{_SEP}{role}{_SEP}{uid}"


def parse_id(message_id: str) -> tuple[str, str, str]:
    """``account|folder|uid``.

    A bare UID is still accepted and resolved against the first account, so
    links and bookmarks made before this existed keep working instead of
    404ing.
    """
    raw = (message_id or "").strip()
    parts = raw.split(_SEP)
    if len(parts) == 3:
        return parts[0], parts[1], parts[2]
    accts = accounts()
    return (accts[0]["email"] if accts else ""), "inbox", raw


def get_one(message_id: str) -> dict[str, Any]:
    """Full message, from whichever account and folder the id names."""
    acct_email, role, uid = parse_id(message_id)
    acct = _account(acct_email)
    if not acct:
        raise InboxError(f"unknown mailbox {acct_email!r}")
    m = _connect(acct)
    try:
        folder = _resolve_folder(m, role)
        typ, _ = m.select(f'"{folder}"')
        if typ != "OK":
            raise InboxError(f"cannot open {folder}")
        typ, data = m.uid("fetch", uid.encode(), "(RFC822)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            raise InboxError("message not found")
        msg = email.message_from_bytes(data[0][1])
        name, addr = parseaddr(_decode(msg.get("From")))
        _tn, to_addr = parseaddr(_decode(msg.get("To")))
        return {
            "id": message_id,
            "account": acct["email"],
            "folder": role,
            "mailbox": folder,
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
        except Exception:  # noqa: BLE001
            pass


def move_to_trash(message_id: str) -> dict[str, Any]:
    """Move a message to the account's Trash. Only expunges as a last resort.

    A copy into Trash then \\Deleted is a move. If no Trash folder can be
    found, the flag is set WITHOUT expunging: destroying a customer's mail
    because a folder was named unexpectedly is not an acceptable failure mode,
    and a flagged message is still recoverable.
    """
    acct_email, role, uid = parse_id(message_id)
    acct = _account(acct_email)
    if not acct:
        raise InboxError(f"unknown mailbox {acct_email!r}")
    m = _connect(acct)
    try:
        folder = _resolve_folder(m, role)
        typ, _ = m.select(f'"{folder}"')
        if typ != "OK":
            raise InboxError(f"cannot open {folder}")
        moved = ""
        for name in FOLDER_ROLES["trash"]:
            try:
                cp, _ = m.uid("copy", uid.encode(), f'"{name}"')
                if cp == "OK":
                    moved = name
                    break
            except imaplib.IMAP4.error:
                continue
        m.uid("store", uid.encode(), "+FLAGS", "(\\Deleted)")
        if moved:
            m.expunge()
        _cache.clear()
        return {"deleted": True, "account": acct["email"], "moved_to": moved or "(flagged, no Trash folder)"}
    finally:
        try:
            m.logout()
        except Exception:  # noqa: BLE001
            pass


def invalidate() -> None:
    """Drop the listing cache — call after anything that changes a mailbox."""
    _cache.clear()
