"""Pure, offline unit tests for services/intent_router.py — no mocking
needed, classify_intent/extract_multiplier are plain regex functions."""
from __future__ import annotations

import pytest

from app.services.intent_router import DEFAULT_ANALYSIS_MULTIPLIER, classify_intent, extract_multiplier


@pytest.mark.parametrize("message", [
    "Why do we need a load balancer?",
    "why is the API gateway there",
    "Which database should we use?",
    "should we use MongoDB for this?",
    "Do we need a cache?",
    "Explain the role of the CDN.",
    "What's the purpose of the queue?",
])
def test_classify_advisory(message):
    assert classify_intent(message) == "advisory"


@pytest.mark.parametrize("message", [
    "What happens if traffic increases 10x?",
    "what if traffic spikes?",
    "How would this handle a sudden spike?",
    "Can the system handle 10x traffic?",
    "What would happen if the database went down?",
])
def test_classify_analysis(message):
    assert classify_intent(message) == "analysis"


@pytest.mark.parametrize("message", [
    "Add a second backend.",
    "Remove Redis.",
    "Change the database to MongoDB.",
    "Why not add a cache?",  # question-shaped, but an edit verb is present -> never diverted
    "Increase the budget to $500.",
    "Which database should we add for analytics?",  # advisory-shaped opener, but "add" wins
])
def test_classify_edit_shaped_never_diverted(message):
    assert classify_intent(message) is None


@pytest.mark.parametrize("message", [
    "Tell me about the current setup.",
    "database",
    "hmm, thoughts?",
])
def test_classify_ambiguous_falls_back_to_edit_pipeline(message):
    assert classify_intent(message) is None


def test_extract_multiplier_explicit():
    assert extract_multiplier("What happens if traffic increases 10x?") == 10.0
    assert extract_multiplier("what about a 2.5x spike?") == 2.5


def test_extract_multiplier_default_when_unstated():
    assert extract_multiplier("what if traffic spikes?") == DEFAULT_ANALYSIS_MULTIPLIER
