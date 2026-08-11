"""Accept content-calendar writes from an external CRM.

The reverse of ``scheduler_sync``. That module pushes our schedule out to
crmx1 so their designer can *see* it; this one lets their staff schedule a post
that lands in the real ``social_posts`` table here — the same table the
client's own cockpit reads. A post created through this endpoint is a Knape
post, not a copy of one.

Trust model: a shared bearer secret, exactly like the outbound direction. This
is the only write path into this app that is not behind a cockpit session, so
two properties matter more than anything else here:

* It **fails closed.** No ``SCHEDULER_WRITE_API_KEY`` in the environment means
  every request is rejected. The tempting shape — "no key configured, so skip
  the check" — would turn a missing env var on a restart into an open,
  unauthenticated write endpoint on the client's live content calendar.
* The comparison is constant-time. The secret is long and random, so this is
  belt-and-braces, but a plain ``==`` on a secret is worth never writing.

Posts arrive as ``draft``. They go through Knape's normal approval flow like
anything else — an external system can put content on the calendar, it cannot
put content past the client's review.
"""

from __future__ import annotations

import datetime as dt
import hmac
import os
from typing import Any

from outreach import db, social_store

# The status a remote post lands in. Deliberately the bottom of the lifecycle:
# see the module docstring.
INBOUND_STATUS = "draft"


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def api_key() -> str:
    return _env("SCHEDULER_WRITE_API_KEY")


def is_configured() -> bool:
    return bool(api_key())


def verify(authorization: str | None) -> bool:
    """True only if the header carries the configured secret."""
    expected = api_key()
    if not expected:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    presented = authorization[len("Bearer ") :].strip()
    return hmac.compare_digest(presented, expected)


def init_db() -> None:
    """Idempotency ledger for inbound writes.

    Its own table rather than a column on ``social_posts``: that table is
    shared live with the client's original cockpit on :8787, and this feature
    has no business widening it.

    Two jobs:

    * Idempotency, when the caller sends an ``externalId``. Without one a
      retried request after a timeout that actually committed would create a
      second post — the write is not otherwise idempotent, because nothing in
      the payload is reliably unique (two posts can legitimately share copy and
      a slot).
    * Ownership. It is the record of which rows this integration created, which
      is what lets media upload refuse to touch anything else in the table.

    Every inbound post is recorded, ``externalId`` or not — otherwise a caller
    that omits it would create posts it could then never attach an image to.
    """
    c = db.connect()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduler_write_log (
                id BIGSERIAL PRIMARY KEY,
                source TEXT NOT NULL,
                external_id TEXT,
                post_id BIGINT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        # The column was NOT NULL in the first cut. No-op once already dropped.
        c.execute("ALTER TABLE scheduler_write_log ALTER COLUMN external_id DROP NOT NULL")
        # Partial: several rows may legitimately have no external_id, and a
        # plain unique index over NULLs would not stop them anyway.
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_write_ext "
            "ON scheduler_write_log(source, external_id) WHERE external_id IS NOT NULL"
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_scheduler_write_post ON scheduler_write_log(post_id)")
        c.commit()
    finally:
        c.close()


def _parse_instant(raw: Any) -> float:
    """ISO 8601 with an offset -> epoch seconds.

    A naive timestamp is rejected rather than assumed. "2026-08-20T14:00:00"
    could be 14:00 in Knape's Eastern office or 14:00 UTC, and guessing wrong
    puts the post live four hours early with nothing anywhere to show why. An
    explicit 400 costs the caller one field; a silent guess costs a mistimed
    campaign post.
    """
    s = str(raw or "").strip()
    if not s:
        raise ValueError("scheduledAt is required")
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(s)
    except ValueError as e:
        raise ValueError(
            "scheduledAt must be ISO 8601, e.g. 2026-08-20T14:00:00Z"
        ) from e
    if parsed.tzinfo is None:
        raise ValueError(
            "scheduledAt must carry a UTC offset or a trailing Z — "
            "a naive timestamp is ambiguous and would schedule the post at the wrong hour"
        )
    return parsed.timestamp()


def _lookup(source: str, external_id: str) -> int | None:
    c = db.connect()
    try:
        row = c.execute(
            "SELECT post_id FROM scheduler_write_log WHERE source=? AND external_id=?",
            (source, external_id),
        ).fetchone()
        return int(row["post_id"]) if row else None
    finally:
        c.close()


def _record(source: str, external_id: str | None, post_id: int) -> None:
    import time

    c = db.connect()
    try:
        c.execute(
            "INSERT INTO scheduler_write_log (source, external_id, post_id, created_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (source, external_id) DO NOTHING",
            (source, external_id or None, post_id, time.time()),
        )
        c.commit()
    finally:
        c.close()


def owns_post(post_id: int) -> bool:
    """Did this integration create that post?

    The gate on media upload. Without it, anyone holding the write key could
    attach images to *any* row in ``social_posts`` — including the client's own
    posts, written in their own cockpit, which this integration has no business
    modifying. A key scoped to "create posts" should not silently also mean
    "edit Knape's existing content".
    """
    c = db.connect()
    try:
        row = c.execute(
            "SELECT 1 AS ok FROM scheduler_write_log WHERE post_id=? LIMIT 1", (post_id,)
        ).fetchone()
        return bool(row)
    finally:
        c.close()


def create_post(payload: dict[str, Any]) -> dict[str, Any]:
    """Create one post from a remote payload. Raises ValueError on bad input."""
    source = str(payload.get("source") or "crmx1").strip() or "crmx1"
    external_id = str(payload.get("externalId") or "").strip()

    if external_id:
        existing = _lookup(source, external_id)
        if existing is not None:
            # A retry, not a second post.
            return _result(existing, duplicate=True)

    when = _parse_instant(payload.get("scheduledAt"))
    description = payload.get("description")
    if description is None:
        raise ValueError("description is required (the post copy)")

    # Their staff, not ours — recorded verbatim so the cockpit's own audit trail
    # shows who scheduled it rather than attributing it to the integration.
    actor = str(payload.get("createdBy") or "").strip() or f"{source} (unattributed)"
    title = payload.get("title")
    timezone = payload.get("timezone")

    # create_post enforces the LinkedIn 3,000-character cap and rejects empty
    # copy, both as ValueError — which the route turns into a 400.
    post = social_store.create_post(str(description), title, when, timezone, actor)
    post_id = int(post["id"])

    _record(source, external_id or None, post_id)

    return _result(post_id, duplicate=False)


# ---------------------------------------------------------------------------
# Creatives
# ---------------------------------------------------------------------------

# 25 MB. The cockpit's own UI allows 200 MB because it also takes video; this
# path is images only, where 25 MB is already far past what any social creative
# needs and keeps a hostile upload from filling the disk (it sits at 93%).
MAX_MEDIA_BYTES = 25 * 1024 * 1024

_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def sniff_image(data: bytes) -> str | None:
    """The real type of the bytes, from their magic number.

    The declared ``contentType`` is a claim by the caller, and this file is
    later served back to a browser with that type on it. Trusting the header
    would let a mislabelled — or malicious — upload be served as whatever the
    sender chose. So the bytes decide, and the header is only a hint.
    """
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            return mime
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"avif", b"avis"):
            return "image/avif"
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"mif1"):
            return "image/heic"
    return None


