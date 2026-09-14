"""Tests for FallbackProvider (Cerebras primary / Groq secondary — see
llm/factory.py). No real provider involved: two fakes standing in for
"primary" and "secondary", each independently configurable to succeed or
raise, so these run offline."""
import pytest

from app.llm.fallback_provider import FallbackProvider
from app.models.commands import InterviewTurnOutput


class _FakeLLM:
    def __init__(self, *, raises: Exception | None = None, response: InterviewTurnOutput | None = None, usage: dict | None = None):
        self._raises = raises
        self._response = response
        self.last_usage = usage
        self.calls = 0

    async def interview_turn(self, system_prompt, conversation, retry_note=None):
        self.calls += 1
        if self._raises:
            raise self._raises
        return self._response

    async def structured_json(self, system_prompt, user_message, schema_model):
        self.calls += 1
        if self._raises:
            raise self._raises
        return self._response


async def test_primary_success_never_touches_secondary():
    primary = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="Q?"), usage={"total_tokens": 5})
    secondary = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="should never see this"))
    provider = FallbackProvider(primary=primary, secondary=secondary)

    result = await provider.interview_turn("sys", [])

    assert result.question == "Q?"
    assert primary.calls == 1
    assert secondary.calls == 0
    assert provider.last_usage == {"total_tokens": 5}


async def test_primary_failure_falls_back_to_secondary():
    primary = _FakeLLM(raises=RuntimeError("Cerebras had a bad moment"))
    secondary = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="from Groq"), usage={"total_tokens": 9})
    provider = FallbackProvider(primary=primary, secondary=secondary)

    result = await provider.interview_turn("sys", [])

    assert result.question == "from Groq"
    assert primary.calls == 1
    assert secondary.calls == 1
    # last_usage reflects whichever provider actually served the call.
    assert provider.last_usage == {"total_tokens": 9}


async def test_both_failing_lets_the_secondarys_exception_propagate():
    primary = _FakeLLM(raises=RuntimeError("primary down"))
    secondary = _FakeLLM(raises=RuntimeError("secondary also down"))
    provider = FallbackProvider(primary=primary, secondary=secondary)

    with pytest.raises(RuntimeError, match="secondary also down"):
        await provider.interview_turn("sys", [])


async def test_structured_json_falls_back_too():
    from app.models.advisory import AdvisoryAnswer

    primary = _FakeLLM(raises=RuntimeError("down"))
    secondary = _FakeLLM(response=AdvisoryAnswer(answer="from secondary"))
    provider = FallbackProvider(primary=primary, secondary=secondary)

    result = await provider.structured_json("sys", "msg", AdvisoryAnswer)

    assert result.answer == "from secondary"
