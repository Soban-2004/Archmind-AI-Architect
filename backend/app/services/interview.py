from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_system_prompt
from app.models.commands import AnnotateDecisionCommand
from app.models.diff import VersionDiff
from app.models.state import ADR, ArchitectureState, TriggeredBy, empty_state, gen_id
from app.services.adr import build_templated_decision
from app.services.deterministic import try_deterministic_command
from app.services.diff import diff_states
from app.services.mutation_engine import apply_commands

MAX_ENGINE_RETRIES = 2  # additional retries when mutation validation itself fails


@dataclass
class ChatTurnResult:
    kind: str  # "question" | "architecture" | "error"
    question: str | None = None
    summary: str | None = None
    version: dict | None = None
    diff: VersionDiff | None = None
    error: str | None = None


def _state_from_row(version_row: dict | None) -> ArchitectureState:
    if version_row is None:
        return empty_state()
    return ArchitectureState.model_validate(version_row["state"])


def _ensure_adr(new_state: ArchitectureState, diff: VersionDiff, model_provided_decision: bool) -> None:
    """Guarantee every meaningful edit/tier has a rationale on record (spec
    §6 Phase 2), regardless of whether the model called
    annotate_decision this turn. Deterministic, derived from the diff."""
    if model_provided_decision:
        return
    templated = build_templated_decision(diff)
    if templated is None:
        return  # nothing actually changed
    decision, rationale = templated
    new_state.adrs.append(
        ADR(id=gen_id("adr"), decision=decision, rationale=rationale, triggered_by=TriggeredBy.user_request)
    )


async def _finalize(
    project_id: UUID,
    diff_base_state: ArchitectureState,
    new_state: ArchitectureState,
    parent_version_id: UUID | None,
    kind: str,
    summary: str,
    model_provided_decision: bool,
    label: str | None = None,
) -> ChatTurnResult:
    diff = diff_states(diff_base_state, new_state) if parent_version_id else None
    if diff is not None:
        _ensure_adr(new_state, diff, model_provided_decision)

    version = await repo.create_version(project_id, new_state, kind=kind, parent_version_id=parent_version_id, label=label)
    if new_state.adrs:
        # For an edit, new_state.adrs carries the base's history forward
        # plus (maybe) one new entry, so this filters to just the new one.
        # For a tier/initial, new_state.adrs is built fresh from empty
        # state and never shares ids with diff_base_state.adrs, so nothing
        # is excluded — every entry is new and gets persisted.
        already_persisted_ids = {a.id for a in diff_base_state.adrs}
        await repo.create_adrs(
            project_id,
            version["id"],
            [
                {"decision": a.decision, "rationale": a.rationale, "triggered_by": a.triggered_by.value}
                for a in new_state.adrs
                if a.id not in already_persisted_ids
            ],
        )

    await repo.add_message(project_id, "assistant", summary)
    return ChatTurnResult(kind="architecture", summary=summary, version=version, diff=diff)


async def handle_chat_turn(project_id: UUID, user_message: str, base_version_id: UUID | None = None) -> ChatTurnResult:
    """`base_version_id` is whatever version the frontend currently has
    active — an edit or a tier request both branch off it. This is what
    lets sibling tiers (spec §6 Phase 3) share one base instead of chaining
    off each other, and incidentally makes editing from an older version in
    history a proper branch instead of being blocked."""
    await repo.add_message(project_id, "user", user_message)

    if base_version_id is not None:
        base_version = await repo.get_version(base_version_id)
        if base_version is None or base_version["project_id"] != project_id:
            return ChatTurnResult(kind="error", error="base_version_id not found")
    else:
        base_version = await repo.get_latest_version(project_id)

    current_state = _state_from_row(base_version)
    parent_id = base_version["id"] if base_version else None

    # --- Tier 1 (spec §7): deterministic, no LLM call at all ---------------
    if base_version is not None:
        det = try_deterministic_command(user_message, current_state)
        if det is not None:
            command, summary = det
            result = apply_commands(current_state, [command])
            if result.ok:
                assert result.state is not None
                return await _finalize(project_id, current_state, result.state, parent_id, "edit", summary, model_provided_decision=False)
            # fall through to the LLM if the deterministic guess somehow fails validation

    # --- Tier 2 (spec §7): LLM-assisted, structured output only ------------
    history = await repo.get_messages(project_id)
    conversation = [{"role": m["role"], "content": m["content"]} for m in history]

    provider = get_llm_provider()
    system_prompt = build_system_prompt()
    system_prompt += f"\n\nCurrent architecture state (may be empty for a brand new project):\n{current_state.model_dump_json()}"

    retry_note: str | None = None
    for attempt in range(MAX_ENGINE_RETRIES + 1):
        turn = await provider.interview_turn(system_prompt, conversation, retry_note=retry_note)

        if turn.action == "ask_question":
            await repo.add_message(project_id, "assistant", turn.question or "")
            return ChatTurnResult(kind="question", question=turn.question)

        commands = turn.commands or []
        is_tier = turn.action == "generate_tier"
        base_for_commands = empty_state() if is_tier else current_state
        result = apply_commands(base_for_commands, commands)

        if not result.ok:
            retry_note = "; ".join(f"[cmd {e.command_index} {e.op}] {e.error}" for e in result.errors)
            if attempt < MAX_ENGINE_RETRIES:
                continue
            return ChatTurnResult(kind="error", error=f"Could not apply proposed architecture: {retry_note}")

        new_state = result.state
        assert new_state is not None
        summary = turn.summary or ("New tier generated." if is_tier else "Architecture updated.")
        model_provided_decision = any(isinstance(c, AnnotateDecisionCommand) for c in commands)

        return await _finalize(
            project_id,
            current_state,  # diff a tier against the base it was generated from, same as an edit
            new_state,
            parent_id,
            kind="tier" if is_tier else ("initial" if base_version is None else "edit"),
            summary=summary,
            model_provided_decision=model_provided_decision,
            label=turn.tier_label if is_tier else None,
        )

    return ChatTurnResult(kind="error", error="Unexpected: exhausted retries without returning.")
