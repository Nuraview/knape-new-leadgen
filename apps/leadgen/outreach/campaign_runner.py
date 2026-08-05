"""Inbox seeding for the outreach module.

(The campaign layer was removed — outreach is now per-lead on the account card,
using the shared multi-inbox model in ``outreach_store`` + ``email_runner``.)
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from outreach import outreach_store

_ROOT = Path(__file__).resolve().parent.parent


def seed_default_inboxes() -> int:
    """Register the Mailu outreach inboxes from deploy/outreach/inbox_creds.json."""
    creds_path = _ROOT / "deploy" / "outreach" / "inbox_creds.json"
    if not creds_path.is_file():
        return 0
    try:
        creds = json.loads(creds_path.read_text())
    except (OSError, json.JSONDecodeError):
        return 0
    host = os.getenv("OUTREACH_MAIL_HOST", "mail.tec5usa.us")
    domain = os.getenv("OUTREACH_DOMAIN", "winthedayplanner.net")
    n = 0
    for email, pw in creds.items():
        outreach_store.upsert_inbox({
            "email": email, "domain": domain, "from_name": "Dan Rigby",
            "smtp_host": host, "smtp_port": 465, "smtp_ssl": 1,
            "smtp_user": email, "smtp_password": pw,
            "imap_host": host, "imap_port": 993, "daily_cap": 25,
        })
        n += 1
    return n
