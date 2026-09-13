"""
Tests for rate_limit.py and its wiring into main.py / the LLM-calling
routes. The mechanism itself is tested against a small throwaway app (no
real DB needed — main.py's real app would try to connect to Supabase on
lifespan startup, which these tests deliberately never trigger); the
wiring is tested by importing the real app and routes directly and
checking they're actually decorated, without invoking them.
"""
from __future__ import annotations

from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address


def _build_test_app(limit: str, key_func=get_remote_address) -> FastAPI:
    """A tiny standalone app wired the same way main.py wires the real
    one — isolates the rate-limiting MECHANISM from the real routes,
    which need a live Supabase connection this test suite never sets up."""
    limiter = Limiter(key_func=key_func, headers_enabled=True)
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/ping")
    @limiter.limit(limit)
    async def ping(request: Request, response: Response):
        # `response` unused directly but required when headers_enabled=True
        # and the endpoint returns a plain dict rather than a Response
        # subclass — a real gotcha found live via this exact test (see
        # rate_limit.py's own comment on the real app's routes for the
        # same fix): without it, slowapi crashes trying to inject headers
        # into a None, on EVERY request, not just a 429.
        return {"ok": True}

    return app


def test_requests_under_the_cap_all_succeed():
    client = TestClient(_build_test_app("3/minute"))
    for _ in range(3):
        assert client.get("/ping").status_code == 200


def test_a_request_over_the_cap_gets_a_real_429_not_a_silent_failure():
    """The actual bug this whole feature exists to prevent: with no auth
    at all, an unthrottled endpoint lets a scripted loop hammer it
    indefinitely. The 4th request against a 3/minute cap must be refused,
    with a real Retry-After header telling the caller when to come back —
    not a 500, not a hang, not a quietly-served 200."""
    client = TestClient(_build_test_app("3/minute"))
    for _ in range(3):
        client.get("/ping")
    res = client.get("/ping")
    assert res.status_code == 429
    assert "retry-after" in {h.lower() for h in res.headers}


def test_independent_keys_get_independent_limits():
    """Per-key (per-IP in production, via get_remote_address), not global —
    one caller tripping the limit must not lock out a different caller.
    Uses a custom key_func reading a header directly, since TestClient's
    fake transport can't vary the connecting IP get_remote_address would
    normally read per-request — this isolates the property actually under
    test (independent bucketing per key) from header-parsing specifics."""
    key_func = lambda request: request.headers.get("X-Test-Client", "default")  # noqa: E731
    client = TestClient(_build_test_app("1/minute", key_func=key_func))
    assert client.get("/ping", headers={"X-Test-Client": "a"}).status_code == 200
    assert client.get("/ping", headers={"X-Test-Client": "b"}).status_code == 200  # different bucket, still fresh
    assert client.get("/ping", headers={"X-Test-Client": "a"}).status_code == 429  # same bucket as the first call, now exhausted


def test_real_app_has_the_shared_limiter_wired():
    from app.main import app
    from app.rate_limit import limiter

    assert app.state.limiter is limiter


def test_real_llm_routes_are_actually_rate_limited():
    """Confirms the decorator is really applied to the routes that spend
    real LLM-provider money -- not just that the module exists. Checking
    for slowapi's own wrapping (via __wrapped__, which its decorator
    preserves) rather than invoking the routes, which would need a real
    Supabase connection this test suite never sets up."""
    from app.api.routes.analyzer import ask_scorecard
    from app.api.routes.chat import chat, chat_stream
    from app.api.routes.ingestion import ingest_project

    for fn in (chat, chat_stream, ask_scorecard, ingest_project):
        assert hasattr(fn, "__wrapped__"), f"{fn.__name__} is not rate-limited"
