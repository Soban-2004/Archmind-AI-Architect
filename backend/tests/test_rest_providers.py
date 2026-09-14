"""Tests for OpenRouterProvider/MistralProvider (plain httpx REST calls to
an OpenAI-compatible chat-completions endpoint, no dedicated SDK — see
llm/rest_client.py) and rest_client.py's own error shaping. Mocks
post_chat_completion directly (patched on each provider module, where the
name is actually bound after import, not on rest_client itself) so these
run offline, no real HTTP."""
import httpx
import pytest
from pydantic import BaseModel

from app.llm import mistral_provider, openrouter_provider
from app.llm.mistral_provider import MistralProvider
from app.llm.openrouter_provider import OpenRouterProvider
from app.llm.rest_client import RestAPIError, post_chat_completion


class _Echo(BaseModel):
    value: str


def _ok_data(content: str) -> dict:
    return {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


@pytest.mark.parametrize("provider_cls,module", [(OpenRouterProvider, openrouter_provider), (MistralProvider, mistral_provider)])
async def test_successful_call_records_real_usage(monkeypatch, provider_cls, module):
    async def fake_post(base_url, api_key, model, messages, timeout=60.0):
        return _ok_data('{"value": "ok"}')

    monkeypatch.setattr(module, "post_chat_completion", fake_post)
    provider = provider_cls()

    result = await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert result.value == "ok"
    assert provider.last_usage == {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}


@pytest.mark.parametrize("provider_cls,module", [(OpenRouterProvider, openrouter_provider), (MistralProvider, mistral_provider)])
async def test_malformed_json_content_is_retried(monkeypatch, provider_cls, module):
    calls = {"n": 0}

    async def fake_post(base_url, api_key, model, messages, timeout=60.0):
        calls["n"] += 1
        if calls["n"] == 1:
            return _ok_data("not valid json at all")
        return _ok_data('{"value": "recovered"}')

    monkeypatch.setattr(module, "post_chat_completion", fake_post)
    provider = provider_cls()

    result = await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert result.value == "recovered"
    assert calls["n"] == 2


@pytest.mark.parametrize("provider_cls,module", [(OpenRouterProvider, openrouter_provider), (MistralProvider, mistral_provider)])
async def test_rest_api_error_is_not_retried_in_place(monkeypatch, provider_cls, module):
    """A REST-level failure (rate limit, auth, server error) is NOT
    retried by the provider itself — resending with a "fix your JSON"
    note doesn't fix a 429, it just wastes an attempt. It should
    propagate immediately so FallbackProvider can move on to the next
    provider in the chain instead."""
    calls = {"n": 0}

    async def fake_post(base_url, api_key, model, messages, timeout=60.0):
        calls["n"] += 1
        raise RestAPIError("rate limited", status_code=429, body={"error": {"message": "rate limited", "code": "rate_limit_exceeded"}})

    monkeypatch.setattr(module, "post_chat_completion", fake_post)
    provider = provider_cls()

    with pytest.raises(RestAPIError):
        await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert calls["n"] == 1  # exactly one attempt, no in-place retry


async def test_rest_client_shapes_a_non_2xx_response_into_rest_api_error(monkeypatch):
    async def fake_post(self, url, headers=None, json=None):
        request = httpx.Request("POST", url)
        return httpx.Response(429, request=request, json={"error": {"message": "rate limited", "code": "rate_limit_exceeded"}})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(RestAPIError) as exc_info:
        await post_chat_completion("https://example.test/v1", "key", "some-model", [{"role": "user", "content": "hi"}])

    assert exc_info.value.status_code == 429
    assert exc_info.value.body["error"]["code"] == "rate_limit_exceeded"
    assert "rate limited" in str(exc_info.value)
