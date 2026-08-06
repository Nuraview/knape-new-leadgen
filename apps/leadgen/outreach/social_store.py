"""Persistence for the LinkedIn content scheduler (Jul-20 client call).

The agency writes ~50 posts over six months (2/week) for Peter's LinkedIn.
Each post = primary text (the caption, read before the creative) + optional
media (images/video). Peter opens a post in the dashboard, reads the text,
views the creative, and either approves (the tick mark) or requests changes
with a comment. Once approved, the text is copy-pasted to LinkedIn at the
scheduled time (Phase A).

Phase B (future, additive): a background publisher — same daemon-thread
pattern as ``email_runner.ensure_scheduler`` — queries
``status='approved' AND scheduled_at <= now()`` and publishes via the
LinkedIn Posts API (``POST https://api.linkedin.com/rest/posts``, OAuth
``w_member_social`` under the self-serve "Share on LinkedIn" product; media
uploaded first via /rest/images | /rest/videos → URN), then sets
``status='published'`` + ``linkedin_post_urn`` or ``status='failed'`` +
``publish_error``. The columns for that already exist; ``scheduled``/
``published``/``failed`` are publisher-only statuses, unreachable from the UI.

Media files live on the VPS under ``outreach_data/social_media/<post_id>/``
— inside the rsync-protected ``outreach_data/`` dir, so deploys never touch
uploads.

Status flow (UI-reachable):
    draft → pending_approval → approved        (Peter's tick)
                 ↘ needs_changes → pending_approval (edit + resubmit)
    approved → needs_changes                   (Peter withdraws approval)
    approved → published                       (posted by hand, link pasted in)
Editing the body or schedule of an APPROVED post reverts it to
pending_approval — Peter must re-approve what will actually be published.

Two extras sit on top of that flow, both Phase-A (manual) features:
  * a revocable **share token** per post — ``/api/social/share/<token>``
    serves the text + creatives with no login, so a post can be sent to
    someone who has no dashboard account;
  * **mark as published** — after posting to LinkedIn by hand you paste the
    live URL back in, which is what moves a post to ``published`` while the
    auto-publisher is switched off.
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Any

from outreach import db

SOCIAL_STATUSES = (
    "draft",
    "pending_approval",
    "needs_changes",
    "approved",
    "scheduled",
    "published",
    "failed",
)

_ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("pending_approval",),
    "pending_approval": ("approved", "needs_changes"),
    "needs_changes": ("pending_approval",),
    "approved": ("needs_changes", "pending_approval"),
    "scheduled": ("published", "failed"),
    "published": (),
    "failed": ("approved",),
}

# Comment kinds: comment | change_request | approval

# Where uploaded creatives are written.
#
# SOCIAL_MEDIA_ROOT exists because this deployment is the SECOND dashboard
# reading these tables — the client's original cockpit owns the same
# social_posts rows and already has creatives on disk under its own tree.
# ``stored_path`` is recorded absolute, so posts uploaded over there are served
# from here without help; the env var is what stops NEW uploads landing in a
# separate directory the other dashboard cannot see, which would make the
# creative visible on whichever instance happened to receive the upload.
# Point both installs at one path and either can serve any post.
MEDIA_ROOT = Path(
    os.environ.get("SOCIAL_MEDIA_ROOT")
    or Path(__file__).resolve().parent.parent / "outreach_data" / "social_media"
)


def _conn() -> db._Conn:
    return db.connect()


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS social_posts (
                id BIGSERIAL PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'draft',
                title TEXT,
                body TEXT NOT NULL,
                scheduled_at DOUBLE PRECISION,
                timezone TEXT NOT NULL DEFAULT 'America/New_York',
                approved_by TEXT,
                approved_at DOUBLE PRECISION,
                linkedin_post_urn TEXT,
                published_at DOUBLE PRECISION,
                publish_error TEXT,
                publish_attempts INTEGER NOT NULL DEFAULT 0,
                created_by TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL,
                deleted_at DOUBLE PRECISION
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS social_post_media (
                id BIGSERIAL PRIMARY KEY,
                post_id INTEGER NOT NULL,
                kind TEXT NOT NULL DEFAULT 'image',
                file_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                content_type TEXT,
                size_bytes INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0,
                linkedin_asset_urn TEXT,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS social_post_comments (
                id BIGSERIAL PRIMARY KEY,
                post_id INTEGER NOT NULL,
                author TEXT,
                kind TEXT NOT NULL DEFAULT 'comment',
                body TEXT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        # Added after the first release — existing tables get them here.
        #   share_token       → public read-only link for one post (revocable)
        #   linkedin_post_url → the live post's URL, pasted in after publishing
        #                       by hand (Phase A). The auto-publisher writes
        #                       ``linkedin_post_urn`` instead, so the two never
        #                       collide and "published manually" stays legible.
        c.execute("ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS share_token TEXT")
        c.execute("ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS linkedin_post_url TEXT")
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_share ON social_posts(share_token) "
            "WHERE share_token IS NOT NULL"
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_social_posts_sched ON social_posts(status, scheduled_at)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_social_media_post ON social_post_media(post_id, sort_order)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_social_comments_post ON social_post_comments(post_id, created_at)")
        # Connected LinkedIn account (single row in practice — Peter's profile).
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS social_accounts (
                id BIGSERIAL PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'linkedin',
                label TEXT,
                member_urn TEXT,
                access_token TEXT,
                refresh_token TEXT,
                expires_at DOUBLE PRECISION,
                connected_by TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL
            )
            """
        )
        c.commit()
    finally:
        c.close()


