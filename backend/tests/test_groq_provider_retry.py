"""Real bug, found live in production: Groq's own server-side json_object
validator can reject a malformed generation (json_validate_failed) before
we ever see a response body at all — that raises groq.APIStatusError
straight out of `.create()`, one layer above the json.loads/model_validate
try/except _json_completion already had. Unhandled, that crashed the whole
chat turn with a raw 400 instead of retrying like every other malformed-
JSON case. These tests pin the fix: the same retry path now catches it too.
"""
import httpx
import pytest
from groq import APIStatusError
from pydantic import BaseModel

from app.llm.groq_provider import GroqProvider


class _Echo(BaseModel):
    value: str


def _status_error(message: str, failed_generation: str = "") -> APIStatusError:
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    response = httpx.Response(400, request=request)
    body = {"error": {"message": message, "type": "invalid_request_error", "code": "json_validate_failed", "failed_generation": failed_generation}}
    return APIStatusError(message, response=response, body=body)


class _FakeCompletions:
    def __init__(self, effects: list) -> None:
        self._effects = list(effects)

    async def create(self, **_kwargs):
        effect = self._effects.pop(0)
        if isinstance(effect, Exception):
            raise effect
        return effect


class _FakeChat:
    def __init__(self, effects: list) -> None:
        self.completions = _FakeCompletions(effects)


class _FakeClient:
    def __init__(self, effects: list) -> None:
        self.chat = _FakeChat(effects)


def _ok_response(content: str):
    class _Usage:
        prompt_tokens = 10
        completion_tokens = 5
        total_tokens = 15

    class _Message:
        pass

    class _Choice:
        pass

    class _Resp:
        pass

    resp = _Resp()
    resp.usage = _Usage()
    choice = _Choice()
    message = _Message()
    message.content = content
    choice.message = message
    resp.choices = [choice]
    return resp


@pytest.mark.asyncio
async def test_api_status_error_is_retried_not_raised(monkeypatch):
    provider = GroqProvider.__new__(GroqProvider)
    provider.last_usage = None
    provider._client = _FakeClient([
        _status_error("Failed to generate JSON.", failed_generation="not json at all"),
        _ok_response('{"value": "recovered"}'),
    ])

    result = await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert result.value == "recovered"


@pytest.mark.asyncio
async def test_api_status_error_exhausting_retries_raises_runtime_error():
    provider = GroqProvider.__new__(GroqProvider)
    provider.last_usage = None
    provider._client = _FakeClient([
        _status_error("Failed to generate JSON."),
        _status_error("Failed to generate JSON."),
        _status_error("Failed to generate JSON."),
    ])

    with pytest.raises(RuntimeError, match="Failed to generate JSON"):
        await provider._json_completion([{"role": "system", "content": "x"}], _Echo)
