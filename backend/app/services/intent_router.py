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

RouterIntent = Literal["advisory", "analysis", "off_topic"]

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
#
# NOT anchored to the start of the message (an earlier version required
# `^\s*` before the trigger phrase) — a real message caught this live:
# "so is one backend enough for this use case??" starts with a completely
# normal conversational filler ("so"), which pushed the actual question
# phrase past the anchor and left it unmatched, silently falling through
# to the full edit pipeline and tripping the token pre-flight gate on a
# large project purely because the question didn't open with the trigger
# word. The edit-verb check above still runs first and unconditionally
# wins regardless of where in the message it appears, so dropping the
# anchor doesn't reopen the false-positive risk this module exists to
# avoid — it just stops requiring the trigger phrase to be the literal
# first word.
_ANALYSIS_RE = re.compile(
    r"("
    r"what (would |will )?happens?\s+(if|when|to)\b|"
    r"what if\b|"
    r"how (would|does|will) (this|it|the (system|architecture))\s+(handle|hold up|cope|scale|perform)\b|"
    r"can (this|it|the (system|architecture)) handle\b"
    r")",
    re.IGNORECASE,
)

# Unambiguous question / recommendation framing — routed to the advisory
# lane (see services/interview.py's _handle_advisory). Also not anchored
# to the start of the message, for the same reason as _ANALYSIS_RE above.
#
# The last four alternatives (price/cost/"still X"/latest-version/still-
# exists) were added alongside needs_web_grounding below — found live
# while testing that feature: every one of _WEB_GROUNDING_RE's own trigger
# phrasings ("what's the current pricing", "is X still maintained") failed
# to classify as advisory at all under the ORIGINAL list here, meaning
# needs_web_grounding (only ever checked inside _handle_advisory) could
# never actually run for the realistic phrasings it exists to catch — a
# genuinely dead feature, not a working one, until this was widened.
_ADVISORY_RE = re.compile(
    r"("
    r"\bwhy (do|does|is|are|should)\b|"
    r"\bwhat('s| is) the (purpose|point|role) of\b|"
    r"\bwhich\b.*\bshould\b|"
    r"\bshould (i|we) use\b|"
    r"\b(is|are)\b.*\b(needed|enough|necessary|overkill|sufficient|justified|warranted)\b|"
    r"\bdo (i|we) (need|require)\b|"
    r"\b(recommend|suggest)\b.*\?\s*$|"
    r"\b(compare|pros and cons of)\b|"
    r"\bwhat database should\b|"
    r"\bexplain\b|"
    r"\bwhat('s| is) the (current )?(price|pricing|cost)\b|"
    r"\bhow much (does|would|will|is)\b.*\bcost\b|"
    r"\bis\b.{0,20}\b(still\s+(maintained|supported|active|relevant|a good (choice|option)|widely used)|up[- ]to[- ]date)\b|"
    r"\bwhat('s| is) the latest\b|"
    r"\bstill\s+exists?\b|"
    r"\b(is|are|has|have)\b.{0,20}\bdeprecated\b"
    r")",
    re.IGNORECASE,
)

# A bare greeting/small-talk opener with no real content — "hi", "hey
# there!", "good morning" — never a project description. Deliberately
# anchored to the WHOLE message (only trailing punctuation/whitespace
# allowed around it), not just present-anywhere like the other patterns
# in this module: "hi, I want to build a food delivery app" has to fall
# through and be treated as a real description, not get swallowed here
# just because it happens to start with "hi". See interview.py's one call
# site (the brand-new-project kickoff turn) for why this exists — before
# it, "hi" was silently treated as the project's own description and
# handed straight into "how many active users do you expect?".
_GREETING_RE = re.compile(
    r"^\s*(hi+|hello+|hey+|hiya|yo|sup|howdy|greetings|good (morning|afternoon|evening))\s*[!.?~]*\s*$",
    re.IGNORECASE,
)


def is_greeting_only(message: str) -> bool:
    """True for a bare greeting/small-talk opener with nothing else in the
    message — see _GREETING_RE above."""
    return bool(_GREETING_RE.match(message))


