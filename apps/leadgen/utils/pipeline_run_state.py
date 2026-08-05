"""Single-instance lock for pipeline CLIs + ``python main.py status``."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
LOCK_PATH = _ROOT / "outreach_data" / ".pipeline_run.json"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _pid_looks_like_pipeline_cli(pid: int) -> bool:
    """Avoid treating an unrelated reused PID as `main.py` still running (Linux)."""
    if not _pid_alive(pid):
        return False
    if sys.platform == "win32":
        return True
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return False
    return b"main.py" in cmd and (b"python" in cmd.lower() or b"python3" in cmd.lower())


def read_lock() -> dict | None:
    """Return lock payload if file exists and parses; does not check PID."""
    if not LOCK_PATH.is_file():
        return None
    try:
        data = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def clear_stale_lock() -> bool:
    """Remove lock file if missing, corrupt, or PID is not running. Returns True if file removed."""
    data = read_lock()
    if data is None:
        if LOCK_PATH.exists():
            try:
                LOCK_PATH.unlink()
            except OSError:
                pass
            return True
        return False
    try:
        pid = int(data.get("pid", 0))
    except (TypeError, ValueError):
        pid = 0
    if not _pid_looks_like_pipeline_cli(pid):
        try:
            LOCK_PATH.unlink()
        except OSError:
            pass
        return True
    return False


def begin_run(cmd: str) -> None:
    """Raise SystemExit if another live pipeline holds the lock; else claim lock for this process."""
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    clear_stale_lock()
    existing = read_lock()
    if existing:
        try:
            opid = int(existing.get("pid", 0))
            ocmd = str(existing.get("cmd", "?"))
        except (TypeError, ValueError):
            opid, ocmd = 0, "?"
        if opid and _pid_looks_like_pipeline_cli(opid):
            raise SystemExit(
                f"Pipeline already running: pid={opid} cmd={ocmd}\n"
                f"Stop that process first, or run `python main.py status`.\n"
                f"If it crashed, delete {LOCK_PATH} or run `python main.py status` (clears stale locks)."
            )
        try:
            LOCK_PATH.unlink()
        except OSError:
            pass

    payload = {
        "pid": os.getpid(),
        "cmd": cmd,
        "started_at_unix": time.time(),
        "cwd": str(Path.cwd()),
    }
    LOCK_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def end_run() -> None:
    """Release lock if this process owns it."""
    data = read_lock()
    if not data:
        return
    try:
        if int(data.get("pid", -1)) != os.getpid():
            return
    except (TypeError, ValueError):
        return
    try:
        LOCK_PATH.unlink()
    except OSError:
        pass


def format_status_line() -> str:
    """Human-readable one-liner for printing."""
    clear_stale_lock()
    data = read_lock()
    if not data:
        if LOCK_PATH.is_file():
            return (
                "Status: idle — lock file was invalid (removed).\n"
                f"  path: {LOCK_PATH}"
            )
        return (
            "Status: idle — nothing running (no lock file).\n"
            f"  Lock appears at {LOCK_PATH} only while a tracked command is active."
        )
    try:
        pid = int(data.get("pid", 0))
        cmd = str(data.get("cmd", "?"))
        t0 = float(data.get("started_at_unix", 0))
    except (TypeError, ValueError):
        return "Status: idle (lock file invalid; cleared)."
    if not _pid_looks_like_pipeline_cli(pid):
        clear_stale_lock()
        return "Status: idle (previous run ended or PID reused — stale lock cleared)."
    ago = time.time() - t0
    mins = int(ago // 60)
    secs = int(ago % 60)
    started = datetime.fromtimestamp(t0, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    return (
        f"Status: RUNNING — cmd={cmd} pid={pid} since={started} (~{mins}m {secs}s ago)\n"
        f"  lock: {LOCK_PATH}"
    )


def run_status_command() -> None:
    print(format_status_line())
