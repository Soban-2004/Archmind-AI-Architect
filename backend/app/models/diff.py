"""
Version diff contract (spec §6 Phase 2/3: 'every edit produces a new version
with a diff against the parent... added/removed/changed highlighted').

Only actual changes are ever included (no "unchanged" entries) — this is
what makes §10's diff-correctness check ("reports exactly the changes made,
no more, no less") meaningful and testable.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

DiffStatus = Literal["added", "removed", "changed"]


class NodeDiffEntry(BaseModel):
    id: str
    status: DiffStatus
    before: Optional[dict] = None
    after: Optional[dict] = None
    changed_fields: list[str] = []


class EdgeDiffEntry(BaseModel):
    key: str  # "{from_id}->{to_id}" — edges are matched by endpoint pair, not
    # their generated id, since there's no update_edge command: a protocol
    # change is a remove+add of the same (from,to) pair, and we want that to
    # read as "changed", not "removed one edge, added an unrelated one".
    status: DiffStatus
    before: Optional[dict] = None
    after: Optional[dict] = None
    changed_fields: list[str] = []


class ConstraintDiffEntry(BaseModel):
    type: str
    status: DiffStatus
    before: Optional[str] = None
    after: Optional[str] = None


class VersionDiff(BaseModel):
    nodes: list[NodeDiffEntry] = []
    edges: list[EdgeDiffEntry] = []
    constraints: list[ConstraintDiffEntry] = []
    summary: dict[str, int] = {}

    def is_empty(self) -> bool:
        return not (self.nodes or self.edges or self.constraints)

    def valid_refs(self) -> set[str]:
        """Every ref an LLM narration over this diff (compare.py's
        CompareExplanation, migration.py's MigrationBlueprint) is allowed
        to cite — a node id, "edge:<key>", or "constraint:<type>". Shared
        in one place so both consumers enforce groundedness the same
        way, rather than two copies of the same set-building logic."""
        refs = {n.id for n in self.nodes}
        refs |= {f"edge:{e.key}" for e in self.edges}
        refs |= {f"constraint:{c.type}" for c in self.constraints}
        return refs
