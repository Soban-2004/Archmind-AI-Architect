"""Shared REST plumbing for OpenAI-compatible chat-completions endpoints
that don't ship their own Python SDK the way Groq/Cerebras do (OpenRouter,
Mistral both just expose a plain OpenAI-shaped REST API) — one place for
the actual HTTP call and error handling instead of duplicating it in each
provider. Uses httpx (already a dependency — see services/web_search.py)
rather than pulling in a third SDK just for this.
"""
from __future__ import annotations

import httpx


class RestAPIError(RuntimeError):
    """Raised for a non-2xx response — carries `status_code`/`body` the
    same way groq/cerebras' own SDK exceptions do (see their APIStatusError),
    so services/interview.py's _friendly_provider_error recognizes a rate
    limit the identical way regardless of which provider actually failed."""

    def __init__(self, message: str, status_code: int, body: object | None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


async def post_chat_completion(base_url: str, api_key: str, model: str, messages: list[dict], timeout: float = 60.0) -> dict:
    """POST .../chat/completions, JSON mode on, and return the parsed
    response body. Raises RestAPIError on any non-2xx status — deliberately
    NOT retried in here (a REST 4xx/5xx isn't fixed by resending the same
    request with a "fix your JSON" note the way a malformed-JSON *content*
    is — see each provider's own _json_completion for that retry, which
    this is a layer below). Left to propagate immediately so
    FallbackProvider can move on to the next provider in the chain."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "response_format": {"type": "json_object"}, "temperature": 0.3},
        )

    if resp.status_code >= 400:
        try:
            body = resp.json()
        except Exception:
            body = None
        message = f"HTTP {resp.status_code}"
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and error.get("message"):
                message = error["message"]
            elif isinstance(error, str):
                message = error
        raise RestAPIError(message, status_code=resp.status_code, body=body)

    return resp.json()
