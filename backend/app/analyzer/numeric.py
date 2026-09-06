"""
Shared numeric-constraint parsing. Constraint values are stored as free
text (spec's own modeling choice — `Constraint.value: str`), and in
practice the model overwhelmingly writes them as a range ("40-80",
"$200-300") rather than a bare number, even though nothing in the schema
requires that format. Every piece of code that needs a number out of a
constraint should go through here, not hand-roll its own `float(value)`
that silently breaks on the range case — that exact bug (the simulator
falling back to a generic default because `float("40-80")` raises) shipped
once already; this is the fix, made reusable so it can't ship a second
time for a different constraint.
"""
from __future__ import annotations

import re


def parse_upper_bound(value: str) -> float | None:
    """Extracts the largest number in `value` — "40-80" -> 80, "$200-300"
    -> 300, "150" -> 150. The upper bound is the more useful reading for
    every current caller (a budget ceiling to check against, a peak
    traffic rate to simulate against) — both want "the most this could
    be", not the optimistic low end."""
    numbers = re.findall(r"[\d.]+", value)
    if not numbers:
        return None
    return float(numbers[-1])
