"""
Analyzer contract (spec §6 Phase 4). Scores are computed entirely by the
deterministic rule engine (app/analyzer/rules.py) — the LLM is only ever
allowed to narrate an already-computed Scorecard (see
services/analyzer.py's explain_scorecard), never to compute or adjust a
score itself. That's what keeps §10's "re-running the analyzer on an
unchanged architecture produces identical scores" property true by
construction.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class Category(str, Enum):
    scalability = "scalability"
    reliability = "reliability"
    security = "security"
    cost = "cost"
    observability = "observability"
    performance = "performance"
    maintainability = "maintainability"


class Severity(str, Enum):
    minor = "minor"
    moderate = "moderate"
    major = "major"


SEVERITY_POINTS: dict[Severity, int] = {
    Severity.minor: 5,
    Severity.moderate: 15,
    Severity.major: 30,
}


class Finding(BaseModel):
    rule_id: str
    category: Category
    severity: Severity
    points: int
    message: str  # deterministic, templated from real state facts — not LLM-authored
    evidence_node_ids: list[str] = []
    evidence_edge_ids: list[str] = []


class CategoryScore(BaseModel):
    category: Category
    score: int  # 0-100
    findings: list[Finding]


class Scorecard(BaseModel):
    rules_version: str
    overall_score: int
    categories: list[CategoryScore]

    def all_findings(self) -> list[Finding]:
        return [f for c in self.categories for f in c.findings]


class ScorecardAnswer(BaseModel):
    answer: str
    cited_rule_ids: list[str] = []  # must reference rule_ids that actually fired; unverifiable ones are dropped
