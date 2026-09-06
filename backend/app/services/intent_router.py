"""
Deterministic pre-LLM intent routing.

Not every chat message is an architecture-edit request — "why do we need
a load balancer?" and "add a second backend" are fundamentally different
asks, but the pipeline used to treat both identically: full serialized
architecture state, commands schema, Gemini judge pass, a new version row.
That's real, unnecessary cost (tokens AND a spurious version) for the
common case of someone just asking a question.

This sits alongside deterministic.py's try_deterministic_command as
another Tier-1-style check that runs BEFORE any LLM call — cheap,
regex-based, and conservative for the exact same reason that module is
conservative: a false positive here (treating a real edit request as
"just a question") silently drops the user's actual ask, which is worse
than the status quo of routing everything through the full edit pipeline.
So this only ever fires on confident, unambiguous non-edit phrasings, and
explicitly refuses to fire at all if the message contains any edit-shaped
verb, no matter how question-like the rest of it reads. Anything this
returns None for falls straight through to the existing full architect
pipeline in services/interview.py, completely unchanged.
"""
from __future__ import annotations

import re
from typing import Literal

RouterIntent = Literal["advisory", "analysis"]

# Any of these anywhere in the message means "this could plausibly be an
# edit" — and an edit-shaped message is NEVER diverted, even if it also
# contains question-like phrasing ("why not add a cache?" stays a
# candidate for the edit pipeline, not the read-only advisory lane).
_EDIT_VERB_RE = re.compile(
    r"\b(add|remove|delete|change|replace|swap|update|rename|connect|wire|"
    r"increase|decrease|scale up|scale down|set the|make it|convert|split|"
    r"merge|move|migrate)\b",
    re.IGNORECASE,
)

# Unambiguous what-if / hypothetical framing — these ask "what would
# happen", never "make it happen". Routed to the simulator-backed
# analysis lane (see services/interview.py's _handle_analysis), not an
# LLM guessing at load numbers from scratch.
_ANALYSIS_RE = re.compile(
    r"^\s*("
    r"what (would |will )?happens?\s+(if|when|to)\b|"
    r"what if\b|"
    r"how (would|does|will) (this|it|the (system|architecture))\s+(handle|hold up|cope|scale|perform)\b|"
    r"can (this|it|the (system|architecture)) handle\b"
    r")",
    re.IGNORECASE,
)

# Unambiguous question / recommendation framing — routed to the advisory
# lane (see services/interview.py's _handle_advisory).
_ADVISORY_RE = re.compile(
    r"^\s*("
    r"why (do|does|is|are|should)\b|"
    r"what('s| is) the (purpose|point|role) of\b|"
    r"which\b.*\bshould\b|"
    r"should (i|we) use\b|"
    r"(is|are)\b.*\bneeded\b|"
    r"do (i|we) (need|require)\b|"
    r"(recommend|suggest)\b.*\?\s*$|"
    r"(compare|pros and cons of)\b|"
    r"what database should\b|"
    r"explain\b"
    r")",
    re.IGNORECASE,
)

_MULTIPLIER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*x\b", re.IGNORECASE)

# A generic "meaningful spike" used when the user asks a what-if question
# without giving a concrete multiplier ("what if traffic spikes?") — big
# enough to actually surface a bottleneck if one exists, without being an
# arbitrary extreme.
DEFAULT_ANALYSIS_MULTIPLIER = 5.0


def classify_intent(message: str) -> RouterIntent | None:
    """Returns "advisory" (question/recommendation), "analysis" (what-if,
    simulator-backed), or None — the safe default for anything ambiguous
    or edit-shaped, meaning "use the existing full edit pipeline"."""
    if _EDIT_VERB_RE.search(message):
        return None
    if _ANALYSIS_RE.search(message):
        return "analysis"
    if _ADVISORY_RE.search(message):
        return "advisory"
    return None


def extract_multiplier(message: str) -> float:
    """Pulls an explicit "10x" style multiplier out of a what-if message;
    falls back to DEFAULT_ANALYSIS_MULTIPLIER when none is stated."""
    m = _MULTIPLIER_RE.search(message)
    if m:
        try:
            value = float(m.group(1))
            if value > 0:
                return value
        except ValueError:
            pass
    return DEFAULT_ANALYSIS_MULTIPLIER
