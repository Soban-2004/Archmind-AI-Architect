"""
Non-mutating chat response shapes — the advisory (question/recommendation)
and analysis (what-if) lanes routed to by services/intent_router.py and
handled in services/interview.py. Mirrors ScorecardAnswer's shape and
philosophy (models/analysis.py): the LLM only ever narrates, it has no
`commands` field here at all, so it is structurally incapable of emitting
a mutation from either of these lanes — services/interview.py's handlers
never call apply_commands or create_version for either one.
"""
from __future__ import annotations

from pydantic import BaseModel


class WebSource(BaseModel):
    """One real result from services/web_search.py's scoped search
    grounding — set server-side from what was actually fetched and fed to
    the prompt, never something the LLM claims to have found. Shared
    between llm/prompts.py (builds the grounding block) and
    services/interview.py (attaches the real list to the response) so
    both sides agree on the shape without services/ importing from llm/
    or vice versa."""

    title: str
    url: str
    snippet: str


class AdvisoryAnswer(BaseModel):
    """Output for the advisory lane — a question or recommendation,
    answered from a compact topology summary + constraints, never the
    full architecture state."""

    answer: str


class AnalysisAnswer(BaseModel):
    """Output for the analysis (what-if) lane — the LLM only ever
    narrates a REAL simulator run (services/simulator.py's
    run_simulation), never invents load numbers of its own."""

    answer: str
