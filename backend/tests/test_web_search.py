"""
Tests for services/web_search.py's search_web — the fail-soft-everywhere
contract (no API key, a network error, a malformed response) is the part
actually worth testing; the real Tavily call itself is never exercised
here (no network in tests, matching every other LLM-provider test in this
suite).
"""
from __future__ import annotations

import httpx
import pytest

from app.services import web_search


async def test_no_api_key_returns_empty_list_without_a_network_call(monkeypatch):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "")

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("should not attempt a request with no API key configured")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail_if_called)
    assert await web_search.search_web("current Redis pricing") == []


async def test_network_failure_fails_soft_to_empty_list(monkeypatch):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "fake-key-for-test")

    async def raise_timeout(*args, **kwargs):
        raise httpx.ConnectTimeout("simulated timeout")

    monkeypatch.setattr(httpx.AsyncClient, "post", raise_timeout)
    assert await web_search.search_web("current Redis pricing") == []


async def test_real_results_are_parsed_and_truncated(monkeypatch):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "fake-key-for-test")

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "results": [
                    {"title": "Redis Cloud Pricing", "url": "https://redis.io/pricing", "content": "x" * 500},
                    {"title": "Missing URL", "content": "should be skipped"},  # no url -> skipped, not fabricated
                    {"url": "https://example.com", "content": "no title either -> skipped"},
                ]
            }

    async def fake_post(self, *args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    results = await web_search.search_web("current Redis pricing", max_results=3)

    assert len(results) == 1
    assert results[0].title == "Redis Cloud Pricing"
    assert results[0].url == "https://redis.io/pricing"
    assert len(results[0].snippet) == web_search.MAX_SNIPPET_CHARS


async def test_non_200_response_fails_soft(monkeypatch):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "fake-key-for-test")

    class FakeResponse:
        def raise_for_status(self):
            raise httpx.HTTPStatusError("401", request=None, response=None)

    async def fake_post(self, *args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    assert await web_search.search_web("current Redis pricing") == []
