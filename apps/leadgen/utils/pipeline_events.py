"""Lightweight pipeline activity log + credit-warning sink (stdlib only).

The pipeline CLIs (``milestone1``/``milestone2*``) call :func:`emit` at key points;
the cockpit API reads them back via :func:`read_recent` so the React dashboard can
show live progress and surface out-of-credit / rate-limit warnings.

Storage is an append-only JSONL file under ``outreach_data/``, trimmed to the last
``MAX_EVENTS`` lines. Every function is best-effort and never raises — logging must
never break a pipeline run.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
EVENTS_PATH = _ROOT / "outreach_data" / "pipeline_events.jsonl"
MAX_EVENTS = 500

# info = normal step · success = stage finished · warn = non-fatal issue
# error = stage failed · credit = vendor out-of-credits / rate-limit (banner-worthy)
_VALID_LEVELS = {"info", "success", "warn", "error", "credit"}


def emit(stage: str, message: str, *, level: str = "info", **fields: Any) -> None:
    """Append one activity event. Best-effort; swallows all I/O errors."""
    try:
        EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        rec: dict[str, Any] = {
            "ts": time.time(),
            "stage": str(stage)[:40],
            "level": level if level in _VALID_LEVELS else "info",
            "message": str(message)[:1000],
        }
        for k, v in fields.items():
            rec[k] = v
        with EVENTS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")
        _maybe_trim()
    except OSError:
        pass


def _maybe_trim() -> None:
    try:
        if EVENTS_PATH.stat().st_size < 600_000:
            return
        lines = EVENTS_PATH.read_text(encoding="utf-8").splitlines()
        if len(lines) > MAX_EVENTS:
            EVENTS_PATH.write_text(
                "\n".join(lines[-MAX_EVENTS:]) + "\n", encoding="utf-8"
            )
    except OSError:
        pass


def read_recent(limit: int = 80) -> list[dict[str, Any]]:
    """Most recent events (oldest→newest), capped at ``limit``."""
    try:
        lines = EVENTS_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for ln in lines[-limit:]:
        ln = ln.strip()
        if not ln:
            continue
        try:
            d = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def run_started(cmd: str) -> None:
    emit(cmd, f"Started {cmd}", level="info", boundary="start")


def run_finished(cmd: str, ok: bool, **counts: Any) -> None:
    emit(
        cmd,
        f"Finished {cmd}" + ("" if ok else " (with errors)"),
        level="success" if ok else "error",
        boundary="end",
        **counts,
    )


def credit_alert(vendor: str, detail: str) -> None:
    """Record a vendor quota / billing / rate-limit problem (drives the UI banner)."""
    emit("credit", f"{vendor}: {detail}", level="credit", vendor=vendor)


def classify_quota_error(text: str) -> str | None:
    """Human reason if an error string looks like out-of-credits / rate-limit, else None."""
    t = (text or "").lower()
    if any(
        s in t
        for s in ("402", "payment required", "insufficient", "quota", "out of credit", "billing")
    ):
        return "out of credits / quota or billing problem"
    if any(s in t for s in ("429", "rate limit", "too many requests")):
        return "rate limited (HTTP 429)"
    if "403" in t:
        return "blocked (HTTP 403) — often a rate limit or expired key"
    return None


def note_vendor_error(vendor: str, exc: BaseException) -> None:
    """If ``exc`` looks like a quota/rate-limit problem, record a credit alert."""
    reason = classify_quota_error(str(exc))
    if reason:
        credit_alert(vendor, reason)
