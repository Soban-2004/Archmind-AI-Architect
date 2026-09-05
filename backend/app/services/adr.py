"""
Templated ADR fallback (spec §6 Phase 2: 'Maintain an ADR entry for every
meaningful architectural change — even a templated one'). Deterministic,
derived purely from the diff — not an LLM call — so an edit is never left
without a rationale just because the model forgot to call
annotate_decision.
"""
from __future__ import annotations

from app.models.diff import VersionDiff


def build_templated_decision(diff: VersionDiff) -> tuple[str, str] | None:
    """Returns (decision_text, rationale_text), or None if the diff is
    empty (nothing to record)."""
    s = diff.summary
    parts = []
    if s.get("nodes_added"):
        parts.append(f"added {s['nodes_added']} node(s)")
    if s.get("nodes_removed"):
        parts.append(f"removed {s['nodes_removed']} node(s)")
    if s.get("nodes_changed"):
        parts.append(f"changed {s['nodes_changed']} node(s)")
    if s.get("edges_added"):
        parts.append(f"added {s['edges_added']} connection(s)")
    if s.get("edges_removed"):
        parts.append(f"removed {s['edges_removed']} connection(s)")
    if s.get("edges_changed"):
        parts.append(f"changed {s['edges_changed']} connection(s)")
    if s.get("constraints_changed"):
        parts.append(f"updated {s['constraints_changed']} constraint(s)")

    if not parts:
        return None

    decision = "Updated architecture: " + ", ".join(parts) + "."
    rationale = "Requested by user via chat edit."
    return decision, rationale
