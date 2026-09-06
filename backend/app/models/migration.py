"""
Migration Blueprint contract (spec §6 Phase 6: "an ordered list of
concrete changes... each linked to the specific analyzer finding or
scaling requirement that justifies it").

Groundedness is enforced structurally, the same pattern as compare.py's
CompareExplanation and analyzer.py's ScorecardAnswer: every step's `ref`
must match a real entry in the deterministic diff between the
reconstructed and target architectures (services/migration.py), and every
cited rule_id must match a Finding the Analyzer actually produced on the
reconstructed state — anything that doesn't is dropped before the result
ever reaches the user. A step is never accepted on the LLM's word alone.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.models.analysis import Scorecard
from app.models.diff import VersionDiff


class MigrationStep(BaseModel):
    order: int  # 1 = do first
    ref: str  # a node id, "edge:<key>", or "constraint:<type>" — must match a real diff entry (see models/diff.py's VersionDiff)
    action: str  # short imperative, e.g. "Add a read replica for PostgreSQL"
    justification: str  # grounded in a specific finding and/or the target's stated constraints — never generic advice
    cited_rule_ids: list[str] = []  # Analyzer Finding rule_ids (services/analyzer.py) that justify this step, if any fired


class MigrationBlueprint(BaseModel):
    steps: list[MigrationStep] = []
    overall_summary: str = ""


class MigrationBlueprintResult(BaseModel):
    """What the API actually returns — the blueprint plus enough of its
    real inputs (the diff, the reconstructed state's scorecard) for a
    frontend to show *why* each step exists without a second round trip,
    the same "hand back the ground truth alongside the narration"
    principle CompareResult already follows."""

    diff: VersionDiff
    reconstructed_scorecard: Scorecard
    blueprint: MigrationBlueprint
