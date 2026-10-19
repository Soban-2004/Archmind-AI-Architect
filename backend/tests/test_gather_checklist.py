"""Tests for the deterministic requirements-gathering checklist (see
services/interview.py's REQUIRED_CONSTRAINT_ORDER) — the fix for two real
bugs found live: (1) the interview could silently ask the same question
twice, because nothing was actually persisted from an answer until the
model finally proposed a design, so a long interview's token-budget trim
could drop the earlier Q&A from what the model could still see; (2) every
single gathering question used to pay the full cost of the heavy
InterviewTurnOutput prompt/schema, which is why a long interview could hit
Groq's rate limit before a design was ever proposed.

Uses its own FakeRepo(None) (no version at all yet — a genuinely brand-new
project) rather than the shared `fake_repo` fixture, whose `base_version`
always has 4 real nodes and so never exercises this checklist at all
(confirmed live: the full existing suite passed unchanged after this
feature was added, precisely because no existing test's state had zero
nodes)."""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.commands import InterviewTurnOutput
from app.models.state import ConstraintType
from app.services.interview import REQUIRED_CONSTRAINT_ORDER, handle_chat_turn
from tests.conftest import FakeProvider, FakeRepo


def _patch(monkeypatch, repo: FakeRepo, provider: FakeProvider) -> None:
    import app.services.interview as interview

    monkeypatch.setattr(interview.repo, "get_version", repo.get_version)
    monkeypatch.setattr(interview.repo, "get_latest_version", repo.get_latest_version)
    monkeypatch.setattr(interview.repo, "get_project", repo.get_project)
    monkeypatch.setattr(interview.repo, "add_message", repo.add_message)
    monkeypatch.setattr(interview.repo, "set_message_version", repo.set_message_version)
    monkeypatch.setattr(interview.repo, "get_branch_history", repo.get_branch_history)
    monkeypatch.setattr(interview.repo, "create_version", repo.create_version)
    monkeypatch.setattr(interview.repo, "create_adrs", repo.create_adrs)
    monkeypatch.setattr(interview, "get_llm_provider", lambda: provider)
    monkeypatch.setattr(interview, "get_judge_provider", lambda: None)


async def test_kickoff_message_asks_first_question_without_an_llm_call(monkeypatch):
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "I want to build a food delivery app", None)

    assert result.kind == "question"
    assert result.question == "How many active users do you expect?"
    assert result.quick_replies == ["Under 1,000", "1k-10k", "10k-100k", "100k+", "Not sure"]
    # Nothing recorded yet -- the kickoff message describes the project,
    # it doesn't answer anything.
    assert repo.versions_created == []
    # Checklist wording is code-owned: no provider call or tokens spent.
    assert provider.structured_calls == []
    assert provider.interview_calls == []


async def test_bare_greeting_on_a_new_project_gets_a_conversational_reply_not_a_question(monkeypatch):
    """Real bug, found live: "hi" on a brand-new project was silently
    treated as the project's OWN description and handed straight into
    "how many active users do you expect?" -- a bare greeting must instead
    get a friendly, no-LLM-call reply and wait for an actual description."""
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "hi", None)

    assert result.kind == "question"
    assert "?" in result.question or result.question  # a real, non-empty prompt back
    assert "active users" not in result.question.lower()
    # No LLM call at all for this -- same "cheap and deterministic"
    # philosophy as the rest of Tier 1/1.5/1.75.
    assert provider.structured_calls == []
    assert provider.interview_calls == []
    # Nothing recorded -- a greeting isn't a description or an answer.
    assert repo.versions_created == []


async def test_greeting_then_a_real_description_asks_the_first_real_question(monkeypatch):
    """A "hi" followed by the actual description must still work exactly
    like a normal kickoff -- the greeting turn is skipped over, not
    mistaken for the description itself."""
    repo = FakeRepo(None)
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "user", "content": "hi", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "assistant", "content": "Hey! Tell me what you're building.", "version_id": None})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "I want to build a food delivery app", None)

    assert result.kind == "question"
    assert result.question == "How many active users do you expect?"
    # Still nothing recorded -- this IS the kickoff description, not an
    # answer to anything (the checklist hasn't started yet).
    assert repo.versions_created == []
    assert provider.structured_calls == []


async def test_off_topic_kickoff_message_declines_via_regex_fast_path_no_llm_call(monkeypatch):
    """A confidently off-topic first message (intent_router.py's regex
    fast-path) must decline for free, exactly like a bare greeting --
    never grounding the first requirements question in it."""
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "what's the weather today?", None)

    assert result.kind == "question"
    assert "weather" not in result.question.lower()
    assert provider.structured_calls == []
    assert provider.interview_calls == []
    assert repo.versions_created == []


