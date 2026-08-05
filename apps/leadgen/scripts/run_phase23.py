"""Detached Phase 2+3 runner — safe to re-run any time; resumes from checkpoint."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.contact_extract import run

summary = run(sample=0, write=True, resume=True, workers=8)
summary.pop("sample", None)
print("\n===== PHASE 2+3 COMPLETE =====")
print(json.dumps(summary, indent=2))
Path("/root/winday/winday-leadgen/outreach_data/phase23_summary.json").write_text(json.dumps(summary, indent=2))
