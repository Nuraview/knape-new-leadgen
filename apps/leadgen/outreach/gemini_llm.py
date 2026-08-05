"""Google Gemini API (Generative Language API; stdlib HTTP only).

Uses ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY`` from ``.env`` and native model ids such as
``gemini-2.5-flash-lite`` (not OpenRouter slugs like ``google/gemini-…``).
"""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import quote

from config import (
    GEMINI_MODEL,
    OPENROUTER_API_BASE,
    OPENROUTER_MODEL,
    get_gemini_api_key,
    get_openrouter_api_key,
    llm_uses_openrouter,
)
from utils.http import post_json

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.I)

_RETRYABLE_HTTP = frozenset({408, 429, 500, 502, 503, 529})


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse model JSON, tolerating markdown fences or leading/trailing prose."""
    raw = (text or "").strip()
    m = _JSON_FENCE.search(raw)
    if m:
        raw = m.group(1).strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(raw[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("expected JSON object")
    return parsed


def _normalize_model_id(model: str) -> str:
    m = (model or GEMINI_MODEL or "").strip()
    if m.startswith("google/"):
        m = m.split("/", 1)[1]
    return m or GEMINI_MODEL


def _extract_candidate_text(data: dict[str, Any]) -> str:
    if data.get("error"):
        err = data["error"]
        msg = err.get("message", err) if isinstance(err, dict) else err
        raise RuntimeError(f"Gemini error: {str(msg)[:800]}")
    candidates = data.get("candidates") or []
    if not candidates:
        pf = data.get("promptFeedback") or {}
        block = pf.get("blockReason")
        if block:
            raise RuntimeError(f"Gemini blocked response: {block}")
        raise RuntimeError("no candidates from Gemini")
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    chunks: list[str] = []
    for part in parts:
        if isinstance(part, dict):
            text = part.get("text")
            if text is not None:
                chunks.append(str(text))
        elif isinstance(part, str):
            chunks.append(part)
    text = "".join(chunks).strip()
    if not text:
        raise RuntimeError("empty content from Gemini")
    return text


# --- OpenRouter (OpenAI-compatible) path ----------------------------------------

def _openrouter_model_id(model: str) -> str:
    """Map a native Gemini model id to an OpenRouter slug. ``OPENROUTER_MODEL`` (if set)
    wins; otherwise derive ``google/<model>`` so it tracks ``GEMINI_MODEL``."""
    if OPENROUTER_MODEL:
        return OPENROUTER_MODEL
    m = (model or GEMINI_MODEL or "").strip()
    if "/" in m:
        return m
    return f"google/{m}" if m else "google/gemini-2.5-flash-lite"


def _extract_openrouter_text(data: dict[str, Any]) -> str:
    if data.get("error"):
        err = data["error"]
        msg = err.get("message", err) if isinstance(err, dict) else err
        raise RuntimeError(f"OpenRouter error: {str(msg)[:800]}")
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("no choices from OpenRouter")
    message = choices[0].get("message") or {}
    text = str(message.get("content") or "").strip()
    if not text:
        raise RuntimeError("empty content from OpenRouter")
    return text


def _post_with_retries(
    *,
    url: str,
    headers: dict[str, str],
    body: dict[str, object],
    timeout: float,
    max_attempts: int = 4,
) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            data = post_json(url, headers, body, timeout=timeout)
            if not isinstance(data, dict):
                raise RuntimeError("invalid OpenRouter response")
            return data
        except RuntimeError as e:
            last_err = e
            msg = str(e)
            retryable = any(f"HTTP {code}" in msg for code in _RETRYABLE_HTTP)
            if not retryable or attempt >= max_attempts - 1:
                raise
            time.sleep(min(12.0, 1.5 * (2**attempt)))
    raise last_err or RuntimeError("OpenRouter request failed")


def _openrouter_generate_text(
    *,
    api_key: str,
    model: str,
    system_instruction: str,
    user_text: str,
    temperature: float,
    timeout: float,
    response_mime_type: str | None,
) -> str:
    key = (api_key or "").strip()
    if not key.startswith("sk-or-"):
        key = get_openrouter_api_key()
    if not key:
        raise RuntimeError("no OpenRouter API key (set OPENROUTER_API_KEY in .env)")
    model_id = _openrouter_model_id(model)
    url = f"{OPENROUTER_API_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Optional attribution headers recommended by OpenRouter.
        "HTTP-Referer": "https://peter.auxcgen.com",
        "X-Title": "HVAC Leadgen Cockpit",
    }
    base_body: dict[str, object] = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_text},
        ],
        "temperature": temperature,
    }
    # Try JSON mode first (not every model honors it), then fall back to plain.
    attempts: list[dict[str, object]] = []
    if response_mime_type == "application/json":
        with_json = dict(base_body)
        with_json["response_format"] = {"type": "json_object"}
        attempts.append(with_json)
    attempts.append(dict(base_body))

    last_err: Exception | None = None
    for body in attempts:
        try:
            data = _post_with_retries(url=url, headers=headers, body=body, timeout=timeout)
            return _extract_openrouter_text(data)
        except RuntimeError as e:
            last_err = e
            continue
    raise last_err or RuntimeError("OpenRouter request failed")


# --- Native Gemini path ----------------------------------------------------------

def _gemini_generate(
    *,
    api_key: str,
    model: str,
    body: dict[str, object],
    timeout: float,
) -> dict[str, Any]:
    model_id = quote(_normalize_model_id(model), safe="")
    url = f"{GEMINI_API_BASE}/models/{model_id}:generateContent?key={quote(api_key, safe='')}"
    headers = {"Content-Type": "application/json"}
    data = post_json(url, headers, body, timeout=timeout)
    if not isinstance(data, dict):
        raise RuntimeError("invalid Gemini response")
    return data


def _call_with_retries(
    *,
    api_key: str,
    model: str,
    body: dict[str, object],
    timeout: float,
    max_attempts: int = 4,
) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return _gemini_generate(api_key=api_key, model=model, body=body, timeout=timeout)
        except RuntimeError as e:
            last_err = e
            msg = str(e)
            retryable = any(f"HTTP {code}" in msg for code in _RETRYABLE_HTTP)
            if not retryable or attempt >= max_attempts - 1:
                raise
            time.sleep(min(12.0, 1.5 * (2**attempt)))
    raise last_err or RuntimeError("Gemini request failed")


def gemini_generate_text(
    *,
    api_key: str,
    model: str,
    system_instruction: str,
    user_text: str,
    temperature: float,
    timeout: float,
    response_mime_type: str | None = "application/json",
) -> str:
    """Generate assistant text. Routes through OpenRouter (Gemini model) when
    ``OPENROUTER_API_KEY`` is set, otherwise calls Google Gemini ``generateContent``."""
    if llm_uses_openrouter():
        return _openrouter_generate_text(
            api_key=api_key,
            model=model,
            system_instruction=system_instruction,
            user_text=user_text,
            temperature=temperature,
            timeout=timeout,
            response_mime_type=response_mime_type,
        )
    key = (api_key or "").strip() or get_gemini_api_key()
    if not key:
        raise RuntimeError(
            "no Gemini API key (set GEMINI_API_KEY or GOOGLE_API_KEY in .env — Google AI Studio key)"
        )
    model_id = _normalize_model_id(model)

    base_body: dict[str, object] = {
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "generationConfig": {"temperature": temperature},
    }

    attempts: list[dict[str, object]] = []
    if response_mime_type:
        with_json = dict(base_body)
        gen = dict(with_json.get("generationConfig") or {})  # type: ignore[arg-type]
        gen["responseMimeType"] = response_mime_type
        with_json["generationConfig"] = gen
        attempts.append(with_json)
    attempts.append(dict(base_body))

    last_err: Exception | None = None
    for body in attempts:
        try:
            data = _call_with_retries(
                api_key=key, model=model_id, body=body, timeout=timeout
            )
            return _extract_candidate_text(data)
        except RuntimeError as e:
            last_err = e
            continue
    raise last_err or RuntimeError("Gemini request failed")
