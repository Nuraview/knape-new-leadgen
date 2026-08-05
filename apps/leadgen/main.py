"""
CLI entry: ``python main.py [cmd]``. Commands load their pipeline lazily (see README).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# NOTE: ``cockpit-api`` is intentionally NOT tracked. It is a long-lived server,
# not a pipeline run — tracking it made it hold the run-lock for its whole
# lifetime, so the dashboard showed "Pipeline running" forever.
_TRACKED_CMDS = frozenset(
    {
        "milestone1",
        "milestone2",
        "milestone2-enrich",
        "milestone2-research",
        "milestone2-dashboard",
    }
)

# Accept common typo: milestone_2-* → milestone2-*
_CMD_ALIASES: dict[str, str] = {
    "milestone_2": "milestone2",
    "milestone_2-enrich": "milestone2-enrich",
    "milestone_2-research": "milestone2-research",
    "milestone_2-dashboard": "milestone2-dashboard",
}


def _normalize_cmd_argv() -> None:
    if len(sys.argv) < 2:
        return
    raw = sys.argv[1]
    if raw in _CMD_ALIASES:
        canon = _CMD_ALIASES[raw]
        print(f"Note: `{raw}` is not a valid command — using `{canon}` instead.", file=sys.stderr, flush=True)
        sys.argv[1] = canon


def _call(mod: str, fn: str) -> None:
    m = __import__(mod, fromlist=[fn])
    getattr(m, fn)()


def _maybe_reexec_with_venv(cmd: str, err: ModuleNotFoundError) -> None:
    """For optional heavy deps (FastAPI), auto-hop into project venv when available."""
    if cmd != "cockpit-api":
        return
    if err.name not in {"fastapi", "uvicorn", "pydantic", "starlette"}:
        return
    vpy = Path(__file__).resolve().parent / ".venv" / "bin" / "python"
    if not vpy.is_file():
        return
    cur = Path(sys.executable)
    if cur == vpy:
        return
    print(
        f"Dependency '{err.name}' missing on {cur}. Re-running with {vpy} …",
        flush=True,
    )
    os.execv(str(vpy), [str(vpy), *sys.argv])


def _call_tracked(cmd_name: str, mod: str, fn: str) -> None:
    from utils.pipeline_run_state import begin_run, end_run

    begin_run(cmd_name)
    try:
        _call(mod, fn)
    finally:
        end_run()


def main() -> None:
    _normalize_cmd_argv()
    cmds = {
        "milestone1": ("pipeline.milestone1", "run_milestone1"),
        "contacts": ("pipeline.contacts", "run_contacts"),
        "milestone2": ("pipeline.milestone2", "run_milestone2"),
        "milestone2-enrich": ("pipeline.milestone2", "run_milestone2_enrich"),
        "milestone2-research": ("pipeline.milestone2", "run_milestone2_research"),
        "milestone2-dashboard": ("outreach.dashboard", "run_dashboard"),
        "cockpit-api": ("outreach.cockpit_api", "run_cockpit_api"),
        # Fetches every link the templates can put in an email. Run it after
        # any copy change — the last time nobody did, ten angles shipped
        # pointing at eight pages that had never been built.
        "check-links": ("outreach.link_check", "print_report"),
    }
    p = argparse.ArgumentParser(description="Win the Day leads — see README.md")
    p.add_argument(
        "cmd",
        nargs="?",
        default="milestone1",
        choices=("status", *cmds.keys()),
        help="default milestone1 → scrape/score → 1.xlsx; use `status` to see if a pipeline is running",
    )
    args = p.parse_args()

    if args.cmd == "status":
        from utils.pipeline_run_state import run_status_command

        run_status_command()
        return

    try:
        mod, fn = cmds[args.cmd]
        try:
            if args.cmd in _TRACKED_CMDS:
                _call_tracked(args.cmd, mod, fn)
            else:
                _call(mod, fn)
        except ModuleNotFoundError as e:
            _maybe_reexec_with_venv(args.cmd, e)
            raise
    except KeyboardInterrupt:
        from utils.pipeline_run_state import end_run

        end_run()
        print(
            "\nInterrupted — pipeline lock released. "
            "Confirm with: python main.py status",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
