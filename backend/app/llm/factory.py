from functools import lru_cache

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.groq_provider import GroqProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    # The chain, in the order requests actually try them — OpenRouter
    # first, not Groq: `:free`-suffixed OpenRouter models (see config.py's
    # openrouter_model comment for why the default isn't gpt-oss-120b)
    # have NO token-per-minute ceiling at all, just a request-rate limit,
    # which is a more direct fix for "one request's prompt+state is too
    # big" than any finite TPM number — Groq's 8,000 included. Groq stays
    # in the chain as the proven,
    # battle-tested fallback (every real session before this one ran on
    # it alone), and Mistral last — a real third safety net (1B tokens/
    # month free) but only 1 request/second, not somewhere real traffic
    # should normally land.
    #
    # Cerebras (llm/cerebras_provider.py — fully built and tested) is
    # deliberately NOT in this chain right now: its free trial now
    # requires a verified payment method (confirmed live, a real 402 from
    # this project's own Cerebras account), so it's parked, not removed —
    # add CerebrasProvider() back into the list below once that's
    # resolved, one line.
    #
    # Each of OpenRouter/Mistral is optional and additive: absent its key,
    # it's simply skipped, same fallback philosophy as Cerebras/Gemini/
    # Tavily already use elsewhere in this file/config.py. Groq alone
    # (GROQ_API_KEY) is the one hard requirement, unchanged from before
    # any of this existed.
    providers: list[LLMProvider] = []
    if settings.openrouter_api_key:
        from app.llm.openrouter_provider import OpenRouterProvider  # local import: only needed if the key is actually set

        providers.append(OpenRouterProvider())
    providers.append(GroqProvider())
    if settings.mistral_api_key:
        from app.llm.mistral_provider import MistralProvider  # local import: only needed if the key is actually set

        providers.append(MistralProvider())

    if len(providers) == 1:
        return providers[0]
    from app.llm.fallback_provider import FallbackProvider

    return FallbackProvider(providers)


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
