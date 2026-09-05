"""
Deterministic command resolution (spec §7: 'direct commands with
unambiguous targets... resolve directly to a mutation command' — no LLM
call). Only handles the unambiguous case; anything that doesn't match falls
through to the LLM. This is intentionally small and conservative: a
false-positive deterministic match (removing the wrong node) is worse than
one extra LLM round trip.
"""
from __future__ import annotations

import re

from app.models.commands import MutationCommand, RemoveNodeCommand
from app.models.state import ArchitectureState

_REMOVE_RE = re.compile(r"^\s*(remove|delete)\s+(the\s+)?(.+?)\s*$", re.IGNORECASE)


def try_deterministic_command(message: str, state: ArchitectureState) -> tuple[MutationCommand, str] | None:
    """Returns (command, summary_text) if `message` unambiguously resolves
    to a single node removal against the current state, else None."""
    m = _REMOVE_RE.match(message)
    if not m or not state.nodes:
        return None

    target = m.group(3).strip().lower()
    exact = [n for n in state.nodes if n.name.lower() == target]
    candidates = exact or [n for n in state.nodes if target in n.name.lower()]

    if len(candidates) != 1:
        return None  # no match or ambiguous -> let the LLM handle it

    node = candidates[0]
    return RemoveNodeCommand(id=node.id), f"Removed {node.name}."
