from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.commands import AddNodeCommand, InterviewTurnOutput


def _node_command() -> AddNodeCommand:
    return AddNodeCommand(
        ref="api",
        node_type="service",
        name="API",
        attributes={"type": "service", "rationale": "Required by the product API."},
    )


@pytest.mark.parametrize("action", ["ask_question", "off_topic"])
def test_non_mutating_actions_require_a_question_and_forbid_commands(action):
    with pytest.raises(ValidationError):
        InterviewTurnOutput(action=action)
    with pytest.raises(ValidationError):
        InterviewTurnOutput(action=action, question="Question?", commands=[_node_command()])


def test_proposal_requires_commands():
    with pytest.raises(ValidationError):
        InterviewTurnOutput(action="propose_architecture", commands=[])


def test_tier_requires_commands_and_label():
    with pytest.raises(ValidationError):
        InterviewTurnOutput(action="generate_tier", commands=[_node_command()])
    with pytest.raises(ValidationError):
        InterviewTurnOutput(action="generate_tier", tier_label="$0 tier", commands=[])


def test_valid_action_shapes_still_parse():
    assert InterviewTurnOutput(action="ask_question", question="Which region?").action == "ask_question"
    assert InterviewTurnOutput(action="propose_architecture", commands=[_node_command()]).action == "propose_architecture"
    assert InterviewTurnOutput(action="generate_tier", tier_label="$0 tier", commands=[_node_command()]).action == "generate_tier"
