"""The one LLM client every AI step uses (stdlib HTTP), on OpenAI or Anthropic.

Email drafting, company research, contact extraction, inbox triage, the Jev
decision layer and the show research pass all call ``create_message`` /
``generate_text`` here, so the provider, key, model and retry policy live in
one place.

Callers speak ONE dialect: Anthropic Messages. They build Anthropic-format
``messages`` and ``tools`` and read an Anthropic-shaped response
(``content`` blocks ``text`` / ``tool_use``, ``stop_reason``, ``usage``). On the
OpenAI provider the request is translated to the Responses API and the
response translated back, so switching provider is one setting, not a code
change.

Provider: ``AI_PROVIDER`` ("openai" | "anthropic"; dashboard setting, then
env). Unset, it is "anthropic" when an Anthropic key exists, else "openai".
Keys: ``ANTHROPIC_API_KEY`` / ``OPENAI_API_KEY`` (dashboard Keys tab, then env).
Models: ``ANTHROPIC_MODEL`` (default ``claude-haiku-5-5``) / ``OPENAI_MODEL``
(default ``gpt-5.4-mini``). Neither model takes ``temperature``, so there is
no such parameter.
"""

from __future__ import annotations

import json
import os
import ssl
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5"
OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_DEFAULT_MODEL = "gpt-5.4-mini"
#: Server-side web search tool type (Anthropic name). On OpenAI it becomes
#: the built-in ``web_search`` tool. Billed per search on both.
WEB_SEARCH_TOOL = "web_search_20260209"

_RETRY_HTTP = (429, 500, 502, 503, 504, 529)


class LLMError(RuntimeError):
    pass


def _setting(key: str) -> str:
    """Dashboard setting first, then env (``get_setting`` does DB -> env)."""
    try:
        from outreach.app_settings import get_setting

        v = str(get_setting(key) or "").strip()
        if v:
            return v
    except Exception:  # noqa: BLE001 — settings unreadable: fall back to env
        pass
    return (os.getenv(key) or "").strip()


