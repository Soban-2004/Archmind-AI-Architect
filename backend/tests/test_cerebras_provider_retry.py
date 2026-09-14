"""Same real bug GroqProvider's own retry test pins (see
test_groq_provider_retry.py's docstring), against Cerebras's SDK instead:
its json_object mode can also reject a malformed generation server-side
before any response body exists, raising cerebras' own APIStatusError one
layer above the json.loads/model_validate try/except. Cerebras's error
shape (status_code/body attributes, message text) mirrors Groq's closely
enough (confirmed by inspecting the actual installed SDK before writing
CerebrasProvider) that this is the same fix, same test shape, different
import."""
import httpx
import pytest
from cerebras.cloud.sdk import APIStatusError
from pydantic import BaseModel

from app.llm.cerebras_provider import CerebrasProvider


class _Echo(BaseModel):
    value: str


def _status_error(message: str) -> APIStatusError:
    request = httpx.Request("POST", "https://api.cerebras.ai/v1/chat/completions")
    response = httpx.Response(400, request=request)
    body = {"error": {"message": message, "type": "invalid_request_error", "code": "json_validate_failed"}}
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
    provider = CerebrasProvider.__new__(CerebrasProvider)
    provider.last_usage = None
    provider._client = _FakeClient([
        _status_error("Failed to generate JSON."),
        _ok_response('{"value": "recovered"}'),
    ])

    result = await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert result.value == "recovered"


@pytest.mark.asyncio
async def test_api_status_error_exhausting_retries_raises_runtime_error():
    provider = CerebrasProvider.__new__(CerebrasProvider)
    provider.last_usage = None
    provider._client = _FakeClient([
        _status_error("Failed to generate JSON."),
        _status_error("Failed to generate JSON."),
        _status_error("Failed to generate JSON."),
    ])

    with pytest.raises(RuntimeError, match="Failed to generate JSON"):
        await provider._json_completion([{"role": "system", "content": "x"}], _Echo)


@pytest.mark.asyncio
async def test_successful_call_records_real_usage():
    provider = CerebrasProvider.__new__(CerebrasProvider)
    provider.last_usage = None
    provider._client = _FakeClient([_ok_response('{"value": "ok"}')])

    result = await provider._json_completion([{"role": "system", "content": "x"}], _Echo)

    assert result.value == "ok"
    assert provider.last_usage == {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
