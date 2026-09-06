"""
Migration Blueprint service (spec §6 Phase 6): combines Phase 4 (the
Analyzer) and Phase 5 (ingestion) into "take my existing project and show
me how to make it production-ready." Reuses, rather than reimplements,
everything already built: the deterministic diff engine (services/diff.py,
Phase 2/3) computes reconstructed-vs-target as ground truth; the Analyzer
(services/analyzer.py, Phase 4) scores the reconstructed (as-is)
architecture; the target production tier is expected to already exist as
a real version (generated the same way any other tier is — spec §6 Phase
3's existing action="generate_tier" chat flow, nothing new needed there).
This service's only new job is turning "here's what changed, here's why
the as-is system scored what it scored, here's what the target needs"
into an ordered, grounded checklist — and, same as compare.py and
analyzer.py's Q&A, enforcing that groundedness in code rather than
trusting the LLM's citations at face value.
"""
from __future__ import annotations

from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_migration_blueprint_prompt
from app.models.migration import MigrationBlueprint, MigrationBlueprintResult
from app.models.state import ArchitectureState
from app.services.analyzer import score_architecture
from app.services.diff import diff_states


class VersionNotFound(Exception):
    pass


async def generate_migration_blueprint(project_id: UUID, reconstructed_version_id: UUID, target_version_id: UUID) -> MigrationBlueprintResult:
    reconstructed_row = await repo.get_version(reconstructed_version_id)
    target_row = await repo.get_version(target_version_id)
    if reconstructed_row is None or reconstructed_row["project_id"] != project_id:
        raise VersionNotFound(str(reconstructed_version_id))
    if target_row is None or target_row["project_id"] != project_id:
        raise VersionNotFound(str(target_version_id))

    reconstructed_state = ArchitectureState.model_validate(reconstructed_row["state"])
    target_state = ArchitectureState.model_validate(target_row["state"])

    diff = diff_states(reconstructed_state, target_state)
    reconstructed_scorecard = score_architecture(reconstructed_state)

    if diff.is_empty():
        return MigrationBlueprintResult(
            diff=diff, reconstructed_scorecard=reconstructed_scorecard,
            blueprint=MigrationBlueprint(steps=[], overall_summary="No structural differences between the reconstructed and target architectures — nothing to migrate."),
        )

    provider = get_llm_provider()
    prompt = build_migration_blueprint_prompt(diff, reconstructed_scorecard, target_state.constraints)
    try:
        raw = await provider.structured_json(prompt, "Produce the migration blueprint.", MigrationBlueprint)
    except Exception:
        # Best-effort narration over an already-correct diff and an
        # already-correct scorecard, same fallback-on-LLM-failure pattern
        # as compare.py/analyzer.py's other non-core LLM calls — never let
        # this hide the (deterministic, still useful on its own) diff and
        # scorecard the caller already has.
        return MigrationBlueprintResult(
            diff=diff, reconstructed_scorecard=reconstructed_scorecard,
            blueprint=MigrationBlueprint(steps=[], overall_summary="Blueprint generation unavailable."),
        )

    valid_refs = diff.valid_refs()
    valid_rule_ids = {f.rule_id for f in reconstructed_scorecard.all_findings()}
    grounded_steps = []
    for step in raw.steps:
        if step.ref not in valid_refs:
            continue  # not a real diff entry — dropped, never shown as if it were
        cited = [rid for rid in step.cited_rule_ids if rid in valid_rule_ids]
        grounded_steps.append(step.model_copy(update={"cited_rule_ids": cited}))

    # Renumber after filtering so `order` is always a clean 1..N sequence
    # from the user's point of view, regardless of how many (if any)
    # proposed steps got dropped for citing something that wasn't real.
    for i, step in enumerate(grounded_steps, start=1):
        grounded_steps[i - 1] = step.model_copy(update={"order": i})

    return MigrationBlueprintResult(
        diff=diff, reconstructed_scorecard=reconstructed_scorecard,
        blueprint=MigrationBlueprint(steps=grounded_steps, overall_summary=raw.overall_summary),
    )
