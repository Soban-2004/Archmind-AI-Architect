"""
Deterministic diff engine (spec §6 Phase 2/3, §7: 'diff engine' is a
rule-based/no-LLM concern). Accepts any two ArchitectureStates — not just a
parent/child pair — so the same function backs both "diff this edit against
its parent" (Phase 2) and "compare any two versions" (Phase 3).
"""
from __future__ import annotations

from app.models.diff import ConstraintDiffEntry, EdgeDiffEntry, NodeDiffEntry, VersionDiff
from app.models.state import ArchitectureState, Edge, Node


def _edge_key(e: Edge) -> str:
    return f"{e.from_id}->{e.to_id}"


def diff_states(before: ArchitectureState, after: ArchitectureState) -> VersionDiff:
    node_diffs = _diff_nodes(before.nodes, after.nodes)
    edge_diffs = _diff_edges(before.edges, after.edges)
    constraint_diffs = _diff_constraints(before, after)

    summary = {
        "nodes_added": sum(1 for d in node_diffs if d.status == "added"),
        "nodes_removed": sum(1 for d in node_diffs if d.status == "removed"),
        "nodes_changed": sum(1 for d in node_diffs if d.status == "changed"),
        "edges_added": sum(1 for d in edge_diffs if d.status == "added"),
        "edges_removed": sum(1 for d in edge_diffs if d.status == "removed"),
        "edges_changed": sum(1 for d in edge_diffs if d.status == "changed"),
        "constraints_changed": len(constraint_diffs),
    }

    return VersionDiff(nodes=node_diffs, edges=edge_diffs, constraints=constraint_diffs, summary=summary)


def _diff_nodes(before: list[Node], after: list[Node]) -> list[NodeDiffEntry]:
    before_by_id = {n.id: n for n in before}
    after_by_id = {n.id: n for n in after}
    out: list[NodeDiffEntry] = []

    for nid in sorted(set(before_by_id) | set(after_by_id)):
        b, a = before_by_id.get(nid), after_by_id.get(nid)
        if b and not a:
            out.append(NodeDiffEntry(id=nid, status="removed", before=b.model_dump(mode="json")))
        elif a and not b:
            out.append(NodeDiffEntry(id=nid, status="added", after=a.model_dump(mode="json")))
        else:
            bd, ad = b.model_dump(mode="json"), a.model_dump(mode="json")
            changed = [k for k in ad if ad.get(k) != bd.get(k)]
            if changed:
                out.append(NodeDiffEntry(id=nid, status="changed", before=bd, after=ad, changed_fields=changed))

    return out


def _diff_edges(before: list[Edge], after: list[Edge]) -> list[EdgeDiffEntry]:
    before_by_key = {_edge_key(e): e for e in before}
    after_by_key = {_edge_key(e): e for e in after}
    out: list[EdgeDiffEntry] = []

    for key in sorted(set(before_by_key) | set(after_by_key)):
        b, a = before_by_key.get(key), after_by_key.get(key)
        if b and not a:
            out.append(EdgeDiffEntry(key=key, status="removed", before=b.model_dump(mode="json")))
        elif a and not b:
            out.append(EdgeDiffEntry(key=key, status="added", after=a.model_dump(mode="json")))
        else:
            bd, ad = b.model_dump(mode="json"), a.model_dump(mode="json")
            changed = [f for f in ("protocol", "sync_async", "notes") if ad.get(f) != bd.get(f)]
            if changed:
                out.append(EdgeDiffEntry(key=key, status="changed", before=bd, after=ad, changed_fields=changed))

    return out


def _diff_constraints(before: ArchitectureState, after: ArchitectureState) -> list[ConstraintDiffEntry]:
    before_by_type = {c.type: c.value for c in before.constraints}
    after_by_type = {c.type: c.value for c in after.constraints}
    out: list[ConstraintDiffEntry] = []

    for ctype in sorted(set(before_by_type) | set(after_by_type), key=lambda t: t.value):
        b, a = before_by_type.get(ctype), after_by_type.get(ctype)
        if b is not None and a is None:
            out.append(ConstraintDiffEntry(type=ctype.value, status="removed", before=b))
        elif a is not None and b is None:
            out.append(ConstraintDiffEntry(type=ctype.value, status="added", after=a))
        elif a != b:
            out.append(ConstraintDiffEntry(type=ctype.value, status="changed", before=b, after=a))

    return out
