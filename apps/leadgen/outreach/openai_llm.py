"""OpenAI chat-completions client (stdlib HTTP) for email drafting.

Kept separate from ``gemini_llm`` (OpenRouter) on purpose: company *research*
runs on OpenRouter/Gemini, while outreach *email drafting* runs on OpenAI with
the model in ``OPENAI_MODEL`` (e.g. ``gpt-5.4-mini``).
"""

from __future__ import annotations

import json
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import OPENAI_API_BASE, OPENAI_MODEL, get_openai_api_key


class OpenAIError(RuntimeError):
    pass


def _extract_text(resp: dict[str, Any]) -> str:
    choices = resp.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content")
            if isinstance(content, str):
                return content.strip()
    return ""


def openai_generate_text(
    *,
    system_instruction: str,
    user_text: str,
    model: str = "",
    temperature: float = 0.6,
    timeout: float = 60.0,
    api_key: str = "",
) -> str:
    """One chat completion → assistant text. Raises OpenAIError on failure."""
    key = (api_key or get_openai_api_key()).strip()
    if not key:
        raise OpenAIError("OPENAI_API_KEY not set")
    mdl = (model or OPENAI_MODEL).strip()
    payload: dict[str, Any] = {
        "model": mdl,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_text},
        ],
    }
    # Newer reasoning models reject custom temperature; only send when non-default.
    if abs(temperature - 1.0) > 1e-6:
        payload["temperature"] = temperature
    body = json.dumps(payload).encode("utf-8")
    url = f"{OPENAI_API_BASE}/chat/completions"
    ctx = ssl.create_default_context()
    last_err: Exception | None = None
    for attempt in range(3):
        req = Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            text = _extract_text(data)
            if not text:
                raise OpenAIError("empty completion")
            return text
        except HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:400] if e.fp else ""
            last_err = OpenAIError(f"HTTP {e.code}: {detail}")
            # Retry only transient throttling / server errors.
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last_err
        except (URLError, OSError, TimeoutError, json.JSONDecodeError) as e:
            last_err = OpenAIError(f"{type(e).__name__}: {e}")
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise last_err
    raise last_err or OpenAIError("unknown error")


def parse_json_object(text: str) -> dict[str, Any]:
    """Best-effort JSON-object parse, tolerating ```json fences and prose."""
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s.strip("`")
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    a, b = s.find("{"), s.rfind("}")
    if a != -1 and b != -1 and b > a:
        try:
            obj = json.loads(s[a : b + 1])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    raise OpenAIError("could not parse JSON from model output")
