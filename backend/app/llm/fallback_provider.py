import logging
from typing import TypeVar

from pydantic import BaseModel

from app.llm.base import LLMProvider
from app.models.commands import InterviewTurnOutput

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger(__name__)


class FallbackProvider(LLMProvider):
    """Tries each provider in `providers`, in order; if one raises for ANY
    reason after exhausting its own internal retries (see e.g. each
    provider's own invalid-JSON retry loop — this only ever fires once
    THAT'S already given up), moves on to the next one instead of
    surfacing an error. Only raises once every provider in the chain has
    failed, and then it's the LAST one's real exception, not a generic
    wrapper — see llm/factory.py for the actual chain this project uses
    (Groq/Cerebras/OpenRouter/Mistral, in whatever order actually makes
    sense there) and why: a lower-TPM proven provider and a couple of
    higher-headroom newer ones are more resilient together than any one
    of them alone, without ever needing the caller to know which one
    actually served a given request."""

    def __init__(self, providers: list[LLMProvider]) -> None:
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")
        self._providers = providers
        # Whichever provider actually served the most recent call — what
        # `last_usage` reports, so interview.py's real-usage tracking
        # stays correct regardless of which one ran.
        self._active: LLMProvider = providers[0]

    @property
    def last_usage(self) -> dict[str, int] | None:
        return getattr(self._active, "last_usage", None)

    async def _with_fallback(self, method: str, *args, **kwargs):
        last_exc: Exception | None = None
        for provider in self._providers:
            try:
                result = await getattr(provider, method)(*args, **kwargs)
                self._active = provider
                return result
            except Exception as e:
                logger.warning("LLM provider %s failed on %s, trying the next one: %s", type(provider).__name__, method, e)
                last_exc = e
        assert last_exc is not None  # providers is never empty (checked in __init__)
        raise last_exc

    async def interview_turn(
        self,
        system_prompt: str,
        conversation: list[dict],
        retry_note: str | None = None,
    ) -> InterviewTurnOutput:
        return await self._with_fallback("interview_turn", system_prompt, conversation, retry_note=retry_note)

    async def structured_json(self, system_prompt: str, user_message: str, schema_model: type[T]) -> T:
        return await self._with_fallback("structured_json", system_prompt, user_message, schema_model)
