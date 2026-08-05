"""Detached org-level phone/email enrichment. Resumable; safe to re-run any time.

Independent of the Phase 2/3 people-enrichment run — separate checkpoint, plain HTTP
only (no camofox), gentle SERP throttle.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: F401 — loads .env

from pipeline.org_contact import run

summary = run(sample=0, write=True, resume=True, workers=3)
summary.pop("sample", None)
print("\n===== ORG CONTACT ENRICHMENT COMPLETE =====")
print(json.dumps(summary, indent=2))
Path(__file__).resolve().parent.parent.joinpath(
    "outreach_data/org_contact_summary.json"
).write_text(json.dumps(summary, indent=2))