def llm_provider() -> str:
    """ "openai" | "anthropic"."""
    p = _setting("AI_PROVIDER").lower()
    if p in ("openai", "anthropic"):
        return p
    if _setting("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "openai"


def _api_key(provider: str) -> str:
    return _setting("OPENAI_API_KEY" if provider == "openai" else "ANTHROPIC_API_KEY")


def llm_enabled() -> bool:
    return bool(_api_key(llm_provider()))


def llm_model() -> str:
    if llm_provider() == "openai":
        return _setting("OPENAI_MODEL") or OPENAI_DEFAULT_MODEL
    return _setting("ANTHROPIC_MODEL") or ANTHROPIC_DEFAULT_MODEL


def _post(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    """POST JSON; retries 429/5xx/529 and network errors three times with backoff."""
    body = json.dumps(payload).encode("utf-8")
    ctx = ssl.create_default_context()
    last: LLMError | None = None
    for attempt in range(4):
        req = Request(url, data=body, method="POST", headers={**headers, "content-type": "application/json"})
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:400] if e.fp else ""
            last = LLMError(f"HTTP {e.code}: {detail}")
            if e.code in _RETRY_HTTP and attempt < 3:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise last from e
        except (URLError, OSError, TimeoutError, json.JSONDecodeError) as e:
            last = LLMError(f"{type(e).__name__}: {e}")
            if attempt < 3:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise last from e
    raise last or LLMError("unknown error")


# --------------------------------------------------------------- anthropic --
def _anthropic_payload(
    system: str, messages: list[dict[str, Any]], model: str, max_tokens: int,
    tools: list[dict[str, Any]] | None, tool_choice: dict[str, Any] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
    if tool_choice:
        payload["tool_choice"] = tool_choice
    return payload


# ------------------------------------------------------------------ openai --
def _openai_tools(tools: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int | None]:
    """Anthropic tools -> Responses tools, plus the web-search ``max_uses`` cap."""
    out: list[dict[str, Any]] = []
    max_uses: int | None = None
    for t in tools:
        if t.get("type") == WEB_SEARCH_TOOL:
            out.append({"type": "web_search"})
            if t.get("max_uses"):
                max_uses = int(t["max_uses"])
        else:
            out.append({
                "type": "function",
                "name": t["name"],
                "description": t.get("description") or "",
                "parameters": t.get("input_schema") or {"type": "object", "properties": {}},
                # Non-strict: strict mode demands additionalProperties=false and
                # every property required, which the callers' schemas do not promise.
                "strict": False,
            })
    return out, max_uses


def _openai_tool_choice(choice: dict[str, Any]) -> Any:
    kind = choice.get("type")
    if kind == "tool":
        return {"type": "function", "name": choice["name"]}
    if kind == "any":
        return "required"
    if kind == "none":
        return "none"
    return "auto"


def _openai_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Anthropic messages -> Responses input items."""
    items: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role") or "user"
        text_type = "output_text" if role == "assistant" else "input_text"
        content = m.get("content")
        if isinstance(content, str):
            items.append({"role": role, "content": [{"type": text_type, "text": content}]})
            continue
        texts: list[dict[str, Any]] = []

        def flush() -> None:
            if texts:
                items.append({"role": role, "content": list(texts)})
                texts.clear()

        for b in content or []:
            kind = b.get("type")
            if kind == "text":
                if b.get("text"):
                    texts.append({"type": text_type, "text": b["text"]})
            elif kind == "tool_use":
                flush()
                items.append({
                    "type": "function_call",
                    "call_id": b.get("id") or "",
                    "name": b.get("name") or "",
                    "arguments": json.dumps(b.get("input") or {}),
                })
            elif kind == "tool_result":
                flush()
                out = b.get("content")
                if isinstance(out, list):
                    out = "".join(x.get("text", "") for x in out if isinstance(x, dict))
                items.append({"type": "function_call_output", "call_id": b.get("tool_use_id") or "",
                              "output": str(out or "")})
            # Anthropic server-tool blocks (server_tool_use / web_search_tool_result)
            # have no OpenAI equivalent to replay; the text around them carries the facts.
        flush()
    return items


def _openai_payload(
    system: str, messages: list[dict[str, Any]], model: str, max_tokens: int,
    tools: list[dict[str, Any]] | None, tool_choice: dict[str, Any] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "instructions": system,
        "input": _openai_input(messages),
        # Reasoning tokens count against max_output_tokens, so leave headroom.
        "max_output_tokens": max(2048, max_tokens * 2),
        "reasoning": {"effort": "low"},
        "store": False,
    }
    if tools:
        payload["tools"], max_uses = _openai_tools(tools)
        if max_uses:
            payload["max_tool_calls"] = max_uses + 1  # + the function call that records the answer
    if tool_choice:
        payload["tool_choice"] = _openai_tool_choice(tool_choice)
    return payload


def _from_openai(data: dict[str, Any]) -> dict[str, Any]:
    """Responses API result -> Anthropic-shaped response."""
    content: list[dict[str, Any]] = []
    searches = 0
    for item in data.get("output") or []:
        kind = item.get("type")
        if kind == "message":
            for c in item.get("content") or []:
                if c.get("type") == "output_text" and c.get("text"):
                    content.append({"type": "text", "text": c["text"]})
                elif c.get("type") == "refusal":
                    content.append({"type": "text", "text": c.get("refusal") or ""})
        elif kind == "function_call":
            try:
                args = json.loads(item.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            content.append({"type": "tool_use", "id": item.get("call_id") or item.get("id") or "",
                            "name": item.get("name") or "", "input": args})
        elif kind == "web_search_call":
            action = item.get("action") or {}
            if not action or action.get("type") == "search":
                searches += 1
    if any(b["type"] == "tool_use" for b in content):
        stop = "tool_use"
    elif data.get("status") == "incomplete" and (data.get("incomplete_details") or {}).get("reason") == "max_output_tokens":
        stop = "max_tokens"
    else:
        stop = "end_turn"
    u = data.get("usage") or {}
    cached = int((u.get("input_tokens_details") or {}).get("cached_tokens") or 0)
    return {
        "model": data.get("model") or "",
        "content": content,
        "stop_reason": stop,
        "usage": {
            # Anthropic semantics: input_tokens excludes cache reads.
            "input_tokens": int(u.get("input_tokens") or 0) - cached,
            "output_tokens": int(u.get("output_tokens") or 0),
            "cache_read_input_tokens": cached,
            "server_tool_use": {"web_search_requests": searches},
        },
    }


# -------------------------------------------------------------------- api ---
def build_request(
    *,
    system: str,
    messages: list[dict[str, Any]],
    model: str = "",
    max_tokens: int = 2048,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | None = None,
) -> tuple[str, str, dict[str, Any]]:
    """(provider, url, payload) for one call, without sending it."""
    provider = llm_provider()
    mdl = (model or llm_model()).strip()
    if provider == "openai":
        return provider, OPENAI_URL, _openai_payload(system, messages, mdl, max_tokens, tools, tool_choice)
    return provider, ANTHROPIC_URL, _anthropic_payload(system, messages, mdl, max_tokens, tools, tool_choice)


def create_message(
    *,
    system: str,
    messages: list[dict[str, Any]],
    model: str = "",
    max_tokens: int = 2048,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    """One model call -> an Anthropic-shaped response dict. Raises LLMError."""
    provider, url, payload = build_request(
        system=system, messages=messages, model=model, max_tokens=max_tokens,
        tools=tools, tool_choice=tool_choice,
    )
    key = _api_key(provider)
    if not key:
        raise LLMError(f"{'OPENAI' if provider == 'openai' else 'ANTHROPIC'}_API_KEY not set")
    if provider == "openai":
        data = _post(url, {"authorization": f"Bearer {key}"}, payload, timeout)
        if data.get("error"):
            raise LLMError(f"OpenAI error: {str(data['error'])[:400]}")
        return _from_openai(data)
    return _post(url, {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}, payload, timeout)


def response_text(data: dict[str, Any]) -> str:
    return "".join(
        b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text"
    ).strip()


def generate_text(
    *,
    system_instruction: str,
    user_text: str,
    model: str = "",
    max_tokens: int = 2048,
    timeout: float = 120.0,
) -> str:
    """System + one user turn -> the assistant's text. Raises LLMError."""
    data = create_message(
        system=system_instruction,
        messages=[{"role": "user", "content": user_text}],
        model=model,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    text = response_text(data)
    if not text:
        raise LLMError(f"empty completion (stop_reason={data.get('stop_reason')})")
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
    raise LLMError("could not parse JSON from model output")
