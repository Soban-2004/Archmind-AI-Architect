"""
Evidence Graph (spec §6 Phase 5): the contract between static extraction
and the LLM for existing-project ingestion. Deliberately a list of
discrete, source-attributed facts — never a prose summary and never raw
file contents — so the LLM reasons over the same kind of small, concrete,
citable inputs it does everywhere else in this codebase (a Scorecard
Finding, a diff entry, a simulation finding), and every node it proposes
can be traced back to a specific line in the actual repo instead of asked
to take the reconstruction on faith.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.models.commands import MutationCommand


class Evidence(BaseModel):
    """One concrete, source-attributed fact extracted from the repo —
    never inferred, always something a human could go look at and
    confirm."""

    id: str  # short stable id this evidence can be cited by, e.g. "ev_1"
    fact: str  # a short, structured category, e.g. "redis_dependency", "rest_route", "docker_service"
    detail: str  # human-readable specifics, e.g. "imports redis.asyncio"
    source: str  # file path, with a line number when one is meaningful, e.g. "backend/cache.py:3"


class EvidenceGraph(BaseModel):
    evidence: list[Evidence]
    # Real, honest signal for anything noticed but outside MVP coverage
    # (spec: "explicitly detect and message... rather than silently
    # producing a wrong architecture") — e.g. a Go file, a Kubernetes
    # manifest, a language this pipeline doesn't parse.
    unsupported_notes: list[str] = []

    def by_id(self, evidence_id: str) -> Evidence | None:
        return next((e for e in self.evidence if e.id == evidence_id), None)


class IngestionTurnOutput(BaseModel):
    """The model's structured output for a reconstruction pass — mirrors
    InterviewTurnOutput's shape (commands, never a diagram) but adds
    `citations`: which evidence id(s) justified each node, keyed by the
    same `ref` an add_node command uses. This is what makes "every
    proposed node traceable to specific evidence" (spec's Phase 5
    acceptance criteria) an enforced, checkable property rather than a
    hope — see services/ingestion.py, which drops any node whose ref has
    no real citation pointing at real evidence ids."""

    commands: list[MutationCommand] = []
    citations: dict[str, list[str]] = {}  # add_node ref -> evidence id(s)
    summary: str = ""