# ---------------------------------------------------------------------------
# Connected account (Phase B)
# ---------------------------------------------------------------------------


def get_account() -> dict[str, Any] | None:
    c = _conn()
    try:
        row = c.execute(
            "SELECT * FROM social_accounts WHERE provider='linkedin' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None
    finally:
        c.close()


def save_account(
    member_urn: str,
    label: str | None,
    access_token: str,
    refresh_token: str | None,
    expires_at: float | None,
    connected_by: str,
) -> dict[str, Any]:
    """Replace any existing LinkedIn connection with this one."""
    now = time.time()
    c = _conn()
    try:
        c.execute("DELETE FROM social_accounts WHERE provider='linkedin'")
        cur = c.execute(
            """
            INSERT INTO social_accounts (provider, label, member_urn, access_token, refresh_token, expires_at, connected_by, created_at, updated_at)
            VALUES ('linkedin', ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (label, member_urn, access_token, refresh_token, expires_at, connected_by, now, now),
        )
        account_id = int(cur.fetchone()["id"])
        c.commit()
        out = c.execute("SELECT * FROM social_accounts WHERE id=?", (account_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def update_account_tokens(
    account_id: int, access_token: str, refresh_token: str | None, expires_at: float | None
) -> None:
    c = _conn()
    try:
        c.execute(
            "UPDATE social_accounts SET access_token=?, refresh_token=COALESCE(?, refresh_token), expires_at=?, updated_at=? WHERE id=?",
            (access_token, refresh_token, expires_at, time.time(), account_id),
        )
        c.commit()
    finally:
        c.close()


def delete_account() -> None:
    c = _conn()
    try:
        c.execute("DELETE FROM social_accounts WHERE provider='linkedin'")
        c.commit()
    finally:
        c.close()


# ---------------------------------------------------------------------------
# Publisher queries (Phase B worker — bypasses the UI transition map; the
# scheduled/published/failed statuses belong to the worker alone)
# ---------------------------------------------------------------------------


def due_posts(max_attempts: int = 3) -> list[dict[str, Any]]:
    """Approved posts whose scheduled time has passed, media included."""
    now = time.time()
    c = _conn()
    try:
        rows = c.execute(
            """
            SELECT * FROM social_posts
            WHERE deleted_at IS NULL AND status='approved'
              AND scheduled_at IS NOT NULL AND scheduled_at <= ?
              AND publish_attempts < ?
            ORDER BY scheduled_at
            """,
            (now, max_attempts),
        ).fetchall()
        posts = [dict(r) for r in rows]
        for p in posts:
            media = c.execute(
                "SELECT * FROM social_post_media WHERE post_id=? ORDER BY sort_order, id", (p["id"],)
            ).fetchall()
            p["media"] = [dict(m) for m in media]
        return posts
    finally:
        c.close()


def mark_published(post_id: int, post_urn: str) -> None:
    now = time.time()
    c = _conn()
    try:
        c.execute(
            "UPDATE social_posts SET status='published', linkedin_post_urn=?, published_at=?, publish_error=NULL, updated_at=? WHERE id=?",
            (post_urn, now, now, post_id),
        )
        c.execute(
            "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) "
            "VALUES (?, 'scheduler', 'comment', 'Published to LinkedIn automatically.', ?)",
            (post_id, now),
        )
        c.commit()
    finally:
        c.close()


def mark_publish_failed(post_id: int, error: str, max_attempts: int = 3) -> None:
    now = time.time()
    c = _conn()
    try:
        row = c.execute("SELECT publish_attempts FROM social_posts WHERE id=?", (post_id,)).fetchone()
        attempts = int(row["publish_attempts"] or 0) + 1 if row else 1
        # Keep status 'approved' while retries remain so the worker picks it up
        # again; 'failed' after the final attempt (UI allows failed → approved).
        status = "failed" if attempts >= max_attempts else "approved"
        c.execute(
            "UPDATE social_posts SET status=?, publish_attempts=?, publish_error=?, updated_at=? WHERE id=?",
            (status, attempts, error[:2000], now, post_id),
        )
        if status == "failed":
            c.execute(
                "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) "
                "VALUES (?, 'scheduler', 'comment', ?, ?)",
                (post_id, f"Auto-publish failed after {attempts} attempts: {error[:300]}", now),
            )
        c.commit()
    finally:
        c.close()


def _assert_transition(from_status: str, to_status: str) -> None:
    if to_status not in _ALLOWED_TRANSITIONS.get(from_status, ()):
        raise ValueError(f"Cannot move a {from_status} post to {to_status}")


def _require_post(c: db._Conn, post_id: int) -> dict[str, Any]:
    row = c.execute(
        "SELECT * FROM social_posts WHERE id=? AND deleted_at IS NULL", (post_id,)
    ).fetchone()
    if not row:
        raise LookupError("Post not found")
    return dict(row)


def list_posts(month: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
    """Posts with media, ordered by scheduled time (unscheduled last).

    ``month`` = "YYYY-MM": include posts scheduled inside that month (UTC
    boundaries are fine at this granularity) PLUS unscheduled drafts, so
    nothing silently disappears from the composer's view.
    """
    c = _conn()
    try:
        conds = ["p.deleted_at IS NULL"]
        params: list[Any] = []
        if status and status in SOCIAL_STATUSES:
            conds.append("p.status = ?")
            params.append(status)
        if month:
            import calendar
            import datetime as dt

            y, m = (int(x) for x in month.split("-"))
            start = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc).timestamp()
            end = dt.datetime(
                y, m, calendar.monthrange(y, m)[1], 23, 59, 59, tzinfo=dt.timezone.utc
            ).timestamp()
            conds.append("(p.scheduled_at IS NULL OR (p.scheduled_at >= ? AND p.scheduled_at <= ?))")
            params.extend([start, end])
        rows = c.execute(
            f"""
            SELECT p.*, COALESCE(cc.n, 0) AS comment_count
            FROM social_posts p
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS n FROM social_post_comments GROUP BY post_id
            ) cc ON cc.post_id = p.id
            WHERE {' AND '.join(conds)}
            ORDER BY p.scheduled_at NULLS LAST, p.id
            """,
            params,
        ).fetchall()
        posts = [dict(r) for r in rows]
        ids = [p["id"] for p in posts]
        media_by_post: dict[int, list[dict[str, Any]]] = {}
        if ids:
            ph = ",".join("?" for _ in ids)
            media = c.execute(
                f"SELECT * FROM social_post_media WHERE post_id IN ({ph}) ORDER BY sort_order, id",
                ids,
            ).fetchall()
            for m_row in media:
                media_by_post.setdefault(int(m_row["post_id"]), []).append(dict(m_row))
        for p in posts:
            p["media"] = media_by_post.get(int(p["id"]), [])
        return posts
    finally:
        c.close()


def get_post(post_id: int) -> dict[str, Any]:
    c = _conn()
    try:
        post = _require_post(c, post_id)
        media = c.execute(
            "SELECT * FROM social_post_media WHERE post_id=? ORDER BY sort_order, id", (post_id,)
        ).fetchall()
        comments = c.execute(
            "SELECT * FROM social_post_comments WHERE post_id=? ORDER BY created_at, id", (post_id,)
        ).fetchall()
        return {"post": post, "media": [dict(m) for m in media], "comments": [dict(x) for x in comments]}
    finally:
        c.close()


def create_post(
    body: str,
    title: str | None,
    scheduled_at: float | None,
    timezone: str | None,
    actor: str,
) -> dict[str, Any]:
    body = body.strip()
    if not body:
        raise ValueError("Post text is required")
    if len(body) > 3000:
        raise ValueError("LinkedIn caps a post at 3,000 characters")
    now = time.time()
    c = _conn()
    try:
        cur = c.execute(
            """
            INSERT INTO social_posts (body, title, scheduled_at, timezone, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                body,
                (title or "").strip() or None,
                scheduled_at,
                (timezone or "").strip() or "America/New_York",
                actor,
                now,
                now,
            ),
        )
        post_id = int(cur.fetchone()["id"])
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def update_post(post_id: int, patch: dict[str, Any], actor: str) -> dict[str, Any]:
    """Apply provided fields. Editing the body or schedule of an APPROVED post
    reverts it to pending_approval (content changed after the tick)."""
    now = time.time()
    c = _conn()
    try:
        post = _require_post(c, post_id)
        sets: dict[str, Any] = {}
        if "body" in patch:
            body = str(patch["body"] or "").strip()
            if not body:
                raise ValueError("Post text is required")
            if len(body) > 3000:
                raise ValueError("LinkedIn caps a post at 3,000 characters")
            if body != post["body"]:
                sets["body"] = body
        if "title" in patch:
            title = (str(patch["title"]).strip() or None) if patch["title"] is not None else None
            if title != post["title"]:
                sets["title"] = title
        if "scheduled_at" in patch:
            sched = float(patch["scheduled_at"]) if patch["scheduled_at"] else None
            if sched != post["scheduled_at"]:
                sets["scheduled_at"] = sched
        if "timezone" in patch and patch["timezone"]:
            tz = str(patch["timezone"]).strip()
            if tz and tz != post["timezone"]:
                sets["timezone"] = tz
        content_changed = "body" in sets or "scheduled_at" in sets
        if post["status"] == "published" and content_changed:
            raise ValueError("This post is already live on LinkedIn — edit it there, or un-mark it as published first")
        if post["status"] == "approved" and content_changed:
            sets["status"] = "pending_approval"
            sets["approved_by"] = None
            sets["approved_at"] = None
        if sets:
            assigns = ", ".join(f"{k}=?" for k in sets)
            c.execute(
                f"UPDATE social_posts SET {assigns}, updated_at=? WHERE id=?",
                (*sets.values(), now, post_id),
            )
            if sets.get("status") == "pending_approval":
                c.execute(
                    "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) "
                    "VALUES (?, ?, 'comment', ?, ?)",
                    (post_id, actor, "Edited after approval — needs a fresh review.", now),
                )
            c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def submit_for_approval(post_id: int, actor: str) -> dict[str, Any]:
    return _set_status(post_id, "pending_approval", actor, comment=None, comment_kind=None)


