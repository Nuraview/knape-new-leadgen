"""What the agent knows, and how it remembers.

Without this the assistant starts every conversation from nothing. It can look
up five numbers and then forgets it ever did. It cannot tell you that
`free_sample` outperforms `bulk_scale`, that .k12 domains bounce hardest, that
Robin Huston is back on the 10th, or that you asked the same question
yesterday — because none of that survives the request that produced it.

A fact here is one durable sentence with provenance:

    kind        learned | observed | told         where it came from
    subject     angle:free_sample, lead:5312      what it is about
    fact        the sentence itself
    confidence  0..1, so a weak signal reads as weak
    evidence    the numbers behind it, as JSON
    source      who wrote it: agent_learn, inbox_agent, a person

RETRIEVAL WITHOUT EMBEDDINGS

Postgres full-text over subject and fact, ranked, with a recency tiebreak. An
embedding index would retrieve better on paraphrase, but it adds a model call
to every question, a vector column and a reindex job — for a store that will
hold hundreds of rows, not millions, and whose subjects are already keywords
the model itself wrote. It can be swapped in behind recall() without touching
a caller if that ever stops being true.

FACTS EXPIRE

An outcome fact is only true of the data that produced it. "free_sample leads
on reply rate" measured over 600 sends stops being interesting at 6,000, so
learned facts carry a stale_after and the learner overwrites its own
conclusions rather than accumulating contradictory ones.
"""

from __future__ import annotations

import json
import time
from typing import Any

from outreach import db


def init_db() -> None:
    c = db.connect()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_memory (
                id BIGSERIAL PRIMARY KEY,
                kind TEXT NOT NULL,
                subject TEXT NOT NULL,
                fact TEXT NOT NULL,
                confidence DOUBLE PRECISION DEFAULT 0.5,
                evidence TEXT,
                source TEXT,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL,
                stale_after DOUBLE PRECISION
            )
            """
        )
        # One row per (kind, subject): the learner replaces its conclusion about
        # an angle rather than stacking a new one beside the old, which is how a
        # memory ends up arguing with itself.
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS agent_memory_key "
            "ON agent_memory (kind, subject)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS agent_memory_search ON agent_memory "
            "USING gin (to_tsvector('english', subject || ' ' || fact))"
        )
        c.commit()
    finally:
        c.close()


def remember(
    *,
    kind: str,
    subject: str,
    fact: str,
    confidence: float = 0.5,
    evidence: Any = None,
    source: str = "agent",
    ttl_days: float | None = None,
) -> None:
    """Write one fact, replacing any earlier fact on the same subject."""
    now = time.time()
    init_db()
    c = db.connect()
    try:
        c.execute(
            """
            INSERT INTO agent_memory
                (kind, subject, fact, confidence, evidence, source,
                 created_at, updated_at, stale_after)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT (kind, subject) DO UPDATE SET
                fact = EXCLUDED.fact,
                confidence = EXCLUDED.confidence,
                evidence = EXCLUDED.evidence,
                source = EXCLUDED.source,
                updated_at = EXCLUDED.updated_at,
                stale_after = EXCLUDED.stale_after
            """,
            (
                kind,
                subject[:200],
                fact[:2000],
                float(confidence),
                json.dumps(evidence) if evidence is not None else None,
                source,
                now,
                now,
                now + ttl_days * 86400.0 if ttl_days else None,
            ),
        )
        c.commit()
    finally:
        c.close()


def recall(query: str = "", *, limit: int = 12, min_confidence: float = 0.0) -> list[dict[str, Any]]:
    """Facts relevant to a question, best first.

    An empty query returns the strongest current knowledge, which is what the
    assistant loads at the start of a conversation so it opens already knowing
    what works rather than discovering it again.
    """
    init_db()
    now = time.time()
    c = db.connect()
    try:
        if (query or "").strip():
            rows = c.execute(
                """
                SELECT kind, subject, fact, confidence, evidence, source, updated_at,
                       ts_rank(to_tsvector('english', subject || ' ' || fact),
                               plainto_tsquery('english', ?)) AS rank
                FROM agent_memory
                WHERE (stale_after IS NULL OR stale_after > ?)
                  AND confidence >= ?
                  AND to_tsvector('english', subject || ' ' || fact)
                      @@ plainto_tsquery('english', ?)
                ORDER BY rank DESC, confidence DESC, updated_at DESC
                LIMIT ?
                """,
                (query, now, min_confidence, query, int(limit)),
            ).fetchall()
            if rows:
                return [dict(r) for r in rows]
            # No lexical hit is not the same as nothing worth saying — fall
            # through to the strongest general knowledge rather than answering
            # from an empty head.
        rows = c.execute(
            """
            SELECT kind, subject, fact, confidence, evidence, source, updated_at
            FROM agent_memory
            WHERE (stale_after IS NULL OR stale_after > ?) AND confidence >= ?
            ORDER BY confidence DESC, updated_at DESC
            LIMIT ?
            """,
            (now, min_confidence, int(limit)),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        c.close()


def as_prompt(facts: list[dict[str, Any]]) -> str:
    """Render facts for a system prompt, strongest first, confidence visible.

    The model is told how sure each line is so it can hedge honestly rather
    than repeating a weak signal as settled fact.
    """
    if not facts:
        return ""
    lines = []
    for f in facts:
        conf = float(f.get("confidence") or 0)
        strength = "high" if conf >= 0.75 else "medium" if conf >= 0.45 else "low"
        lines.append(f"- ({strength}) {f['fact']}")
    return "What you have learned about this account so far:\n" + "\n".join(lines)


def stats() -> dict[str, Any]:
    init_db()
    c = db.connect()
    try:
        r = c.execute(
            "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS latest FROM agent_memory"
        ).fetchone()
        by_kind = c.execute(
            "SELECT kind, COUNT(*) AS n FROM agent_memory GROUP BY kind ORDER BY 2 DESC"
        ).fetchall()
        return {
            "facts": int(r["n"] or 0),
            "latest": float(r["latest"] or 0),
            "by_kind": [dict(x) for x in by_kind],
        }
    finally:
        c.close()
