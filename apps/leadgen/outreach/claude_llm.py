"""Anthropic Claude client (stdlib HTTP): the one model every AI step uses.

Email drafting, company research, contact extraction, inbox triage and the
show research pass all call ``claude_generate_text`` here, so the key, the
model and the retry policy live in one place. The default model is Haiku
(``ANTHROPIC_MODEL``, default ``claude-haiku-5-5``): fast and cheap enough to
run over thousands of companies.

The key resolves dashboard setting -> ``ANTHROPIC_API_KEY`` env, the same
precedence every other provider key in the Keys tab follows.
"""

from __future__ import annotations

import json
import os
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-5-5"
#: Server-side web search, billed per search. Haiku supports it.
WEB_SEARCH_TOOL = "web_search_20260209"


class ClaudeError(RuntimeError):
    pass


def get_anthropic_api_key() -> str:
    try:
        from outreach.app_settings import get_setting

        v = str(get_setting("ANTHROPIC_API_KEY") or "").strip()
        if v:
            return v
    except Exception:  # noqa: BLE001 — settings unreadable: fall back to env
        pass
    return (os.getenv("ANTHROPIC_API_KEY") or "").strip()


def claude_model() -> str:
    return (os.getenv("ANTHROPIC_MODEL") or "").strip() or DEFAULT_MODEL


def claude_enabled() -> bool:
    return bool(get_anthropic_api_key())


def claude_messages(
    *,
    system: str,
    messages: list[dict[str, Any]],
    model: str = "",
    max_tokens: int = 2048,
    temperature: float | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | None = None,
    timeout: float = 120.0,
    api_key: str = "",
) -> dict[str, Any]:
    """One Messages API call -> the raw response dict. Raises ClaudeError.

    Retries 429/5xx/529 and network errors three times with backoff.
    """
    key = (api_key or get_anthropic_api_key()).strip()
    if not key:
        raise ClaudeError("ANTHROPIC_API_KEY not set")
    payload: dict[str, Any] = {
        "model": (model or claude_model()).strip(),
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if tools:
        payload["tools"] = tools
    if tool_choice:
        payload["tool_choice"] = tool_choice
    body = json.dumps(payload).encode("utf-8")
    ctx = ssl.create_default_context()
    last: ClaudeError | None = None
    for attempt in range(4):
        req = Request(
            API_URL,
            data=body,
            method="POST",
            headers={
                "x-api-key": key,
                "anthropic-version": API_VERSION,
                "content-type": "application/json",
            },
        )
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:400] if e.fp else ""
            last = ClaudeError(f"HTTP {e.code}: {detail}")
            if e.code in (429, 500, 502, 503, 504, 529) and attempt < 3:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise last from e
        except (URLError, OSError, TimeoutError, json.JSONDecodeError) as e:
            last = ClaudeError(f"{type(e).__name__}: {e}")
            if attempt < 3:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise last from e
    raise last or ClaudeError("unknown error")


def response_text(data: dict[str, Any]) -> str:
    return "".join(
        b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text"
    ).strip()


def claude_generate_text(
    *,
    system_instruction: str,
    user_text: str,
    model: str = "",
    temperature: float | None = None,
    max_tokens: int = 2048,
    timeout: float = 120.0,
    api_key: str = "",
) -> str:
    """System + one user turn -> the assistant's text. Raises ClaudeError."""
    data = claude_messages(
        system=system_instruction,
        messages=[{"role": "user", "content": user_text}],
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
        api_key=api_key,
    )
    text = response_text(data)
    if not text:
        raise ClaudeError("empty completion")
    return text


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
    raise ClaudeError("could not parse JSON from model output")
