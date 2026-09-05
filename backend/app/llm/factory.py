from functools import lru_cache

from app.llm.base import LLMProvider
from app.llm.groq_provider import GroqProvider


@lru_cache
def get_llm_provider() -> LLMProvider:
    # Only Groq is wired up today; swapping providers (e.g. Gemini) means
    # adding a class implementing LLMProvider and changing this one line.
    return GroqProvider()
