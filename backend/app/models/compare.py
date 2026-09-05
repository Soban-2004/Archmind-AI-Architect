"""
Compare/explain contract (spec §6 Phase 3: 'a natural-language explanation
of why the differences exist, grounded in the ADRs and constraints, not
freely invented').

Groundedness is enforced structurally, not just requested in the prompt:
every explanation's `ref` must match a real entry in the deterministic diff
(see services/compare.py), and anything that doesn't is dropped before the
result ever reaches the user.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.models.diff import VersionDiff


class DiffExplanationEntry(BaseModel):
    ref: str  # a node id, "edge:<key>", or "constraint:<type>" — must match a real diff entry
    explanation: str


class CompareExplanation(BaseModel):
    entries: list[DiffExplanationEntry] = []
    overall_summary: str = ""


class CompareResult(BaseModel):
    diff: VersionDiff
    explanation: CompareExplanation
