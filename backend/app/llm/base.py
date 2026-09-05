from abc import ABC, abstractmethod
from typing import TypeVar

from pydantic import BaseModel

from app.models.commands import InterviewTurnOutput

T = TypeVar("T", bound=BaseModel)


class LLMProvider(ABC):
    """Swappable behind one interface (spec improvement #6 — provider
    abstraction) so switching Groq <-> Gemini <-> anything else is a config
    change, not a rewrite."""

    @abstractmethod
    async def interview_turn(
        self,
        system_prompt: str,
        conversation: list[dict],
        retry_note: str | None = None,
    ) -> InterviewTurnOutput:
        """Return exactly one structured InterviewTurnOutput. Raises on
        total failure (caller decides how many retries to allow)."""
        ...

    @abstractmethod
    async def structured_json(self, system_prompt: str, user_message: str, schema_model: type[T]) -> T:
        """General-purpose one-shot structured call for anything that isn't
        the interview loop (e.g. diff explanations)."""
        ...
