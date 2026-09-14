"""Tests for FallbackProvider (see llm/factory.py's real chain — OpenRouter
/ Groq / Mistral, in that order). No real provider involved: fakes
standing in for each link in the chain, each independently configurable
to succeed or raise, so these run offline."""
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


async def test_empty_provider_list_is_rejected():
    with pytest.raises(ValueError):
        FallbackProvider([])


async def test_first_provider_success_never_touches_the_rest():
    first = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="Q?"), usage={"total_tokens": 5})
    second = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="should never see this"))
    third = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="should never see this either"))
    provider = FallbackProvider([first, second, third])

    result = await provider.interview_turn("sys", [])

    assert result.question == "Q?"
    assert first.calls == 1
    assert second.calls == 0
    assert third.calls == 0
    assert provider.last_usage == {"total_tokens": 5}


async def test_first_failure_falls_through_to_the_second():
    first = _FakeLLM(raises=RuntimeError("OpenRouter had a bad moment"))
    second = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="from Groq"), usage={"total_tokens": 9})
    third = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="should never see this"))
    provider = FallbackProvider([first, second, third])

    result = await provider.interview_turn("sys", [])

    assert result.question == "from Groq"
    assert first.calls == 1
    assert second.calls == 1
    assert third.calls == 0
    # last_usage reflects whichever provider actually served the call.
    assert provider.last_usage == {"total_tokens": 9}


async def test_first_two_failing_falls_through_to_the_third():
    first = _FakeLLM(raises=RuntimeError("OpenRouter down"))
    second = _FakeLLM(raises=RuntimeError("Groq also down"))
    third = _FakeLLM(response=InterviewTurnOutput(action="ask_question", question="from Mistral"), usage={"total_tokens": 3})
    provider = FallbackProvider([first, second, third])

    result = await provider.interview_turn("sys", [])

    assert result.question == "from Mistral"
    assert third.calls == 1
    assert provider.last_usage == {"total_tokens": 3}


async def test_every_provider_failing_propagates_the_last_ones_real_error():
    first = _FakeLLM(raises=RuntimeError("first down"))
    second = _FakeLLM(raises=RuntimeError("second down"))
    third = _FakeLLM(raises=RuntimeError("third also down"))
    provider = FallbackProvider([first, second, third])

    with pytest.raises(RuntimeError, match="third also down"):
        await provider.interview_turn("sys", [])


async def test_structured_json_falls_through_too():
    from app.models.advisory import AdvisoryAnswer

    first = _FakeLLM(raises=RuntimeError("down"))
    second = _FakeLLM(response=AdvisoryAnswer(answer="from the second provider"))
    provider = FallbackProvider([first, second])

    result = await provider.structured_json("sys", "msg", AdvisoryAnswer)

    assert result.answer == "from the second provider"