async def test_additional_off_topic_kickoff_is_caught_without_an_llm(monkeypatch):
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "quiz me on state capitals", None)

    assert result.kind == "question"
    assert "state capitals" not in (result.question or "").lower()
    assert provider.structured_calls == []
    assert provider.interview_calls == []
    assert repo.versions_created == []


async def test_unclear_kickoff_is_not_mistaken_for_a_project_description(monkeypatch):
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "I like turtles", None)

    assert result.kind == "question"
    assert "what software" in (result.question or "").lower()
    assert "active users" not in (result.question or "").lower()
    assert repo.versions_created == []
    assert provider.interview_calls == []


async def test_real_description_after_unclear_kickoff_starts_checklist(monkeypatch):
    repo = FakeRepo(None)
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "user", "content": "I like turtles", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "assistant", "content": "Tell me what software you want to design.", "version_id": None})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "A project management dashboard", None)

    assert result.kind == "question"
    assert result.question == "How many active users do you expect?"
    assert repo.versions_created == []
    assert provider.interview_calls == []


async def test_off_topic_reply_mid_checklist_does_not_corrupt_the_pending_constraint(monkeypatch):
    """An off-topic message mid-checklist (a real description already
    given, a question already pending) must NOT get silently recorded as
    the answer to whatever's pending -- it should nudge back to the
    question instead, leaving the checklist exactly where it was."""
    repo = FakeRepo(None)
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "user", "content": "I want to build a food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "assistant", "content": "How many active users do you expect?", "version_id": None})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "tell me a joke instead", None)

    assert result.kind == "question"
    assert repo.versions_created == []  # nothing recorded -- expected_users is still pending
    assert provider.structured_calls == []  # deterministic nudge, no LLM call
    assert provider.interview_calls == []


@pytest.mark.parametrize("message", [
    "why do you need this?",
    "a lot",
    "10k users with a $100 monthly budget",
])
async def test_ambiguous_checklist_reply_is_not_recorded(monkeypatch, message):
    repo = FakeRepo(None)
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "user", "content": "I want to build a food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "assistant", "content": "How many active users do you expect?", "version_id": None})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), message, None)

    assert result.kind == "question"
    assert "active users" in (result.question or "").lower()
    assert repo.versions_created == []
    assert provider.structured_calls == []
    assert provider.interview_calls == []


async def test_explicit_correction_updates_named_field_and_keeps_pending_question(monkeypatch):
    from app.models.state import ArchitectureState

    project_id = uuid4()
    repo = FakeRepo(None)
    repo._base_version = {
        "id": uuid4(), "project_id": project_id, "parent_version_id": None, "label": None,
        "kind": "initial",
        "state": ArchitectureState.model_validate({
            "nodes": [], "edges": [],
            "constraints": [{"type": "expected_users", "value": "1k-10k"}],
        }).model_dump(mode="json"),
        "layout": {},
    }
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "user", "content": "I want to build a food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "assistant", "content": "What peak request rate should the system handle?", "version_id": repo._base_version["id"]})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(project_id, "Actually the monthly budget is $100", repo._base_version["id"])

    assert result.kind == "question"
    assert "updated budget monthly usd" in (result.question or "").lower()
    assert "peak request rate" in (result.question or "").lower()
    assert len(repo.versions_created) == 1
    values = {c["type"]: c["value"] for c in repo.versions_created[0]["state"]["constraints"]}
    assert values["expected_users"] == "1k-10k"
    assert values["budget_monthly_usd"] == "Actually the monthly budget is $100"
    assert "expected_rps" not in values
    assert provider.interview_calls == []


async def test_out_of_range_availability_is_not_persisted(monkeypatch):
    from app.models.state import ArchitectureState

    project_id = uuid4()
    repo = FakeRepo(None)
    repo._base_version = {
        "id": uuid4(), "project_id": project_id, "parent_version_id": None, "label": None,
        "kind": "edit",
        "state": ArchitectureState.model_validate({
            "nodes": [], "edges": [],
            "constraints": [
                {"type": "expected_users", "value": "1k-10k"},
                {"type": "expected_rps", "value": "100 RPS"},
            ],
        }).model_dump(mode="json"),
        "layout": {},
    }
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "user", "content": "I want to build a food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "assistant", "content": "What availability target do you need?", "version_id": repo._base_version["id"]})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(project_id, "150%", repo._base_version["id"])

    assert result.kind == "question"
    assert "no more than 100%" in (result.question or "")
    assert repo.versions_created == []
    assert provider.interview_calls == []


@pytest.mark.parametrize("message", ["", "   ", "hello\x00world"])
async def test_empty_or_control_character_message_is_rejected_before_storage(monkeypatch, message):
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), message, None)

    assert result.kind == "error"
    assert repo.messages == []
    assert provider.interview_calls == []


