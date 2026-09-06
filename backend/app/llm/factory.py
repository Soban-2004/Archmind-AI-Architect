from functools import lru_cache

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.groq_provider import GroqProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    # Only Groq is wired up today; swapping providers (e.g. Gemini) means
    # adding a class implementing LLMProvider and changing this one line.
    return GroqProvider()


@lru_cache
def get_judge_provider() -> LLMProvider | None:
    """A second, independent model that reviews the architect's proposed
    architecture for structural correctness (services/interview.py) —
    deliberately a different provider than get_llm_provider() so it isn't
    subject to the same blind spots or the same per-provider rate limit.
    Returns None (judge pass skipped, architect's output used as-is) when
    GEMINI_API_KEY isn't configured — optional, not a hard dependency."""
    if not settings.gemini_api_key:
        return None
    from app.llm.gemini_provider import GeminiProvider  # local import: only needed if the key is actually set

    return GeminiProvider()
