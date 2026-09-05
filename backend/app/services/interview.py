from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_system_prompt
from app.models.state import ArchitectureState, empty_state
from app.services.mutation_engine import apply_commands

MAX_ENGINE_RETRIES = 2  # additional retries when mutation validation itself fails


@dataclass
class ChatTurnResult:
    kind: str  # "question" | "architecture" | "error"
    question: str | None = None
    summary: str | None = None
    version: dict | None = None
    error: str | None = None


def _state_from_row(version_row: dict | None) -> ArchitectureState:
    if version_row is None:
        return empty_state()
    return ArchitectureState.model_validate(version_row["state"])


async def handle_chat_turn(project_id: UUID, user_message: str) -> ChatTurnResult:
    await repo.add_message(project_id, "user", user_message)

    history = await repo.get_messages(project_id)
    conversation = [{"role": m["role"], "content": m["content"]} for m in history]

    latest_version = await repo.get_latest_version(project_id)
    current_state = _state_from_row(latest_version)

    provider = get_llm_provider()
    system_prompt = build_system_prompt()
    # Ground the model in the current state so it doesn't re-propose nodes
    # that already exist once a project has a version.
    system_prompt += f"\n\nCurrent architecture state (may be empty for a brand new project):\n{current_state.model_dump_json()}"

    retry_note: str | None = None
    for attempt in range(MAX_ENGINE_RETRIES + 1):
        turn = await provider.interview_turn(system_prompt, conversation, retry_note=retry_note)

        if turn.action == "ask_question":
            await repo.add_message(project_id, "assistant", turn.question or "")
            return ChatTurnResult(kind="question", question=turn.question)

        # propose_architecture
        commands = turn.commands or []
        result = apply_commands(current_state, commands)

        if not result.ok:
            retry_note = "; ".join(f"[cmd {e.command_index} {e.op}] {e.error}" for e in result.errors)
            if attempt < MAX_ENGINE_RETRIES:
                continue
            return ChatTurnResult(kind="error", error=f"Could not apply proposed architecture: {retry_note}")

        new_state = result.state
        assert new_state is not None
        version = await repo.create_version(
            project_id,
            new_state,
            kind="initial" if latest_version is None else "edit",
            parent_version_id=latest_version["id"] if latest_version else None,
        )
        if new_state.adrs:
            await repo.create_adrs(
                project_id,
                version["id"],
                [
                    {"decision": a.decision, "rationale": a.rationale, "triggered_by": a.triggered_by.value}
                    for a in new_state.adrs
                ],
            )

        summary = turn.summary or "Architecture updated."
        await repo.add_message(project_id, "assistant", summary)
        return ChatTurnResult(kind="architecture", summary=summary, version=version)

    return ChatTurnResult(kind="error", error="Unexpected: exhausted retries without returning.")
