from __future__ import annotations

from uuid import uuid4

import pytest

from app.llm.prompts import build_system_prompt
from app.llm.tokens import estimate_tokens
from app.models.commands import InterviewTurnOutput
from app.services.interview import MAX_USER_MESSAGE_CHARS, _project_brief, _trim_history, handle_chat_turn
from tests.conftest import FakeProvider, FakeRepo, build_state


def _patch(monkeypatch, repo: FakeRepo, provider: FakeProvider) -> None:
    import app.services.interview as interview

    for name in (
        "get_version", "get_latest_version", "get_project", "add_message",
        "set_message_version", "get_branch_history", "create_version", "create_adrs",
    ):
        monkeypatch.setattr(interview.repo, name, getattr(repo, name))
    monkeypatch.setattr(interview, "get_llm_provider", lambda: provider)
    monkeypatch.setattr(interview, "get_judge_provider", lambda: None)


def test_repeated_architect_contract_stays_compact():
    # This fixed prompt was ~5,324 estimated tokens before compaction. A
    # regression here is paid again on every architecture mutation.
    assert estimate_tokens(build_system_prompt()) < 2000


def test_history_trim_always_keeps_the_latest_request():
    history = [
        {"role": "user", "content": "old " * 500},
        {"role": "assistant", "content": "older answer " * 300},
        {"role": "user", "content": "Please change the database to PostgreSQL."},
    ]
    kept, dropped = _trim_history(history, budget_tokens=20)

    assert kept == [history[-1]]
    assert dropped == 2


def test_project_brief_ignores_greetings_and_survives_compaction():
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "What are you building?"},
        {"role": "user", "content": "A campus food delivery app with live courier tracking"},
        {"role": "assistant", "content": "How many users?"},
        {"role": "user", "content": "10k"},
    ]

    assert _project_brief(history) == "A campus food delivery app with live courier tracking"


@pytest.mark.asyncio
async def test_long_history_sends_brief_and_bounded_recent_context(monkeypatch):
    project_id = uuid4()
    state = build_state()
    base = {
        "id": uuid4(), "project_id": project_id, "parent_version_id": None,
        "label": None, "kind": "initial", "state": state.model_dump(mode="json"), "layout": {},
    }
    repo = FakeRepo(base)
    repo.messages.extend([
        {"id": uuid4(), "project_id": project_id, "role": "user", "content": "A campus food delivery app with live courier tracking", "version_id": base["id"]},
        {"id": uuid4(), "project_id": project_id, "role": "assistant", "content": "old answer " * 1000, "version_id": base["id"]},
        {"id": uuid4(), "project_id": project_id, "role": "user", "content": "old detail " * 1000, "version_id": base["id"]},
    ])
    provider = FakeProvider(interview_response=InterviewTurnOutput(action="ask_question", question="Which auth provider?"))
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(project_id, "Revise the authentication flow for enterprise SSO", base["id"])

    assert result.kind == "question"
    prompt, conversation, _ = provider.interview_calls[0]
    assert "A campus food delivery app with live courier tracking" in prompt
    assert conversation[-1]["content"] == "Revise the authentication flow for enterprise SSO"
    assert all("old answer" not in message["content"] for message in conversation)


@pytest.mark.asyncio
async def test_oversized_message_is_rejected_before_storage_or_llm(monkeypatch):
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "x" * (MAX_USER_MESSAGE_CHARS + 1))

    assert result.kind == "error"
    assert "too long" in (result.error or "").lower()
    assert repo.messages == []
    assert provider.interview_calls == []
    assert provider.structured_calls == []
