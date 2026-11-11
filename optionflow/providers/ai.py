"""optionflow/providers/ai.py — chat completion from Gemini or OpenAI, streamed as text.

Order (same as the old Next.js route):
  1. Gemini, trying GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 in turn
     when a key is over quota (free tier).
  2. OpenAI (OPENAI_API_KEY) if no Gemini key works.
Plain HTTPS through httpx; no vendor SDKs. Tests inject an httpx transport.
"""
from __future__ import annotations

import json
import logging
from typing import Iterator, List, Optional

import httpx

from optionflow.core import errors
from optionflow.core.settings import get_settings

logger = logging.getLogger("optionflow.ai")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

_transport: Optional[httpx.BaseTransport] = None   # tests only


def use_transport(transport: Optional[httpx.BaseTransport]) -> None:
    global _transport
    _transport = transport


def _client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=httpx.Timeout(60.0, connect=10.0))


class _Quota(Exception):
    pass


def _gemini(key: str, model: str, system: str, messages: List[dict]) -> Iterator[str]:
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                     for m in messages],
    }
    client = _client()
    req = client.build_request("POST", GEMINI_URL.format(model=model), params={"alt": "sse", "key": key}, json=body)
    resp = client.send(req, stream=True)
    if resp.status_code == 429:
        resp.close(); client.close()
        raise _Quota()
    if resp.status_code >= 400:
        detail = resp.read().decode(errors="replace")[:300]
        resp.close(); client.close()
        raise RuntimeError(f"Gemini error {resp.status_code}: {detail}")

    def _stream() -> Iterator[str]:
        try:
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = json.loads(line[5:].strip() or "{}")
                for cand in chunk.get("candidates", []):
                    for part in cand.get("content", {}).get("parts", []):
                        if part.get("text"):
                            yield part["text"]
        finally:
            resp.close(); client.close()
    return _stream()


def _openai(key: str, model: str, system: str, messages: List[dict]) -> Iterator[str]:
    body = {"model": model, "stream": True, "max_tokens": 1024,
            "messages": [{"role": "system", "content": system}, *messages]}
    client = _client()
    req = client.build_request("POST", OPENAI_URL, headers={"Authorization": f"Bearer {key}"}, json=body)
    resp = client.send(req, stream=True)
    if resp.status_code >= 400:
        try:
            err = json.loads(resp.read()).get("error", {})
        except Exception:
            err = {}
        resp.close(); client.close()
        code = err.get("code", "")
        if code == "insufficient_quota":
            raise errors.RateLimited("OpenAI quota exceeded — add billing at platform.openai.com/settings/billing")
        if code == "invalid_api_key":
            raise errors.ServerError("Invalid OpenAI API key — check OPENAI_API_KEY")
        raise errors.ServerError(f"OpenAI error: {err.get('message', resp.status_code)}")

    def _stream() -> Iterator[str]:
        try:
            for line in resp.iter_lines():
                if not line.startswith("data:") or line.strip() == "data: [DONE]":
                    continue
                delta = json.loads(line[5:].strip()).get("choices", [{}])[0].get("delta", {})
                if delta.get("content"):
                    yield delta["content"]
        finally:
            resp.close(); client.close()
    return _stream()


def chat_stream(system: str, messages: List[dict]) -> Iterator[str]:
    """Start a streamed reply. Raises an AppError (before streaming) if no model can answer."""
    s = get_settings()
    gemini_keys = [k for k in (s.gemini_api_key, s.gemini_api_key_2, s.gemini_api_key_3) if k]
    if not gemini_keys and not s.openai_api_key:
        raise errors.Unavailable("No AI key configured. Set GEMINI_API_KEY (free tier) or OPENAI_API_KEY.")
    for i, key in enumerate(gemini_keys):
        try:
            return _gemini(key, s.gemini_model, system, messages)
        except _Quota:
            logger.warning("Gemini key %d/%d over quota, trying the next", i + 1, len(gemini_keys))
        except Exception as exc:
            logger.error("Gemini error: %s", exc)
            if not s.openai_api_key:
                raise errors.ServerError(f"Gemini error: {exc}")
            break
    if not s.openai_api_key:
        raise errors.RateLimited("AI quota exceeded on all keys. Resets at midnight PT.")
    return _openai(s.openai_api_key, s.openai_model, system, messages)