# A free, zero-latency first pass for the CONFIDENT, common shapes of a
# message that has nothing to do with system architecture — general
# trivia, creative-writing requests, weather/time, math homework,
# translation, recipes, questions about the assistant itself, and
# prompt-injection attempts. Deliberately not exhaustive (an open-ended
# "any kind of question" can't be fully enumerated by regex) — this is
# only the fast path. The two places that actually call an LLM anyway for
# the surrounding turn (GatherQuestionOutput's off_topic field, and
# InterviewTurnOutput's action="off_topic") carry the real, general-
# purpose judgment call as a safety net for whatever this misses; see
# their call sites in interview.py. A false negative here just means that
# safety net (or, on the one deterministic-only path — recording a
# checklist answer — a possibly-wrong literal value) handles it instead;
# a false positive would wrongly refuse a real architecture question, so
# every pattern here is picked to be unambiguous.
_OFF_TOPIC_RE = re.compile(
    r"("
    # general trivia / world knowledge — anchored to subjects that are
    # never plausible architecture questions
    r"\bwhat('s| is) the (weather|time|date|capital of)\b|"
    r"\bwho (is|was) the (president|prime minister|ceo of \w+)\b|"
    r"\bwho (won|invented|discovered)\b|"
    r"\bwhat year (did|was)\b|"
    r"\bhow (many|much) (people|population)\b|"
    # creative-writing / entertainment requests
    r"\btell me (a |an )?(joke|poem|story|song|riddle)\b|"
    r"\bwrite (me )?(a |an )?(joke|poem|story|song|essay|riddle)\b|"
    r"\bmake me laugh\b|"
    # homework / unrelated computation, translation, cooking
    r"\bsolve (for|this)\b|"
    r"\btranslate\b.{0,20}\b(to|into)\b|"
    r"\b(recipe|how (do|to) (i |you )?cook)\b|"
    # meta questions about the assistant itself, not the project
    r"\bwho (made|created|built|trained) you\b|"
    r"\bwhat('s| is) your name\b|"
    r"\bare you (a |an )?(chatgpt|gpt|conscious|sentient|real)\b|"
    r"\bwhat (model|llm) are you\b|"
    # prompt-injection / jailbreak attempts
    r"\bignore (all |the )?(previous|above|prior) instructions\b|"
    r"\bdisregard (all |the )?(previous|above|prior)\b|"
    r"\byou are now\b|"
    r"\bpretend (to be|you('re| are))\b|"
    r"\breveal your (system )?prompt\b"
    r")",
    re.IGNORECASE,
)


def is_off_topic(message: str) -> bool:
    """True for a confident, common off-topic phrasing — see _OFF_TOPIC_RE
    above. Deliberately conservative; see its own comment for why a "no"
    here doesn't mean the message IS on-topic, just that this fast path
    isn't sure."""
    return bool(_OFF_TOPIC_RE.search(message))


_MULTIPLIER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*x\b", re.IGNORECASE)

# Genuinely time-sensitive phrasing only — "current pricing", "is X still
# maintained", "latest version" — not every advisory question. Only
# meaningful once classify_intent has already returned "advisory" for the
# same message (see services/interview.py's _handle_advisory); this
# doesn't re-check edit-shaped phrasing itself. A false negative here just
# means a normal advisory answer with no web grounding — the same safe
# default classify_intent's own conservatism already relies on — so this
# stays narrow rather than trying to catch every phrasing that could
# plausibly benefit from a current source.
_WEB_GROUNDING_RE = re.compile(
    r"("
    r"\bcurrent(ly)?\b.{0,25}\b(price|pricing|cost)\b|"
    r"\b(price|pricing|cost)\b.{0,25}\b(today|now|currently|these days)\b|"
    r"\bstill\s+(maintained|supported|active|around|relevant|a good (choice|option)|widely used)\b|"
    r"\b(latest|newest|current)\s+version\b|"
    r"\bup[- ]to[- ]date\b|"
    r"\bas of (today|now|\d{4})\b|"
    r"\b(is|has)\b.{0,15}\bbeen\s+deprecated\b|"
    r"\bstill\s+exists?\b"
    r")",
    re.IGNORECASE,
)

# A generic "meaningful spike" used when the user asks a what-if question
# without giving a concrete multiplier ("what if traffic spikes?") — big
# enough to actually surface a bottleneck if one exists, without being an
# arbitrary extreme.
DEFAULT_ANALYSIS_MULTIPLIER = 5.0


def classify_intent(message: str) -> RouterIntent | None:
    """Returns "advisory" (question/recommendation), "analysis" (what-if,
    simulator-backed), "off_topic" (confidently unrelated to this
    system's architecture — see is_off_topic), or None — the safe default
    for anything ambiguous or edit-shaped, meaning "use the existing full
    edit pipeline" (which, for an off-topic message this fast path
    doesn't catch, still declines via InterviewTurnOutput's own
    action="off_topic" — see interview.py)."""
    if _EDIT_VERB_RE.search(message):
        return None
    if _ANALYSIS_RE.search(message):
        return "analysis"
    if _ADVISORY_RE.search(message):
        return "advisory"
    if is_off_topic(message):
        return "off_topic"
    return None


def needs_web_grounding(message: str) -> bool:
    """Should this advisory answer be grounded in a real, current web
    search (services/web_search.py) before the LLM answers? See
    _WEB_GROUNDING_RE above for the narrow set of triggers."""
    return bool(_WEB_GROUNDING_RE.search(message))


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
