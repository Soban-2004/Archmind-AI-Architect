import logging
from typing import TypeVar

from pydantic import BaseModel

from app.llm.base import LLMProvider
from app.models.commands import InterviewTurnOutput

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger(__name__)


class FallbackProvider(LLMProvider):
    """Tries `primary` first; if it raises for ANY reason after exhausting
    its own internal retries (see e.g. CerebrasProvider/GroqProvider's own
    invalid-JSON retry loop — this only ever fires once THAT'S already
    given up), retries the exact same call against `secondary` instead of
    surfacing an error. Built for Cerebras-primary/Groq-secondary
    specifically (see llm/factory.py) — Cerebras's free trial gives a real
    ~4x higher TPM ceiling than Groq's for the same model, but it's a
    newer, less battle-tested part of this stack than Groq (which has
    carried every real session before this), so this is deliberately
    resilience, not a blind swap: if Cerebras has a bad moment, the
    request still succeeds instead of failing outright."""

    def __init__(self, primary: LLMProvider, secondary: LLMProvider) -> None:
        self._primary = primary
        self._secondary = secondary
        # Whichever provider actually served the most recent call — what
        # `last_usage` reports, so interview.py's real-usage tracking
        # stays correct regardless of which one ran.
        self._active: LLMProvider = primary

    @property
    def last_usage(self) -> dict[str, int] | None:
        return getattr(self._active, "last_usage", None)

    async def _with_fallback(self, method: str, *args, **kwargs):
        try:
            result = await getattr(self._primary, method)(*args, **kwargs)
            self._active = self._primary
            return result
        except Exception as e:
            logger.warning("primary LLM provider (%s) failed on %s, falling back: %s", type(self._primary).__name__, method, e)
            result = await getattr(self._secondary, method)(*args, **kwargs)
            self._active = self._secondary
            return result

    async def interview_turn(
        self,
        system_prompt: str,
        conversation: list[dict],
        retry_note: str | None = None,
    ) -> InterviewTurnOutput:
        return await self._with_fallback("interview_turn", system_prompt, conversation, retry_note=retry_note)

    async def structured_json(self, system_prompt: str, user_message: str, schema_model: type[T]) -> T:
        return await self._with_fallback("structured_json", system_prompt, user_message, schema_model)
