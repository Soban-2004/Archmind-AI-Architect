"""
Compare/explain service (spec §6 Phase 3). The diff itself is always the
deterministic ground truth (services/diff.py); the LLM only narrates it,
and any narration that references something outside the actual diff is
dropped before it reaches the user.
"""
from __future__ import annotations

from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_compare_prompt
from app.models.compare import CompareExplanation, CompareResult
from app.models.diff import VersionDiff
from app.models.state import ArchitectureState
from app.services.diff import diff_states


class VersionNotFound(Exception):
    pass


async def compare_versions(project_id: UUID, version_a_id: UUID, version_b_id: UUID, owner_token: str | None = None) -> CompareResult:
    row_a = await repo.get_version(version_a_id, owner_token)
    row_b = await repo.get_version(version_b_id, owner_token)
    if row_a is None or row_a["project_id"] != project_id:
        raise VersionNotFound(str(version_a_id))
    if row_b is None or row_b["project_id"] != project_id:
        raise VersionNotFound(str(version_b_id))

    state_a = ArchitectureState.model_validate(row_a["state"])
    state_b = ArchitectureState.model_validate(row_b["state"])
    diff = diff_states(state_a, state_b)

    if diff.is_empty():
        return CompareResult(
            diff=diff,
            explanation=CompareExplanation(entries=[], overall_summary="No structural differences between these two versions."),
        )

    provider = get_llm_provider()
    prompt = build_compare_prompt(diff, state_a, state_b)
    try:
        raw_explanation = await provider.structured_json(prompt, "Explain this diff.", CompareExplanation)
    except Exception:
        # The explanation is best-effort narration over an already-correct
        # diff; never let an LLM hiccup hide the (deterministic) diff itself.
        return CompareResult(diff=diff, explanation=CompareExplanation(entries=[], overall_summary="Explanation unavailable."))

    valid_refs = diff.valid_refs()
    grounded_entries = [e for e in raw_explanation.entries if e.ref in valid_refs]
    return CompareResult(diff=diff, explanation=CompareExplanation(entries=grounded_entries, overall_summary=raw_explanation.overall_summary))
