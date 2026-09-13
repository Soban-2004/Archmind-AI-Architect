"""
Scoped web-search grounding — the advisory chat lane only (see
services/interview.py's _handle_advisory and intent_router.py's
needs_web_grounding). Deliberately NOT a general tool the LLM can invoke
whenever it decides to: a narrow, deterministic regex decides WHEN a
search happens — the same "no LLM classification call" discipline
intent_router.py already applies to advisory/analysis routing — rather
than a second LLM round-trip where the model chooses to call a tool. That
keeps this fast (one LLM call per turn, same as today), cheap, and
predictable: a visitor can't accidentally trigger an unbounded number of
real API calls just by phrasing a question a certain way to the model.

Tavily (docs.tavily.com), not a general-purpose search API — built for
exactly this "hand an LLM a few grounded, current results" use case, and
results come back already condensed rather than raw HTML to parse.

Fails soft everywhere: no API key configured, a network error, a
timeout, or a non-200 response all just return an empty list rather than
raising. An advisory answer with no web grounding is exactly today's
existing (already good) behavior — never worth breaking a whole chat turn
over a feature that's explicitly an enhancement, not load-bearing.
"""
from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.models.advisory import WebSource

logger = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"
SEARCH_TIMEOUT_SECONDS = 8.0
# Keeps the prompt's token cost small and bounded — same discipline as
# llm/prompts.py's MAX_FREE_TEXT_CHARS for free-text node fields.
MAX_SNIPPET_CHARS = 220


async def search_web(query: str, max_results: int = 3) -> list[WebSource]:
    """Returns up to `max_results` real, current results for `query`, or
    an empty list on any failure (including "no API key configured" —
    the common case for anyone who hasn't set TAVILY_API_KEY)."""
    if not settings.tavily_api_key:
        return []

    try:
        async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                TAVILY_URL,
                headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
                json={"query": query, "max_results": max_results, "search_depth": "basic"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.warning("web_search: Tavily request failed, continuing without grounding", exc_info=True)
        return []

    sources: list[WebSource] = []
    for item in (data.get("results") or [])[:max_results]:
        title = item.get("title")
        url = item.get("url")
        if not title or not url:
            continue  # a malformed result is skipped, not fabricated into something presentable
        content = item.get("content") or ""
        sources.append(WebSource(title=title, url=url, snippet=content[:MAX_SNIPPET_CHARS]))
    return sources
