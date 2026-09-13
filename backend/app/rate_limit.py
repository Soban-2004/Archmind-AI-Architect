"""
Per-IP rate limiting (slowapi, backed by the `limits` library) — this app
runs guest-mode-only with no auth at all (see db/schema.sql: there's no
users table, nothing scoping a project to whoever created it), so every
endpoint is reachable by anyone who finds the URL. Two tiers:

- The handful of routes that spend a real, metered call against an LLM
  provider (Groq/Gemini) or do real CPU/filesystem work (parsing an
  uploaded repo zip) get a strict per-IP limit — these are the ones that
  actually cost money or resources per request, and the ones a scripted
  loop could burn through a real API budget on in minutes.
- Everything else gets a looser default limit (Limiter's own
  `default_limits`, applied automatically to every route, no per-route
  decorator needed) — mostly to stop someone from scripting thousands of
  project-creates or version-lists against the database, not because
  those requests cost money.

In-memory storage (the `limits` library's default MemoryStorage) —
deliberately not Redis: this runs as a single process for a portfolio
deployment, and adding a Redis dependency to rate-limit a demo app is
more infrastructure than the problem calls for. Two honest consequences
of that choice, stated plainly rather than glossed over: counts reset on
every restart, and would NOT be shared across multiple backend instances
if this is ever scaled horizontally. If that ever happens, `limits`
supports a Redis storage URI as a drop-in — nothing else here would need
to change.

RATE_LIMIT_VERSION exists for the same reason every other declared
assumption in this codebase is versioned — bump it if the actual numbers
below change.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

RATE_LIMIT_VERSION = "v1"

# Applied to every route automatically via Limiter(default_limits=...) —
# generous enough that normal use (browsing versions, loading the canvas,
# running a simulation) never brushes against it, tight enough that a
# scripted loop hammering project-creation or version-listing can't run
# unchecked.
DEFAULT_LIMIT = "60/minute"

# Decorated explicitly onto each route that actually calls an LLM
# provider (chat, chat/stream, scorecard/ask) — real Groq/Gemini spend
# per request, so this is deliberately tighter than the default.
LLM_LIMIT = "20/hour"

# Ingestion parses an uploaded zip and does real discovery/reconstruction
# work (plus its own LLM call) — same order of strictness as LLM_LIMIT,
# kept as its own constant in case the two ever need to diverge.
INGEST_LIMIT = "10/hour"

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[DEFAULT_LIMIT],
    # slowapi defaults this to False — without it, a 429 comes back with
    # no Retry-After/X-RateLimit-* headers at all, just the bare status
    # code, leaving a legitimate caller with no idea how long to wait.
    # Found live: the first version of this module shipped without it.
    headers_enabled=True,
)
