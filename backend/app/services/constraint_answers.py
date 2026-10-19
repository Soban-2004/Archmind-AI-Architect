"""Deterministic validation for the zero-token requirements checklist.

Natural language is unbounded, so this module does not pretend a regex can
understand every possible reply. It accepts only answers that are safe to
assign to the pending constraint. Everything else returns a useful
clarification and leaves the architecture state unchanged.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.state import ConstraintType


@dataclass(frozen=True)
class ConstraintAnswer:
    accepted: bool
    value: str | None = None
    constraint_type: ConstraintType | None = None
    error: str | None = None


_UNKNOWN_RE = re.compile(
    r"^(?:not sure|unsure|unknown|i (?:do not|don't) know|no idea|tbd|"
    r"to be decided|decide later|estimate later|skip|prefer not to say)[.!]*$",
    re.IGNORECASE,
)
_UNKNOWN_PHRASE_RE = re.compile(r"\b(?:not sure|unsure|unknown|i (?:do not|don't) know|no idea|tbd)\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"(?<![-\w])\d+(?:[.,]\d+)?\s*(?:k|m|b|thousand|million|billion)?\b", re.IGNORECASE)
_RANGE_RE = re.compile(r"\d[\d,.]*\s*(?:k|m|b)?\s*(?:-|–|—|to)\s*\d[\d,.]*\s*(?:k|m|b)?", re.IGNORECASE)
_USER_WORD_RE = re.compile(r"\b(users?|customers?|members?|accounts?|tenants?|dau|mau|active users?)\b", re.IGNORECASE)
_RPS_RE = re.compile(r"\b(rps|qps|tps|req(?:uest)?s?\s*/\s*(?:s|sec(?:ond)?s?)|requests? per second)\b", re.IGNORECASE)
_AVAILABILITY_RE = re.compile(r"\b(availability|uptime|sla|slo)\b", re.IGNORECASE)
_CONSISTENCY_RE = re.compile(
    r"\b(strong(?:ly)? consistent|strong consistency|eventual(?:ly)? consistent|eventual consistency|"
    r"mixed(?: by feature)?|both|depends(?: on (?:the )?feature)?|acid|read[- ]after[- ]write)\b",
    re.IGNORECASE,
)
_BUDGET_RE = re.compile(r"(?:[$€£₹]|\b(?:usd|eur|gbp|inr)\b|\b(?:budget|spend|per month|monthly|/mo)\b)", re.IGNORECASE)
_QUESTION_RE = re.compile(r"(?:\?|^\s*(?:why|what|how|when|where|which|can|could|should|do|does|is|are|explain|help)\b)", re.IGNORECASE)
_QUESTION_START_RE = re.compile(r"^\s*(?:why|what|how|when|where|which|can|could|should|do|does|is|are|explain|help)\b", re.IGNORECASE)


def _clean(message: str) -> str:
    return " ".join(message.strip().split())


def _unknown(message: str) -> bool:
    return bool(_UNKNOWN_RE.fullmatch(_clean(message)))


def _explicit_types(message: str) -> set[ConstraintType]:
    """Return constraint types explicitly named by a reply.

    Signals stay narrow. This is used only to prevent an explicit correction
    such as "actually budget is $100" from being stored as the pending RPS.
    """
    found: set[ConstraintType] = set()
    if _USER_WORD_RE.search(message):
        found.add(ConstraintType.expected_users)
    if _RPS_RE.search(message):
        found.add(ConstraintType.expected_rps)
    if _AVAILABILITY_RE.search(message) or "%" in message or re.search(r"\b(?:two|three|four|five) nines\b", message, re.I):
        found.add(ConstraintType.availability_target)
    if _CONSISTENCY_RE.search(message) or re.search(r"\bconsistency\b", message, re.I):
        found.add(ConstraintType.consistency_requirement)
    if _BUDGET_RE.search(message):
        found.add(ConstraintType.budget_monthly_usd)
    return found


def _invalid(expected: ConstraintType, detail: str) -> ConstraintAnswer:
    return ConstraintAnswer(False, constraint_type=expected, error=detail)


def _validate_for(expected: ConstraintType, message: str) -> ConstraintAnswer:
    value = _clean(message)
    lower = value.lower()
    if not value:
        return _invalid(expected, "Please enter an answer or choose Not sure.")
    if len(value) > 240:
        return _invalid(expected, "Please give a short value for this requirement; you can add the longer explanation after the first design.")
    if _unknown(value):
        return ConstraintAnswer(True, "Not sure", expected)
    if _UNKNOWN_PHRASE_RE.search(value):
        return _invalid(expected, "Choose either a concrete value or Not sure so I do not store a conflicting answer.")

    if expected is ConstraintType.expected_users:
        if _RPS_RE.search(value) or "%" in value or _BUDGET_RE.search(value) or _CONSISTENCY_RE.search(value):
            return _invalid(expected, "That looks like a different requirement. Give an active-user estimate such as 1,000 or 10k-100k.")
        numbers = _NUMBER_RE.findall(value)
        if len(numbers) > 1 and not _RANGE_RE.search(value):
            return _invalid(expected, "Choose one user estimate or one range rather than several alternatives.")
        if numbers or _RANGE_RE.search(value) or re.search(r"\b(?:hundred|hundreds|thousand|thousands|million|millions|billion|billions)\b", value, re.I):
            return ConstraintAnswer(True, value, expected)
        return _invalid(expected, "Give an active-user estimate or range, such as 1,000, 10k-100k, or Not sure.")

    if expected is ConstraintType.expected_rps:
        if "%" in value or _BUDGET_RE.search(value) or _CONSISTENCY_RE.search(value):
            return _invalid(expected, "That looks like a different requirement. Give a peak rate such as 50 req/s or 1,000 RPS.")
        numbers = _NUMBER_RE.findall(value)
        if len(numbers) > 1 and not _RANGE_RE.search(value):
            return _invalid(expected, "Choose one peak rate or one range rather than several alternatives.")
        if numbers or _RANGE_RE.search(value):
            return ConstraintAnswer(True, value, expected)
        return _invalid(expected, "Give a peak request rate, such as 50 req/s, 100-1,000 RPS, or Not sure.")

    if expected is ConstraintType.availability_target:
        if re.search(r"\bbest[- ]?effort\b", value, re.I):
            return ConstraintAnswer(True, "Best effort", expected)
        nines = re.search(r"\b(two|three|four|five) nines\b", value, re.I)
        if nines:
            mapped = {"two": "99%", "three": "99.9%", "four": "99.99%", "five": "99.999%"}
            return ConstraintAnswer(True, mapped[nines.group(1).lower()], expected)
        numeric_values = re.findall(r"-?\d+(?:\.\d+)?", value)
        percentages = re.findall(r"(-?\d+(?:\.\d+)?)\s*%", value)
        if len(numeric_values) > 1:
            return _invalid(expected, "Choose one availability target, such as 99.9%, or select Not sure.")
        if len(percentages) == 1:
            pct = float(percentages[0])
            if 0 < pct <= 100:
                return ConstraintAnswer(True, f"{percentages[0]}%", expected)
            return _invalid(expected, "Availability must be above 0% and no more than 100%.")
        if len(percentages) > 1:
            return _invalid(expected, "Choose one availability target, such as 99.9%, or select Not sure.")
        return _invalid(expected, "Give one availability target, such as Best effort, 99.9%, or Not sure.")

    if expected is ConstraintType.consistency_requirement:
        if re.search(r"\b(?:strong(?:ly)? consistent|strong consistency|acid|read[- ]after[- ]write)\b", value, re.I):
            return ConstraintAnswer(True, "Strong consistency", expected)
        if re.search(r"\b(?:eventual(?:ly)? consistent|eventual consistency)\b", value, re.I):
            return ConstraintAnswer(True, "Eventual consistency", expected)
        if re.search(r"\b(?:mixed(?: by feature)?|both|depends(?: on (?:the )?feature)?)\b", value, re.I):
            return ConstraintAnswer(True, "Mixed by feature", expected)
        return _invalid(expected, "Choose Strong consistency, Eventual consistency, Mixed by feature, or Not sure.")

    if expected is ConstraintType.budget_monthly_usd:
        if re.search(r"\b(?:free|zero|no budget)\b", value, re.I):
            return ConstraintAnswer(True, "$0/month", expected)
        if re.search(r"[€£₹]|\b(?:eur|gbp|inr)\b", value, re.I):
            return _invalid(expected, "This budget field uses USD. Give the monthly USD equivalent, or choose Not sure.")
        if re.search(r"\b(?:annual(?:ly)?|per year|a year|yearly|one[- ]time|per week|weekly|per day|daily)\b|/(?:yr|year|week|day)\b", value, re.I):
            return _invalid(expected, "Convert this to a monthly USD amount so the architecture does not treat a yearly or one-time figure as monthly.")
        if re.search(r"(?:^|\s|[$€£₹])-\s*\d", value):
            return _invalid(expected, "Budget cannot be negative.")
        if _NUMBER_RE.search(value):
            # The product currently asks and models this constraint in USD.
            # Preserve explicit currencies and periods; otherwise make the
            # UI's dollar/month assumption explicit in stored state.
            if not _BUDGET_RE.search(value):
                value = f"${value}/month"
            return ConstraintAnswer(True, value, expected)
        return _invalid(expected, "Give a monthly amount or range, such as $25, $100-500, $0, or Not sure.")

    return ConstraintAnswer(True, value, expected)


def parse_constraint_answer(expected: ConstraintType, message: str) -> ConstraintAnswer:
    """Validate a checklist reply or a clearly labelled correction.

    If exactly one *other* constraint is explicitly named, validate it as a
    correction and leave the pending question pending. If several types are
    mixed together, ask for one answer at a time rather than guessing which
    values belong to which fields.
    """
    explicit = _explicit_types(message)
    if len(explicit) > 1:
        return _invalid(expected, "I found several requirements in that reply. Please answer one at a time so I do not assign a value to the wrong field.")
    if len(explicit) == 1:
        named = next(iter(explicit))
        if named is not expected:
            corrected = _validate_for(named, message)
            if corrected.accepted:
                return corrected
            return _invalid(expected, corrected.error or "Please give one clear requirement value.")

    parsed = _validate_for(expected, message)
    if not parsed.accepted and _QUESTION_RE.search(message):
        return _invalid(expected, "I can explain this after the checklist. For now, choose one of the options or enter a value; use Not sure if you do not know yet.")
    return parsed


def is_constraint_question(message: str) -> bool:
    """True when a checklist reply is asking for an explanation."""
    return bool(_QUESTION_START_RE.search(message) and "?" in message)
