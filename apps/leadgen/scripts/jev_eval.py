"""Evaluate the Jev target filter against a labeled set.

The playbook's first and highest-value deployment is the cheap ICP/target filter
run before paid enrichment, so this harness measures THAT: how well is_target
separates real Knape prospects from non-targets, and whether its confidence is
calibrated. Do not trust a threshold until you have plotted it here on your own
labeled data.

Labels file: JSON list of objects
  {"name": "...", "website": "...", "evidence": "...", "is_target": 0 | 1}

Usage (run from apps/leadgen with .env sourced):
  python -m scripts.jev_eval --labels data/jev_eval_labels.json
  python -m scripts.jev_eval --labels data/jev_eval_labels.json --make-golden data/jev_golden.json
  python -m scripts.jev_eval --labels data/jev_eval_labels.json --golden data/jev_golden.json
  python -m scripts.jev_eval --sample-db 40 --scope weftec-2026 --out data/jev_eval_template.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from outreach import cockpit_api as C  # noqa: E402
from outreach import jev_enrich as E  # noqa: E402


def _state(item: dict) -> dict:
    return {
        "company": {"name": item.get("name", ""), "website": item.get("website", "")},
        "evidence": (item.get("evidence") or "")[:8000],
    }


def _metrics(rows: list[dict]) -> dict:
    # rows: {label, prob, verdict}
    auto = [r for r in rows if r["verdict"] in ("pass", "drop")]
    review = [r for r in rows if r["verdict"] == "review"]
    tp = sum(1 for r in auto if r["verdict"] == "pass" and r["label"] == 1)
    fp = sum(1 for r in auto if r["verdict"] == "pass" and r["label"] == 0)
    tn = sum(1 for r in auto if r["verdict"] == "drop" and r["label"] == 0)
    fn = sum(1 for r in auto if r["verdict"] == "drop" and r["label"] == 1)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    acc = (tp + tn) / len(auto) if auto else 0.0
    # Calibration: predicted prob bucket vs actual positive rate.
    buckets: dict[str, list[int]] = {}
    for r in rows:
        b = f"{int(r['prob'] * 10) * 10}-{int(r['prob'] * 10) * 10 + 10}%"
        buckets.setdefault(b, []).append(r["label"])
    calib = {b: {"n": len(v), "actual_pos_rate": round(sum(v) / len(v), 3)} for b, v in sorted(buckets.items())}
    return {
        "n": len(rows), "auto_decided": len(auto), "review": len(review),
        "review_rate": round(len(review) / len(rows), 3) if rows else 0.0,
        "auto_accept_precision": round(precision, 3),
        "recall": round(recall, 3), "auto_accuracy": round(acc, 3),
        "confusion_on_auto": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
        "calibration": calib,
    }


def run_eval(labels_path: str, golden_path: str = "", make_golden: str = "") -> dict:
    items = json.loads(Path(labels_path).read_text(encoding="utf-8"))
    rows = []
    preds = {}
    for it in items:
        res = E.classify_target(_state(it))
        row = {"name": it.get("name", ""), "label": int(it.get("is_target", 0)),
               "prob": round(res["is_target"], 4), "verdict": res["verdict"],
               "application": res["application"]}
        rows.append(row)
        preds[it.get("name", "")] = {"prob": row["prob"], "verdict": row["verdict"]}
    out = {"metrics": _metrics(rows), "rows": rows}
    if make_golden:
        Path(make_golden).write_text(json.dumps(preds, indent=2), encoding="utf-8")
        out["golden_written"] = make_golden
    if golden_path and Path(golden_path).is_file():
        golden = json.loads(Path(golden_path).read_text(encoding="utf-8"))
        drift = []
        for name, p in preds.items():
            g = golden.get(name)
            if g and (g["verdict"] != p["verdict"] or abs(g["prob"] - p["prob"]) > 0.15):
                drift.append({"name": name, "golden": g, "now": p})
        out["drift"] = {"changed": len(drift), "rows": drift[:25]}
    return out


def sample_db(n: int, scope: str, out_path: str) -> dict:
    ids = E._account_ids(scope, n, only_new=False)
    items = []
    for aid in ids:
        st = C.account_jev_state(aid)
        comp = st.get("company") or {}
        items.append({
            "name": comp.get("name", ""), "website": comp.get("website", ""),
            "evidence": (st.get("evidence") or "")[:2000], "is_target": None,
        })
    Path(out_path).write_text(json.dumps(items, indent=2), encoding="utf-8")
    return {"sampled": len(items), "out": out_path, "note": "fill in is_target (0/1), then run --labels"}


def main() -> None:
    p = argparse.ArgumentParser(description="Evaluate the Jev target filter.")
    p.add_argument("--labels", help="JSON labels file")
    p.add_argument("--golden", default="", help="compare predictions to this golden snapshot")
    p.add_argument("--make-golden", default="", help="write current predictions as golden")
    p.add_argument("--sample-db", type=int, default=0, help="dump N real accounts as an unlabeled template")
    p.add_argument("--scope", default="all")
    p.add_argument("--out", default="data/jev_eval_template.json")
    args = p.parse_args()

    if args.sample_db:
        print(json.dumps(sample_db(args.sample_db, args.scope, args.out), indent=2))
        return
    if not args.labels:
        p.error("provide --labels or --sample-db")
    res = run_eval(args.labels, golden_path=args.golden, make_golden=args.make_golden)
    print(json.dumps(res["metrics"], indent=2))
    if "drift" in res:
        print("DRIFT:", json.dumps(res["drift"], indent=2))


if __name__ == "__main__":
    main()
