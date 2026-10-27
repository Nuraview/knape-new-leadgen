"""Typed semantic decisions on Claude (``outreach.claude_llm``, Haiku by default).

Evaluates a piece of state against typed questions and returns STRUCTURED
answers with confidence, instead of generating prose. Three primitives:

  noul(instructions)                 probability (0..1) of a yes/no statement
  choice(instructions, criteria)     one option from a closed set
  score(instructions, criteria)      a rating on an ordered rubric (0..n-1)

This is the semantic decision layer of the lead-gen pipeline ("Jev" in the
field, table and endpoint names): ICP fit, pain detection, buyer-role
classification, entity resolution, routing. Retrieval, arithmetic and side
effects stay in code; the model only interprets meaning. Pack many atomic
questions into ONE call: all of a stage's questions are answered in a single
forced tool call whose input schema is built from the questions, so every
answer is typed and bounded (enum for choice, integer range for score).

Answers map shape (unchanged from the original Jev API, so the accessors and
stored ``raw_json`` keep their meaning):

  {id: {type: "noul", noul: p}}
  {id: {type: "choice", choice: key, confidence: c}}
  {id: {type: "score", score: n, confidence: c}}
"""

from __future__ import annotations

import json
from typing import Any

from outreach.claude_llm import ClaudeError, claude_messages

_TOOL_NAME = "record_answers"
_SYSTEM = (
    "You are a precise classification engine. You receive STATE (facts as JSON) and a set "
    "of typed questions, and you answer every question by calling the record_answers tool "
    "exactly once. Judge only from the state; when the state does not support a claim, say "
    "so through a low probability, an 'unknown'/'other' option, or a low confidence. "
    "noul answers are the probability (0..1) that the statement is true. choice answers "
    "pick exactly one option key. score answers pick the 0-based index of the rubric band "
    "(bands are listed worst first). confidence is 0..1: how sure you are of that answer."
)


# --- question builders (noul / choice / score) --------------------------------
def noul(instructions: str) -> dict[str, Any]:
    """Yes/no probability. Keep it to a single, literal statement."""
    return {"type": "noul", "instructions": instructions.strip()}


def choice(instructions: str, criteria: dict[str, str]) -> dict[str, Any]:
    """Closed-set classification. `criteria` maps option key to what it means.

    Always include an explicit "other"/"unknown" option when the set is not
    exhaustive, so the model is not forced into a wrong bucket.
    """
    return {"type": "choice", "instructions": instructions.strip(), "criteria": dict(criteria)}


def score(instructions: str, criteria: list[str]) -> dict[str, Any]:
    """Ordered-rubric rating. `criteria` are the ordered band labels, worst first.

    The returned score runs 0..len(criteria)-1. Do not hide arithmetic in the
    rubric; compute numeric thresholds in code.
    """
    return {"type": "score", "instructions": instructions.strip(), "criteria": list(criteria)}


def _answer_properties(qid: str, q: dict[str, Any]) -> dict[str, Any]:
    """Flat tool-input properties for one question: ``<qid>`` holds the answer and,
    for choice/score, ``<qid>_confidence`` its confidence. Flat on purpose: Haiku
    flattens nested answer objects into exactly this shape when asked for them."""
    kind = q.get("type")
    desc = str(q.get("instructions") or "")
    conf = {
        "type": "number", "minimum": 0, "maximum": 1,
        "description": f"Confidence (0..1) in your answer to {qid}.",
    }
    if kind == "noul":
        return {qid: {"type": "number", "minimum": 0, "maximum": 1,
                      "description": f"Probability (0..1) that this is true: {desc}"}}
    if kind == "choice":
        crit = q.get("criteria") or {}
        options = "; ".join(f"{k}: {v}" for k, v in crit.items())
        return {
            qid: {"type": "string", "enum": list(crit), "description": f"{desc}\nOptions: {options}"},
            f"{qid}_confidence": conf,
        }
    if kind == "score":
        bands = list(q.get("criteria") or [])
        rubric = "; ".join(f"{i}: {b}" for i, b in enumerate(bands))
        return {
            qid: {"type": "integer", "minimum": 0, "maximum": max(0, len(bands) - 1),
                  "description": f"{desc}\nRubric (0-based band index, worst first): {rubric}"},
            f"{qid}_confidence": conf,
        }
    raise ValueError(f"unknown question type: {kind!r}")


