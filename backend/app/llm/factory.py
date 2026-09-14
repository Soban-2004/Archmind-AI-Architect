from functools import lru_cache

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.groq_provider import GroqProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    # Cerebras primary (same gpt-oss-120b model as Groq, ~4x the free-tier
    # TPM ceiling — see config.py's cerebras_api_key comment), Groq as a
    # resilience fallback if Cerebras has a bad moment (see
    # FallbackProvider) — not a replacement, since Groq has actually
    # carried every real session this project has had before this.
    # Absent CEREBRAS_API_KEY, this degrades to exactly the old
    # Groq-only behavior, unchanged.
    if settings.cerebras_api_key:
        from app.llm.cerebras_provider import CerebrasProvider  # local import: only needed if the key is actually set
        from app.llm.fallback_provider import FallbackProvider

        return FallbackProvider(primary=CerebrasProvider(), secondary=GroqProvider())
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
