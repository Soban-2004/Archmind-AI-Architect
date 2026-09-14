"""InterviewTurnOutput.reasoning wiring — the model's own 1-3 bullets
naming the real constraint(s)/tradeoff behind a question or an edit (see
prompts.py's single shared instruction for it), threaded through
handle_chat_turn's "question" and "architecture" ChatTurnResults and
finally the /chat route's payload. Distinct from `summary` (the short
"what changed" note) and from `quick_replies` (tap targets) — this is the
model's own visible reasoning, not narration added after the fact."""
from __future__ import annotations

from app.api.routes.chat import _result_payload
from app.models.commands import AddNodeCommand, InterviewTurnOutput
from app.services.interview import ChatTurnResult, handle_chat_turn
from tests.conftest import FakeProvider, patch_provider


async def test_question_turn_carries_the_models_reasoning_through(monkeypatch, base_version, fake_repo):
    turn = InterviewTurnOutput(
        action="ask_question",
        question="What's your availability target?",
        quick_replies=["99.9%", "99.95%", "Not sure"],
        reasoning=["$50/mo rules out a fully redundant setup on its own"],
    )
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "What about uptime?", base_version["id"])

    assert result.kind == "question"
    assert result.reasoning == ["$50/mo rules out a fully redundant setup on its own"]


async def test_architecture_turn_carries_the_models_reasoning_through(monkeypatch, base_version, fake_repo):
    commands = [AddNodeCommand(ref="q1", node_type="queue", name="Order Queue", attributes={"type": "queue", "engine": "sqs"})]
    turn = InterviewTurnOutput(
        action="propose_architecture",
        commands=commands,
        summary="Added an order queue.",
        reasoning=["Your 99.95% target needs decoupling here, and a queue is the cheapest way to get it within $50/mo"],
    )
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Add a queue for orders.", base_version["id"])

    assert result.kind == "architecture"
    assert result.reasoning == ["Your 99.95% target needs decoupling here, and a queue is the cheapest way to get it within $50/mo"]


async def test_reasoning_defaults_to_none_when_the_model_omits_it(monkeypatch, base_version, fake_repo):
    """A simple question/edit with no real tradeoff behind it -- the model
    is explicitly told to omit `reasoning` here, and the pipeline must
    carry that through as None/empty, never invent something."""
    turn = InterviewTurnOutput(action="ask_question", question="What should we call this project?")
    provider = FakeProvider(interview_response=turn)
    patch_provider(monkeypatch, provider)

    result = await handle_chat_turn(base_version["project_id"], "Let's start a new project.", base_version["id"])

    assert result.kind == "question"
    assert result.reasoning is None


def test_tier1_deterministic_edit_has_no_reasoning():
    """A Tier 1 deterministic command (services/mutation_deterministic.py)
    never calls the LLM at all -- there is no model-produced reasoning to
    carry, and _finalize's default (None) must stay None, not crash on a
    missing kwarg or silently fabricate something."""
    # Covered implicitly by every existing Tier 1 test in
    # test_interview_routing.py (none of them pass reasoning) staying
    # green — this test just pins the expectation explicitly for when
    # someone next touches _finalize's signature.
    import inspect

    from app.services import interview

    sig = inspect.signature(interview._finalize)
    assert sig.parameters["reasoning"].default is None


def test_result_payload_includes_reasoning_for_question_and_architecture():
    """Direct coverage of the wire format the frontend actually consumes
    (api/routes/chat.py's _result_payload) — both mutating and
    non-mutating-with-a-question shapes carry `reasoning`, defaulting to
    an empty list (never null) when the model didn't provide one, matching
    how quick_replies/sources already default on the same function."""
    question_payload = _result_payload(ChatTurnResult(kind="question", question="Budget?", reasoning=["a real tradeoff"]))
    assert question_payload["reasoning"] == ["a real tradeoff"]

    question_payload_empty = _result_payload(ChatTurnResult(kind="question", question="Name?"))
    assert question_payload_empty["reasoning"] == []

    architecture_payload = _result_payload(ChatTurnResult(kind="architecture", summary="Added a queue.", reasoning=["driven by the stated 99.95% target"]))
    assert architecture_payload["reasoning"] == ["driven by the stated 99.95% target"]