async def test_second_turn_records_the_first_answer_and_asks_the_next_question(monkeypatch):
    repo = FakeRepo(None)
    # Pre-seed the kickoff exchange that already happened, matching what
    # the first turn above would have produced.
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "user", "content": "I want to build a food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": None, "role": "assistant", "content": "How many active users do you expect?", "version_id": None})
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(uuid4(), "1k-10k", None)

    assert result.kind == "question"
    assert result.question == "What peak request rate should the system handle?"
    # The FIRST answer is now a real, persisted constraint -- not just
    # text sitting in chat history a later trim could silently drop.
    assert len(repo.versions_created) == 1
    version = repo.versions_created[0]
    assert version["kind"] == "initial"  # the project's first-ever version
    constraints = version["state"]["constraints"]
    assert len(constraints) == 1
    assert constraints[0]["type"] == "expected_users"
    assert constraints[0]["value"] == "1k-10k"
    # And the next question is about the SECOND checklist item, with no LLM call.
    assert "peak request rate" in result.question.lower()
    assert provider.structured_calls == []


async def test_checklist_never_repeats_a_question_across_the_whole_flow(monkeypatch):
    """Walks the ENTIRE checklist (every required constraint but the
    last) end to end and asserts each turn asks about a genuinely
    different constraint, in REQUIRED_CONSTRAINT_ORDER, never repeating
    one already answered."""
    repo = FakeRepo(None)
    provider = FakeProvider()
    _patch(monkeypatch, repo, provider)

    # A fixed project_id and a base_version_id that advances to whatever
    # was just created — matching how the real frontend passes its
    # activeVersionId on every turn (see AppShell.tsx). FakeRepo's own
    # create_version doesn't update its _base_version (nothing in
    # handle_chat_turn needs it to), so that advance has to happen here.
    project_id = uuid4()
    base_id = None
    asked_labels: list[str] = []
    answers = ["1k-10k", "5k-10k rps", "99.9%", "Strong consistency"]
    result = await handle_chat_turn(project_id, "I want to build a food delivery app", base_id)
    asked_labels.append(result.question or "")
    assert result.kind == "question"

    for i, answer in enumerate(answers):
        result = await handle_chat_turn(project_id, answer, base_id)
        assert result.kind == "question", f"turn {i + 1} unexpectedly not a question: {result.error}"
        asked_labels.append(result.question or "")
        assert len(repo.versions_created) == i + 1
        latest = repo.versions_created[-1]
        repo._base_version = latest
        base_id = latest["id"]

    # Every question is code-owned, distinct, and costs no LLM call.
    assert len(asked_labels) == len(set(asked_labels))
    assert provider.structured_calls == []
    assert provider.interview_calls == []


async def test_budget_as_the_last_answer_falls_through_to_the_full_design_call(monkeypatch):
    """Once every OTHER required constraint is already known and only
    budget remains, answering it must NOT trigger another light
    gather-question call -- the checklist is complete, so this falls
    through into the existing heavy Tier 2 interview_turn flow for its
    own first real decision (propose the design, or ask one more
    question if the budget genuinely doesn't fit)."""
    repo = FakeRepo(None)
    from app.models.state import ArchitectureState

    project_id = uuid4()
    known = ArchitectureState.model_validate({
        "nodes": [], "edges": [],
        "constraints": [{"type": t.value, "value": "some value"} for t in REQUIRED_CONSTRAINT_ORDER if t is not ConstraintType.budget_monthly_usd],
    })
    repo._base_version = {
        "id": uuid4(), "project_id": project_id, "parent_version_id": None, "label": None,
        "kind": "initial", "state": known.model_dump(mode="json"), "layout": {},
    }
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "user", "content": "food delivery app", "version_id": None})
    repo.messages.append({"id": uuid4(), "project_id": project_id, "role": "assistant", "content": "What's your budget?", "version_id": None})

    provider = FakeProvider(interview_response=InterviewTurnOutput(action="ask_question", question="Any real design question."))
    _patch(monkeypatch, repo, provider)

    result = await handle_chat_turn(project_id, "$500/mo", repo._base_version["id"])

    assert result.kind == "question"
    assert result.question == "Any real design question."
    # The heavy call was used for this turn, not the light one -- the
    # checklist itself is code-driven and doesn't spend an LLM call at all
    # on deciding it's complete.
    assert provider.structured_calls == []
    assert len(provider.interview_calls) == 1
    # And budget was recorded as a real constraint, alongside everything
    # gathered before it, in the version this turn built on.
    assert len(repo.versions_created) == 1
    recorded_types = {c["type"] for c in repo.versions_created[0]["state"]["constraints"]}
    assert recorded_types == {t.value for t in REQUIRED_CONSTRAINT_ORDER}
