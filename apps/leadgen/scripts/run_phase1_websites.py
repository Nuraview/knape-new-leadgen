"""Phase 1 runner: resolve websites for all accounts missing one, write via upsert.

Tavily-only in practice (Serper key currently 403s → failover). Resumable: every
search response is cached per account id, so a re-run costs no credits for anything
already resolved. Writes through enrich_account_contacts (never sync_records).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)

from pipeline.enrich_websites import run  # noqa: E402
from utils.websearch import counts  # noqa: E402

_OUT = Path("/tmp/claude-0/-root-winday-winday-leadgen/39589f47-4461-41b6-ade5-f02239fa71fa/scratchpad")


def main() -> None:
    t0 = time.time()
    summary = run(sample=0, write=True, use_cache=True, throttle=0.8)
    decisions = summary.pop("decisions", [])
    summary["elapsed_sec"] = round(time.time() - t0, 1)
    summary["final_counts"] = counts()

    (_OUT / "phase1_full_summary.json").write_text(json.dumps(summary, indent=2))
    (_OUT / "phase1_full_decisions.json").write_text(json.dumps(decisions, indent=1))
    print("\n===== PHASE 1 COMPLETE =====")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