def _clamp01(v: Any, default: float) -> float:
    try:
        return min(1.0, max(0.0, float(v)))
    except (TypeError, ValueError):
        return default


def _normalize(qid: str, q: dict[str, Any], raw: dict[str, Any]) -> dict[str, Any] | None:
    """Tool input -> the typed answer for one question, or None if missing/invalid."""
    kind = q["type"]
    val = raw.get(qid)
    if val is None:
        return None
    if kind == "noul":
        return {"type": "noul", "noul": _clamp01(val, 0.5)}
    conf = _clamp01(raw.get(f"{qid}_confidence"), 0.0)
    if kind == "choice":
        c = str(val)
        return {"type": "choice", "choice": c, "confidence": conf} if c in (q.get("criteria") or {}) else None
    try:
        s = int(round(float(val)))
    except (TypeError, ValueError):
        return None
    s = min(max(0, s), max(0, len(q.get("criteria") or []) - 1))
    return {"type": "score", "score": s, "confidence": conf}


def jev_decide(
    *,
    state: dict[str, Any],
    questions: dict[str, dict[str, Any]],
    model: str | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Answer every question about ``state`` in one Claude call; return the answers map.

    `state` is the facts (company, contact, evidence, offer). `questions` maps a
    question id to a builder result (noul/choice/score). Raises RuntimeError
    (``ClaudeError``) when the key is missing, the API keeps failing (the client
    retries 429/5xx), or the model leaves a question unanswered.
    """
    if not questions:
        raise ValueError("jev_decide needs at least one question")
    props: dict[str, Any] = {}
    for qid, q in questions.items():
        props.update(_answer_properties(qid, q))
    tool = {
        "name": _TOOL_NAME,
        "description": "Record one typed answer (plus confidence where asked) per question id.",
        "input_schema": {"type": "object", "properties": props, "required": list(props)},
    }
    data = claude_messages(
        system=_SYSTEM,
        messages=[{"role": "user", "content": "STATE:\n" + json.dumps(state, ensure_ascii=False, default=str)}],
        model=model or "",
        max_tokens=1024 + 64 * len(questions),
        tools=[tool],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        timeout=timeout,
    )
    raw = next(
        (b.get("input") for b in data.get("content") or []
         if b.get("type") == "tool_use" and b.get("name") == _TOOL_NAME),
        None,
    )
    if not isinstance(raw, dict):
        raise ClaudeError(f"no {_TOOL_NAME} tool call in response (stop_reason={data.get('stop_reason')})")
    answers: dict[str, Any] = {}
    missing: list[str] = []
    for qid, q in questions.items():
        a = _normalize(qid, q, raw)
        if a is None:
            missing.append(qid)
        else:
            answers[qid] = a
    if missing:
        raise ClaudeError(f"model left questions unanswered or invalid: {', '.join(missing)}")
    return answers


# --- typed accessors on an answers map (never raise; return safe defaults) ----
def noul_prob(answers: dict[str, Any], qid: str, default: float = 0.0) -> float:
    a = answers.get(qid) or {}
    try:
        return float(a.get("noul", default))
    except (TypeError, ValueError):
        return default


def choice_value(answers: dict[str, Any], qid: str, default: str = "") -> str:
    a = answers.get(qid) or {}
    return str(a.get("choice", default) or default)


def score_value(answers: dict[str, Any], qid: str, default: float = 0.0) -> float:
    a = answers.get(qid) or {}
    try:
        return float(a.get("score", default))
    except (TypeError, ValueError):
        return default


def confidence(answers: dict[str, Any], qid: str, default: float = 0.0) -> float:
    """Confidence for an answer. noul carries none, so derive it from how far the
    probability sits from 0.5 (0.5 -> 0 certainty, 0 or 1 -> full certainty)."""
    a = answers.get(qid) or {}
    if a.get("type") == "noul":
        try:
            return abs(float(a.get("noul", 0.5)) - 0.5) * 2.0
        except (TypeError, ValueError):
            return default
    try:
        return float(a.get("confidence", default))
    except (TypeError, ValueError):
        return default
