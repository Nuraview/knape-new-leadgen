"""Detached person-email enrichment — the top contact per account that has a LinkedIn
profile but no email. Dashboard order (ICP desc), so the initial schools fill first.
Resumable; writes contacts.email with status verified_web / pattern_inferred.
Uses Serper (search) only — Apollo's API is paywalled on the free plan.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: F401,E402

from pipeline.person_email import run  # noqa: E402

summary = run(sample=0, write=True, resume=True, workers=4)
summary.pop("sample", None)
print("\n===== PERSON EMAIL COMPLETE =====")
print(json.dumps(summary, indent=2))
(ROOT / "outreach_data/person_email_summary.json").write_text(json.dumps(summary, indent=2))
