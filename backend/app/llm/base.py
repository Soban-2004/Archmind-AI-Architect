from abc import ABC, abstractmethod

from app.models.commands import InterviewTurnOutput


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
