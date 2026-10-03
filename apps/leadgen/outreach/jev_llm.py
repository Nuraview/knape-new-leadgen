"""Jev (TypeSafe AI System One) client: typed semantic decisions, stdlib HTTP only.

Jev evaluates a piece of state against typed questions and returns STRUCTURED
answers with confidence, instead of generating prose. Three primitives:

  noul(instructions)                 probability (0..1) of a yes/no statement
  choice(instructions, criteria)     one option from a closed set
  score(instructions, criteria)      a rating on an ordered rubric (0..n-1)

This is the semantic decision layer of the lead-gen pipeline: ICP fit, pain
detection, buyer-role classification, entity resolution, routing. Retrieval,
arithmetic and side effects stay in code; Jev only interprets meaning. Pack many
atomic questions into ONE call: Jev evaluates them in parallel and bills input
tokens only, so a wide decision surface per lead is cheap.

The key is read from JEV_API_KEY / TYPESAFE_API_KEY via config.get_jev_api_key()
and never hard-coded. API shape verified live against jev-1.13.0:

  POST {JEV_API_BASE}/systemone  {model, state, questions}
    -> {model,
        answers: {id: {type, noul | choice | score, confidence?, probabilities?, legend?}},
        usage: {input_tokens, output_tokens}}
"""

from __future__ import annotations

import time
from typing import Any

from config import JEV_API_BASE, JEV_MODEL, get_jev_api_key
from utils.http import post_json

# post_json raises RuntimeError("HTTP <code>: ...") on non-2xx; these are worth a retry.
_RETRYABLE_HTTP = frozenset({408, 425, 429, 500, 502, 503, 529})


# --- question builders (mirror the TypeSafe SDK's noul / choice / score) ------
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


def _retryable(msg: str) -> bool:
    return any(f"HTTP {code}" in msg for code in _RETRYABLE_HTTP)


def jev_decide(
    *,
    state: dict[str, Any],
    questions: dict[str, dict[str, Any]],
    api_key: str | None = None,
    model: str | None = None,
    timeout: float = 60.0,
    max_attempts: int = 4,
) -> dict[str, Any]:
    """Run one System One request and return its ``answers`` map.

    `state` is the facts (company, contact, evidence, offer). `questions` maps a
    question id to a builder result (noul/choice/score). Raises RuntimeError when
    the key is missing or the API keeps failing; retries 429/5xx with exponential
    backoff (TypeSafe recommends backoff on 429/529).
    """
    key = (api_key or get_jev_api_key()).strip()
    if not key:
        raise RuntimeError("no Jev API key (set JEV_API_KEY or TYPESAFE_API_KEY in .env)")
    if not questions:
        raise ValueError("jev_decide needs at least one question")

    url = f"{JEV_API_BASE}/systemone"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {"model": (model or JEV_MODEL), "state": state, "questions": questions}

    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            # retries=0: this wrapper owns the retry loop so it can back off on 429/5xx.
            data = post_json(url, headers, body, timeout=timeout, retries=0)
            if not isinstance(data, dict) or "answers" not in data:
                raise RuntimeError(f"invalid Jev response: {str(data)[:300]}")
            return data["answers"]
        except RuntimeError as e:
            last_err = e
            if not _retryable(str(e)) or attempt >= max_attempts - 1:
                raise
            time.sleep(min(8.0, 0.75 * (2 ** attempt)))
    raise last_err or RuntimeError("Jev request failed")


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