def add_media(post_id: int, file_name: str, content: bytes, declared_type: str) -> dict[str, Any]:
    """Attach a creative to a post this integration created.

    Raises LookupError (-> 404) if the post is not ours, ValueError (-> 400)
    for anything wrong with the bytes.
    """
    if not owns_post(post_id):
        # Deliberately the same error as a genuinely missing post: whether a
        # given id exists in Knape's calendar is not this caller's business.
        raise LookupError("Post not found")
    if not content:
        raise ValueError("Empty file")
    if len(content) > MAX_MEDIA_BYTES:
        raise ValueError(
            f"File too large ({len(content) // 1024} KB) — "
            f"the cap is {MAX_MEDIA_BYTES // (1024 * 1024)} MB"
        )

    actual = sniff_image(content)
    if actual is None:
        raise ValueError(
            f"Not a recognised image (declared {declared_type or 'nothing'}). "
            "Accepted: PNG, JPEG, GIF, WebP, AVIF."
        )
    if actual == "image/heic":
        # Detected rather than lumped in with "unrecognised", because it IS a
        # valid image and the caller deserves to know why it bounced: Chrome
        # and Firefox will not render it, so it would land as a broken
        # thumbnail on the client's calendar.
        raise ValueError(
            "HEIC images are not rendered by most browsers — convert to PNG or JPEG first"
        )

    # `actual`, not `declared_type`: what gets stored is what the file is.
    return social_store.add_media(post_id, file_name or "creative", content, actual)


def _result(post_id: int, duplicate: bool) -> dict[str, Any]:
    return {
        "ok": True,
        "id": post_id,
        # Handed back so the caller can recognise this post when our outbound
        # sync pushes it straight back at them within 5 minutes. Without it
        # they would have no way to tell their own post from our echo of it.
        "externalEventId": f"knape-social-{post_id}",
        "status": INBOUND_STATUS,
        "duplicate": duplicate,
    }