def approve(post_id: int, actor: str) -> dict[str, Any]:
    return _set_status(post_id, "approved", actor, comment="Approved", comment_kind="approval")


def request_changes(post_id: int, comment: str, actor: str) -> dict[str, Any]:
    comment = comment.strip()
    if not comment:
        raise ValueError("Please describe the changes you need")
    return _set_status(post_id, "needs_changes", actor, comment=comment, comment_kind="change_request")


def _set_status(
    post_id: int,
    to_status: str,
    actor: str,
    comment: str | None,
    comment_kind: str | None,
) -> dict[str, Any]:
    now = time.time()
    c = _conn()
    try:
        post = _require_post(c, post_id)
        _assert_transition(str(post["status"]), to_status)
        extra_sets = ""
        extra_params: tuple[Any, ...] = ()
        if to_status == "approved":
            # Fresh approval also resets the publish counters so a re-approved
            # 'failed' post gets a new round of attempts.
            extra_sets = ", approved_by=?, approved_at=?, publish_attempts=0, publish_error=NULL"
            extra_params = (actor, now)
        elif to_status == "needs_changes":
            extra_sets = ", approved_by=NULL, approved_at=NULL"
        c.execute(
            f"UPDATE social_posts SET status=?, updated_at=?{extra_sets} WHERE id=?",
            (to_status, now, *extra_params, post_id),
        )
        if comment and comment_kind:
            c.execute(
                "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?)",
                (post_id, actor, comment_kind, comment, now),
            )
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def add_comment(post_id: int, body: str, actor: str) -> dict[str, Any]:
    body = body.strip()
    if not body:
        raise ValueError("Comment cannot be empty")
    now = time.time()
    c = _conn()
    try:
        _require_post(c, post_id)
        cur = c.execute(
            "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) "
            "VALUES (?, ?, 'comment', ?, ?) RETURNING id",
            (post_id, actor, body, now),
        )
        comment_id = int(cur.fetchone()["id"])
        c.commit()
        out = c.execute("SELECT * FROM social_post_comments WHERE id=?", (comment_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def add_media(
    post_id: int,
    file_name: str,
    content: bytes,
    content_type: str | None,
) -> dict[str, Any]:
    """Store the file under outreach_data/social_media/<post_id>/ and record it."""
    now = time.time()
    kind = "video" if (content_type or "").startswith("video/") else "image"
    if not (content_type or "").startswith(("image/", "video/")):
        raise ValueError("Only images and videos can be attached")
    c = _conn()
    try:
        _require_post(c, post_id)
        safe_name = Path(file_name).name or "asset"
        dest_dir = MEDIA_ROOT / str(post_id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        stored = dest_dir / f"{uuid.uuid4().hex[:10]}_{safe_name}"
        stored.write_bytes(content)
        max_row = c.execute(
            "SELECT MAX(sort_order) AS m FROM social_post_media WHERE post_id=?", (post_id,)
        ).fetchone()
        cur = c.execute(
            """
            INSERT INTO social_post_media (post_id, kind, file_name, stored_path, content_type, size_bytes, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                post_id,
                kind,
                safe_name,
                str(stored),
                content_type,
                len(content),
                int(max_row["m"] or 0) + 1,
                now,
            ),
        )
        media_id = int(cur.fetchone()["id"])
        c.commit()
        out = c.execute("SELECT * FROM social_post_media WHERE id=?", (media_id,)).fetchone()
        return dict(out)
    finally:
        c.close()


def get_media(media_id: int) -> dict[str, Any]:
    c = _conn()
    try:
        row = c.execute("SELECT * FROM social_post_media WHERE id=?", (media_id,)).fetchone()
        if not row:
            raise LookupError("Media not found")
        return dict(row)
    finally:
        c.close()


def remove_media(media_id: int) -> None:
    c = _conn()
    try:
        row = c.execute("SELECT * FROM social_post_media WHERE id=?", (media_id,)).fetchone()
        if not row:
            raise LookupError("Media not found")
        c.execute("DELETE FROM social_post_media WHERE id=?", (media_id,))
        c.commit()
        try:
            Path(str(row["stored_path"])).unlink(missing_ok=True)
        except OSError:
            pass  # dangling file is harmless
    finally:
        c.close()


# ---------------------------------------------------------------------------
# Public share links. A token is a capability: whoever holds it can read that
# one post (text, creatives, scheduled time) without an account. Nothing else
# leaks — no internal title, no author emails, no review comments — and the
# token can be revoked, which is the whole reason it is a column rather than
# the post id.
# ---------------------------------------------------------------------------


def ensure_share_token(post_id: int) -> dict[str, Any]:
    """Return the post with a share token, minting one on first call."""
    c = _conn()
    try:
        post = _require_post(c, post_id)
        if post.get("share_token"):
            return post
        c.execute(
            "UPDATE social_posts SET share_token=?, updated_at=? WHERE id=?",
            (secrets.token_urlsafe(16), time.time(), post_id),
        )
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def revoke_share_token(post_id: int) -> dict[str, Any]:
    """Kill the link. Anyone still holding it gets a 404 from here on."""
    c = _conn()
    try:
        _require_post(c, post_id)
        c.execute(
            "UPDATE social_posts SET share_token=NULL, updated_at=? WHERE id=?", (time.time(), post_id)
        )
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def get_shared_post(token: str) -> dict[str, Any]:
    """The public payload for a share link — built field by field on purpose."""
    token = (token or "").strip()
    if not token:
        raise LookupError("This share link is no longer valid")
    c = _conn()
    try:
        row = c.execute(
            "SELECT * FROM social_posts WHERE share_token=? AND deleted_at IS NULL", (token,)
        ).fetchone()
        if not row:
            raise LookupError("This share link is no longer valid")
        post = dict(row)
        media = c.execute(
            "SELECT id, kind, file_name, content_type FROM social_post_media WHERE post_id=? ORDER BY sort_order, id",
            (post["id"],),
        ).fetchall()
        return {
            "post": {
                "status": post["status"],
                "body": post["body"],
                "scheduled_at": post["scheduled_at"],
                "timezone": post["timezone"],
                "published_at": post["published_at"],
                "linkedin_post_url": post.get("linkedin_post_url"),
            },
            "media": [dict(m) for m in media],
        }
    finally:
        c.close()


def get_shared_media(token: str, media_id: int) -> dict[str, Any]:
    """A creative, but only if it belongs to the post that token unlocks."""
    c = _conn()
    try:
        row = c.execute(
            """
            SELECT m.* FROM social_post_media m
            JOIN social_posts p ON p.id = m.post_id
            WHERE m.id=? AND p.share_token=? AND p.deleted_at IS NULL
            """,
            (media_id, (token or "").strip()),
        ).fetchone()
        if not row:
            raise LookupError("Media not found")
        return dict(row)
    finally:
        c.close()


# ---------------------------------------------------------------------------
# Manual publishing (Phase A). Posting happens by hand on LinkedIn; the link
# comes back here so the scheduler stays an accurate record of what went out.
# ---------------------------------------------------------------------------

#: Statuses a post can be marked published from. Draft/pending/needs_changes
#: are excluded deliberately — if it went out without the tick, that is a
#: review problem, not a bookkeeping one.
_MANUAL_PUBLISH_FROM = ("approved", "scheduled", "failed", "published")


def mark_published_manual(post_id: int, url: str, actor: str) -> dict[str, Any]:
    url = (url or "").strip()
    if not url:
        raise ValueError("Paste the link to the live LinkedIn post")
    if not url.startswith(("http://", "https://")):
        raise ValueError("That does not look like a link — it should start with https://")
    if len(url) > 1000:
        raise ValueError("That link is too long to be real")
    now = time.time()
    c = _conn()
    try:
        post = _require_post(c, post_id)
        status = str(post["status"])
        if status not in _MANUAL_PUBLISH_FROM:
            raise ValueError("Approve the post first — only approved posts can be marked as published")
        c.execute(
            """
            UPDATE social_posts
            SET status='published', linkedin_post_url=?, published_at=COALESCE(published_at, ?),
                publish_error=NULL, updated_at=?
            WHERE id=?
            """,
            (url, now, now, post_id),
        )
        note = "Updated the link to the live LinkedIn post." if status == "published" else "Posted to LinkedIn manually — link recorded."
        c.execute(
            "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) VALUES (?, ?, 'comment', ?, ?)",
            (post_id, actor, note, now),
        )
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def unmark_published(post_id: int, actor: str) -> dict[str, Any]:
    """Undo a manual publish (wrong post, wrong link) — back to approved.

    Refused for posts the auto-publisher sent: those really are live on
    LinkedIn under a URN we did not invent, and pretending otherwise here
    would only make the record wrong.
    """
    now = time.time()
    c = _conn()
    try:
        post = _require_post(c, post_id)
        if str(post["status"]) != "published":
            raise ValueError("This post is not marked as published")
        if post.get("linkedin_post_urn"):
            raise ValueError("This post was published automatically — it cannot be un-published here")
        c.execute(
            "UPDATE social_posts SET status='approved', linkedin_post_url=NULL, published_at=NULL, updated_at=? WHERE id=?",
            (now, post_id),
        )
        c.execute(
            "INSERT INTO social_post_comments (post_id, author, kind, body, created_at) "
            "VALUES (?, ?, 'comment', 'Un-marked as published — back to approved.', ?)",
            (post_id, actor, now),
        )
        c.commit()
        return _require_post(c, post_id)
    finally:
        c.close()


def soft_delete_post(post_id: int) -> None:
    now = time.time()
    c = _conn()
    try:
        cur = c.execute(
            "UPDATE social_posts SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL",
            (now, now, post_id),
        )
        if cur.rowcount == 0:
            raise LookupError("Post not found")
        c.commit()
    finally:
        c.close()
