"""
Mutation engine (spec §3.2 / §3.3).

Validates a list of MutationCommands against the current ArchitectureState
and, if all valid, produces a brand new state (never mutates the parent in
place). Validation failures are returned as structured errors so the LLM
caller can retry instead of the command being silently dropped.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.analyzer.registry import check_edge_validity
from app.models.commands import (
    AddEdgeCommand,
    AddNodeCommand,
    AnnotateDecisionCommand,
    CommandValidationError,
    MutationCommand,
    RemoveEdgeCommand,
    RemoveNodeCommand,
    SetConstraintCommand,
    UpdateNodeCommand,
)
from app.models.state import (
    ADR,
    NODE_KIND_TO_MODEL,
    ArchitectureState,
    Constraint,
    Edge,
    gen_id,
)


@dataclass
class MutationResult:
    ok: bool
    state: ArchitectureState | None = None
    errors: list[CommandValidationError] = field(default_factory=list)


def _resolve(ref_or_id: str, refs: dict[str, str], working: ArchitectureState) -> str | None:
    """An edge endpoint is either a ref minted earlier in this batch, or a
    real id already present in the base state. Returns the real id, or None
    if it resolves to neither."""
    if ref_or_id in refs:
        return refs[ref_or_id]
    if ref_or_id in working.node_ids():
        return ref_or_id
    return None


def _validate_command(cmd: MutationCommand, working: ArchitectureState, refs: dict[str, str], index: int) -> CommandValidationError | None:
    if isinstance(cmd, AddNodeCommand):
        if cmd.ref in refs:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"duplicate ref '{cmd.ref}' in this batch")
        if any(n.name == cmd.name for n in working.nodes):
            return CommandValidationError(command_index=index, op=cmd.op, error=f"duplicate node name '{cmd.name}'")
        model = NODE_KIND_TO_MODEL.get(cmd.node_type)
        if model is None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"unknown node_type '{cmd.node_type}'")
        try:
            model(id=gen_id(cmd.node_type[:3]), name=cmd.name, **cmd.attributes)
        except Exception as e:  # pydantic ValidationError etc.
            return CommandValidationError(command_index=index, op=cmd.op, error=f"invalid attributes for {cmd.node_type}: {e}")

    elif isinstance(cmd, RemoveNodeCommand):
        if cmd.id not in working.node_ids():
            return CommandValidationError(command_index=index, op=cmd.op, error=f"no such node id '{cmd.id}'")

    elif isinstance(cmd, UpdateNodeCommand):
        node = working.get_node(cmd.id)
        if node is None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"no such node id '{cmd.id}'")
        try:
            node.model_copy(update=cmd.attributes)
        except Exception as e:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"invalid update attributes: {e}")

    elif isinstance(cmd, AddEdgeCommand):
        from_real_id = _resolve(cmd.from_id, refs, working)
        if from_real_id is None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"dangling edge: from_id '{cmd.from_id}' is not an existing node id or an earlier ref in this batch")
        to_real_id = _resolve(cmd.to_id, refs, working)
        if to_real_id is None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"dangling edge: to_id '{cmd.to_id}' is not an existing node id or an earlier ref in this batch")

        source_node = working.get_node(from_real_id)
        target_node = working.get_node(to_real_id)
        assert source_node is not None and target_node is not None  # just resolved above
        reason = check_edge_validity(source_node, target_node, working)
        if reason is not None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"invalid connection: {reason}")

    elif isinstance(cmd, RemoveEdgeCommand):
        if working.get_edge(cmd.id) is None:
            return CommandValidationError(command_index=index, op=cmd.op, error=f"no such edge id '{cmd.id}'")

    elif isinstance(cmd, SetConstraintCommand):
        pass  # enum + str already validated by pydantic at parse time

    elif isinstance(cmd, AnnotateDecisionCommand):
        pass

    return None


def _apply_command(cmd: MutationCommand, working: ArchitectureState, refs: dict[str, str]) -> None:
    """Mutates `working` (a scratch copy) and `refs` in place. Caller owns copy semantics."""
    if isinstance(cmd, AddNodeCommand):
        model = NODE_KIND_TO_MODEL[cmd.node_type]
        node = model(id=gen_id(cmd.node_type[:3]), name=cmd.name, **cmd.attributes)
        working.nodes.append(node)
        refs[cmd.ref] = node.id

    elif isinstance(cmd, RemoveNodeCommand):
        working.nodes = [n for n in working.nodes if n.id != cmd.id]
        working.edges = [e for e in working.edges if e.from_id != cmd.id and e.to_id != cmd.id]

    elif isinstance(cmd, UpdateNodeCommand):
        for i, n in enumerate(working.nodes):
            if n.id == cmd.id:
                working.nodes[i] = n.model_copy(update=cmd.attributes)
                break

    elif isinstance(cmd, AddEdgeCommand):
        working.edges.append(
            Edge(
                id=gen_id("edge"),
                from_id=_resolve(cmd.from_id, refs, working),
                to_id=_resolve(cmd.to_id, refs, working),
                protocol=cmd.protocol,
                sync_async=cmd.sync_async,
                notes=cmd.notes,
            )
        )

    elif isinstance(cmd, RemoveEdgeCommand):
        working.edges = [e for e in working.edges if e.id != cmd.id]

    elif isinstance(cmd, SetConstraintCommand):
        working.constraints = [c for c in working.constraints if c.type != cmd.type]
        working.constraints.append(Constraint(type=cmd.type, value=cmd.value))

    elif isinstance(cmd, AnnotateDecisionCommand):
        working.adrs.append(
            ADR(
                id=gen_id("adr"),
                decision=cmd.text,
                rationale=cmd.rationale,
                triggered_by=cmd.triggered_by,
            )
        )


def apply_commands(base_state: ArchitectureState, commands: list[MutationCommand]) -> MutationResult:
    """Validate-and-apply commands in order against a scratch copy, so a
    later command in the same batch can reference an earlier one (e.g.
    add_node then add_edge to it, via `ref`). If any command fails
    validation, the whole batch is rejected (the scratch copy is discarded)
    and every error collected so far is returned to the caller for an LLM
    retry."""
    working = base_state.model_copy(deep=True)
    refs: dict[str, str] = {}
    errors: list[CommandValidationError] = []

    for i, cmd in enumerate(commands):
        err = _validate_command(cmd, working, refs, i)
        if err:
            errors.append(err)
            continue
        _apply_command(cmd, working, refs)

    if errors:
        return MutationResult(ok=False, errors=errors)
    return MutationResult(ok=True, state=working)
