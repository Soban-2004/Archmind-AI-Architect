"""
Integration-level tests for the intent-routed chat pipeline
(services/interview.py's handle_chat_turn). Exercises the real routing,
validation, and finalize logic end to end; only the LLM provider and the
database repository are faked (see conftest.py) so these run offline.

Covers the six scenarios from the routing redesign, plus the
empty-commands versioning safety net:
  1. A pure question -> answer only, no version created.
  2. A recommendation -> answer only, no mutation.
  3. A what-if -> simulator-backed answer.
  4. An explicit edit -> normal full edit pipeline, version created.
  5. An ambiguous message -> safely falls back to the edit pipeline.
  6. An existing deterministic command (Tier 1) still works, no LLM call.
  7. (bonus) A model that emits zero commands never creates a version.
"""
from __future__ import annotations

from app.models.advisory import AdvisoryAnswer, AnalysisAnswer, WebSource
from app.models.commands import AddEdgeCommand, AddNodeCommand, InterviewTurnOutput
from app.services.interview import handle_chat_turn
from tests.conftest import FakeProvider, patch_provider


async def test_pure_question_answers_without_creating_a_version(monkeypatch, base_version, fake_repo):
    provider = FakeProvider(structured_response=AdvisoryAnswer(
        answer="With only one backend instance, a load balancer has nothing to distribute across yet."
    ))
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Why do we need a load balancer?", base_version["id"])

    assert result.kind == "answer"
    assert "distribute" in result.summary
    assert fake_repo.versions_created == []
    # Only the compact advisory schema was requested, never the mutation-
    # capable interview_turn path.
    assert len(provider.structured_calls) == 1
    assert provider.structured_calls[0][2] is AdvisoryAnswer
    assert provider.interview_calls == []


async def test_time_sensitive_question_is_grounded_in_a_real_web_search(monkeypatch, base_version, fake_repo):
    """intent_router.py's needs_web_grounding recognizes this phrasing —
    search_web (patched here so the test stays offline, same as the LLM
    provider) gets called, and its real results are attached to the
    response as `sources`, independent of whatever the LLM's own answer
    text says."""
    import app.services.interview as interview

    fake_sources = [WebSource(title="Redis Cloud Pricing", url="https://redis.io/pricing", snippet="Starts at $0...")]

    async def fake_search_web(query, max_results=3):
        return fake_sources

    monkeypatch.setattr(interview, "search_web", fake_search_web)

    provider = FakeProvider(structured_response=AdvisoryAnswer(answer="Redis Cloud's current free tier covers small workloads."))
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "What's the current pricing for Redis Cloud?", base_version["id"])

    assert result.kind == "answer"
    assert result.sources == fake_sources
    # The prompt actually sent to the model includes the real search
    # result, not just a mention that grounding happened.
    system_prompt = provider.structured_calls[0][0]
    assert "Redis Cloud Pricing" in system_prompt
    assert "https://redis.io/pricing" in system_prompt


async def test_ordinary_advisory_question_has_no_sources(monkeypatch, base_version, fake_repo):
    """The common case: no time-sensitive phrasing -> search_web is never
    called at all, and `sources` stays None -- byte-identical to the
    advisory lane's behavior before web grounding existed."""
    import app.services.interview as interview

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("search_web should not be called for an ordinary advisory question")

    monkeypatch.setattr(interview, "search_web", fail_if_called)

    provider = FakeProvider(structured_response=AdvisoryAnswer(answer="A load balancer needs at least two backends to distribute across."))
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Why do we need a load balancer?", base_version["id"])

    assert result.kind == "answer"
    assert result.sources is None


async def test_recommendation_answers_without_mutation(monkeypatch, base_version, fake_repo):
    provider = FakeProvider(structured_response=AdvisoryAnswer(
        answer="PostgreSQL fits best here: transactional writes and modest scale (100-500 users)."
    ))
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Which database should we use?", base_version["id"])

    assert result.kind == "answer"
    assert fake_repo.versions_created == []
    assert provider.interview_calls == []


async def test_what_if_is_simulator_backed(monkeypatch, base_version, fake_repo):
    provider = FakeProvider(structured_response=AnalysisAnswer(
        answer="The backend would be the first bottleneck at 10x traffic."
    ))
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "What happens if traffic increases 10x?", base_version["id"])

    assert result.kind == "answer"
    assert fake_repo.versions_created == []
    assert len(provider.structured_calls) == 1
    system_prompt, _, schema = provider.structured_calls[0]
    assert schema is AnalysisAnswer
    # The real simulator ran at the multiplier parsed from the message —
    # confirmed by the scenario string it produces (see simulator.py),
    # not a guessed or hallucinated number.
    assert "10x traffic" in system_prompt


async def test_explicit_edit_uses_full_pipeline_and_creates_a_version(monkeypatch, base_version, fake_repo):
    commands = [
        AddNodeCommand(ref="be2", node_type="service", name="Backend 2", attributes={"type": "service"}),
        AddEdgeCommand(from_id="svc_be", to_id="be2", protocol="http", sync_async="async"),
    ]
    turn = InterviewTurnOutput(action="propose_architecture", commands=commands, summary="Added a second backend.")
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Add a second backend.", base_version["id"])

    assert result.kind == "architecture"
    assert len(fake_repo.versions_created) == 1
    new_names = {n["name"] for n in fake_repo.versions_created[0]["state"]["nodes"]}
    assert "Backend 2" in new_names
    # The full edit-capable path was used, not the advisory/analysis lane.
    assert len(provider.interview_calls) == 1
    assert provider.structured_calls == []


async def test_ambiguous_message_falls_back_to_edit_pipeline(monkeypatch, base_version, fake_repo):
    """"Tell me about the current setup" matches neither the advisory nor
    analysis heuristics, and has no edit verb either — classify_intent
    returns None, so this must still reach the full Tier 2 pipeline
    (interview_turn), never the cheaper advisory lane, per the router's
    documented conservative default."""
    turn = InterviewTurnOutput(
        action="propose_architecture",
        commands=[],
        summary="This is a simple frontend/backend/database setup behind a load balancer.",
    )
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Tell me about the current setup.", base_version["id"])

    assert len(provider.interview_calls) == 1
    assert provider.structured_calls == []
    # Zero commands from the full pipeline -> the empty-commands safety
    # net fires: answered, but still no version created.
    assert result.kind == "answer"
    assert fake_repo.versions_created == []


async def test_existing_deterministic_command_still_works_with_no_llm_call(monkeypatch, base_version, fake_repo):
    provider = FakeProvider()
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Remove Load Balancer", base_version["id"])

    assert result.kind == "architecture"
    assert len(fake_repo.versions_created) == 1
    remaining_names = {n["name"] for n in fake_repo.versions_created[0]["state"]["nodes"]}
    assert "Load Balancer" not in remaining_names
    # Tier 1 resolved this deterministically -- no LLM call of any kind.
    assert provider.structured_calls == []
    assert provider.interview_calls == []


async def test_empty_commands_from_full_pipeline_never_creates_a_version(monkeypatch, base_version, fake_repo):
    """Direct coverage of the empty-commands safety net itself (independent
    of the ambiguous-routing test above): even when the full edit pipeline
    is reached and the model answers with zero commands, no version is
    created and no judge-worthy mutation happens."""
    turn = InterviewTurnOutput(action="propose_architecture", commands=[], summary="No change needed here.")
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Increase nothing, just checking in.", base_version["id"])

    assert result.kind == "answer"
    assert result.summary == "No change needed here."
    assert fake_repo.versions_created == []
