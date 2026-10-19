from __future__ import annotations

import pytest

from app.models.state import ConstraintType
from app.services.constraint_answers import parse_constraint_answer


@pytest.mark.parametrize(("constraint_type", "message", "expected"), [
    (ConstraintType.expected_users, "10k-100k", "10k-100k"),
    (ConstraintType.expected_users, "a few thousand users", "a few thousand users"),
    (ConstraintType.expected_rps, "1,000 RPS", "1,000 RPS"),
    (ConstraintType.availability_target, "three nines", "99.9%"),
    (ConstraintType.availability_target, "99.95%", "99.95%"),
    (ConstraintType.consistency_requirement, "ACID", "Strong consistency"),
    (ConstraintType.consistency_requirement, "depends on the feature", "Mixed by feature"),
    (ConstraintType.budget_monthly_usd, "free", "$0/month"),
    (ConstraintType.budget_monthly_usd, "500", "$500/month"),
])
def test_accepts_and_normalizes_safe_answers(constraint_type, message, expected):
    result = parse_constraint_answer(constraint_type, message)
    assert result.accepted is True
    assert result.constraint_type is constraint_type
    assert result.value == expected


@pytest.mark.parametrize("message", ["Not sure", "I don't know", "TBD", "skip"])
def test_unknown_answers_are_recorded_consistently(message):
    result = parse_constraint_answer(ConstraintType.expected_users, message)
    assert result.accepted is True
    assert result.value == "Not sure"


@pytest.mark.parametrize(("constraint_type", "message"), [
    (ConstraintType.expected_users, "a lot"),
    (ConstraintType.expected_rps, "very busy"),
    (ConstraintType.availability_target, "150%"),
    (ConstraintType.availability_target, "99.9% or 99.99%"),
    (ConstraintType.expected_users, "not sure, maybe 10k"),
    (ConstraintType.expected_users, "1k or 10k"),
    (ConstraintType.expected_rps, "100 or 1,000 RPS"),
    (ConstraintType.consistency_requirement, "fast"),
    (ConstraintType.budget_monthly_usd, "negative five dollars"),
    (ConstraintType.budget_monthly_usd, "$-5"),
    (ConstraintType.budget_monthly_usd, "₹5000/month"),
    (ConstraintType.budget_monthly_usd, "$1200/year"),
    (ConstraintType.expected_users, "why do you need this?"),
])
def test_rejects_ambiguous_or_invalid_answers(constraint_type, message):
    result = parse_constraint_answer(constraint_type, message)
    assert result.accepted is False
    assert result.error


def test_explicit_correction_is_assigned_to_named_constraint():
    result = parse_constraint_answer(ConstraintType.expected_rps, "Actually expected users are 100k")
    assert result.accepted is True
    assert result.constraint_type is ConstraintType.expected_users
    assert result.value == "Actually expected users are 100k"


def test_multiple_labelled_requirements_are_not_guessed():
    result = parse_constraint_answer(ConstraintType.expected_users, "10k users with a $100 monthly budget")
    assert result.accepted is False
    assert "one at a time" in (result.error or "")
