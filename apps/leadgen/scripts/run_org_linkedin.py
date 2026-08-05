"""Detached org LinkedIn company-page enrichment. Resumable; safe to re-run.

Independent of the people-enrichment and org phone/email runs (own checkpoint).
SERP only — never fetches a linkedin.com page.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: F401 — loads .env

from pipeline.org_linkedin import run

summary = run(sample=0, write=True, resume=True, workers=3)
summary.pop("sample", None)
print("\n===== ORG LINKEDIN COMPLETE =====")
print(json.dumps(summary, indent=2))
Path(__file__).resolve().parent.parent.joinpath(
    "outreach_data/org_linkedin_summary.json"
).write_text(json.dumps(summary, indent=2))
