"""
Tests for the GitHub-URL import route (POST /ingest/github). Same
philosophy as test_ingestion.py's own docstring: services/ingestion.py's
LLM-reconstruction step is never unit-tested here, only exercised live
against a real repo — so these tests isolate exactly the NEW logic this
route adds (URL parsing, resolving the default branch, fetching and
size-capping the archive) by monkeypatching `_process_zip_bytes` to a
stand-in that just records what it was called with, and calling the
route's plain function directly via `.__wrapped__` (slowapi preserves
it) rather than through real HTTP — the decorator's own request/response
plumbing is already covered by test_rate_limit.py, and isn't what's
under test here.
"""
from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.api.routes import ingestion


# --- parse_github_url ------------------------------------------------------

def test_parse_github_url_plain():
    assert ingestion.parse_github_url("https://github.com/Soban-2004/Stock-Hinge-app") == ("Soban-2004", "Stock-Hinge-app", None)


def test_parse_github_url_no_scheme():
    assert ingestion.parse_github_url("github.com/owner/repo") == ("owner", "repo", None)


def test_parse_github_url_with_git_suffix():
    assert ingestion.parse_github_url("https://github.com/owner/repo.git") == ("owner", "repo", None)


def test_parse_github_url_with_ref():
    assert ingestion.parse_github_url("https://github.com/owner/repo/tree/develop") == ("owner", "repo", "develop")


def test_parse_github_url_shorthand():
    assert ingestion.parse_github_url("owner/repo") == ("owner", "repo", None)


def test_parse_github_url_trailing_slash():
    assert ingestion.parse_github_url("https://github.com/owner/repo/") == ("owner", "repo", None)


def test_parse_github_url_rejects_garbage():
    with pytest.raises(ValueError):
        ingestion.parse_github_url("not a url at all")


def test_parse_github_url_rejects_non_github_host():
    with pytest.raises(ValueError):
        ingestion.parse_github_url("https://gitlab.com/owner/repo")


# --- ingest_from_github (route logic, LLM step stubbed out) ----------------

class _FakeStreamResponse:
    def __init__(self, chunks: list[bytes], status_code: int = 200):
        self._chunks = chunks
        self.status_code = status_code

    async def aiter_bytes(self):
        for c in self._chunks:
            yield c

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


async def test_resolves_default_branch_and_fetches_the_right_archive_url(monkeypatch):
    calls: dict = {}

    class FakeApiResponse:
        status_code = 200

        def json(self):
            return {"default_branch": "master"}

    async def fake_get(self, url, **kwargs):
        calls["api_url"] = url
        return FakeApiResponse()

    def fake_stream(self, method, url, **kwargs):
        calls["archive_url"] = url
        return _FakeStreamResponse([b"fake-zip-bytes"])

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(httpx.AsyncClient, "stream", fake_stream)

    async def fake_process(raw, name):
        calls["raw"] = raw
        calls["name"] = name
        return {"ok": True, "fake": True}

    monkeypatch.setattr(ingestion, "_process_zip_bytes", fake_process)

    result = await ingestion.ingest_from_github.__wrapped__(
        request=None,
        response=None,
        body=ingestion.GithubImportRequest(url="https://github.com/Soban-2004/Stock-Hinge-app", name="Stock Hinge"),
    )

    assert result == {"ok": True, "fake": True}
    assert calls["api_url"] == "https://api.github.com/repos/Soban-2004/Stock-Hinge-app"
    assert calls["archive_url"] == "https://github.com/Soban-2004/Stock-Hinge-app/archive/master.zip"
    assert calls["raw"] == b"fake-zip-bytes"
    assert calls["name"] == "Stock Hinge"


async def test_explicit_ref_in_the_url_skips_the_api_lookup(monkeypatch):
    async def fail_if_called(self, url, **kwargs):
        raise AssertionError("should not call the GitHub API when the URL already pins a ref")

    monkeypatch.setattr(httpx.AsyncClient, "get", fail_if_called)

    calls: dict = {}

    def fake_stream(self, method, url, **kwargs):
        calls["archive_url"] = url
        return _FakeStreamResponse([b"zip-bytes"])

    async def fake_process(raw, name):
        return {"ok": True}

    monkeypatch.setattr(httpx.AsyncClient, "stream", fake_stream)
    monkeypatch.setattr(ingestion, "_process_zip_bytes", fake_process)

    await ingestion.ingest_from_github.__wrapped__(
        request=None,
        response=None,
        body=ingestion.GithubImportRequest(url="https://github.com/owner/repo/tree/develop"),
    )
    assert calls["archive_url"] == "https://github.com/owner/repo/archive/develop.zip"


async def test_repo_not_found_is_a_clear_400_not_a_generic_failure(monkeypatch):
    class FakeApiResponse:
        status_code = 404

        def json(self):
            return {}

    async def fake_get(self, url, **kwargs):
        return FakeApiResponse()

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    with pytest.raises(HTTPException) as exc_info:
        await ingestion.ingest_from_github.__wrapped__(
            request=None,
            response=None,
            body=ingestion.GithubImportRequest(url="owner/does-not-exist"),
        )
    assert exc_info.value.status_code == 400
    assert "wasn't found" in exc_info.value.detail
    assert "private" in exc_info.value.detail  # the real, honest reason a legitimate repo could still 404


async def test_oversized_archive_is_rejected_without_buffering_it_all(monkeypatch):
    """Streamed and capped by hand, not trusted from Content-Length (see
    the route's own comment on why) -- this confirms the cap actually
    fires partway through a stream, not just when a header says so."""

    class FakeApiResponse:
        status_code = 200

        def json(self):
            return {"default_branch": "main"}

    async def fake_get(self, url, **kwargs):
        return FakeApiResponse()

    big_chunk = b"x" * (ingestion.MAX_UPLOAD_BYTES // 2 + 1)

    def fake_stream(self, method, url, **kwargs):
        return _FakeStreamResponse([big_chunk, big_chunk])

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(httpx.AsyncClient, "stream", fake_stream)

    with pytest.raises(HTTPException) as exc_info:
        await ingestion.ingest_from_github.__wrapped__(
            request=None,
            response=None,
            body=ingestion.GithubImportRequest(url="owner/repo"),
        )
    assert exc_info.value.status_code == 400
    assert "exceeds" in exc_info.value.detail


async def test_invalid_url_is_rejected_before_any_network_call(monkeypatch):
    async def fail_if_called(self, url, **kwargs):
        raise AssertionError("should not attempt a network call for an unparseable URL")

    monkeypatch.setattr(httpx.AsyncClient, "get", fail_if_called)

    with pytest.raises(HTTPException) as exc_info:
        await ingestion.ingest_from_github.__wrapped__(
            request=None,
            response=None,
            body=ingestion.GithubImportRequest(url="not a url at all"),
        )
    assert exc_info.value.status_code == 400
