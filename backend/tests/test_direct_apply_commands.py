"""
Tests for services/interview.py's direct_apply_commands — the manual-
canvas-edit path (add a node, drag-connect, delete) that goes through the
exact same MutationCommand validation as a chat edit, with no LLM call.
"""
from __future__ import annotations

from uuid import uuid4

from app.models.commands import AddEdgeCommand, AddNodeCommand, RemoveEdgeCommand, RemoveNodeCommand, UpdateNodeCommand
from app.services.interview import direct_apply_commands


async def test_add_node_creates_a_real_versioned_change(fake_repo, base_version, state):
    commands = [AddNodeCommand(ref="cache", node_type="database", name="Redis Cache", attributes={"type": "keyvalue", "engine": "redis"})]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    assert result.version["parent_version_id"] == base_version["id"]
    new_state = result.version["state"]
    assert any(n["name"] == "Redis Cache" for n in new_state["nodes"])
    # A meaningful edit with no explicit annotate_decision still gets a
    # real, deterministic ADR (build_templated_decision), same guarantee
    # a chat edit already has.
    assert len(fake_repo.versions_created) == 1


async def test_add_node_and_connect_it_in_one_batch(fake_repo, base_version, state):
    """A palette-add followed immediately by a drag-connect is naturally
    one batch, using `ref` to wire the edge to the not-yet-real node id --
    exactly the same mechanism the LLM's own multi-command batches use."""
    commands = [
        AddNodeCommand(ref="cache", node_type="database", name="Redis Cache", attributes={"type": "keyvalue", "engine": "redis"}),
        AddEdgeCommand(from_id="svc_be", to_id="cache", protocol="cache", sync_async="sync"),
    ]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    new_state = result.version["state"]
    cache_node = next(n for n in new_state["nodes"] if n["name"] == "Redis Cache")
    assert any(e["from_id"] == "svc_be" and e["to_id"] == cache_node["id"] for e in new_state["edges"])


async def test_invalid_connection_is_rejected_same_as_a_chat_edit_would_be(fake_repo, base_version, state):
    """A manually-drawn edge that violates the connectivity registry (here:
    the backend calling back into its own fronting load balancer, which
    registry.py's rule 3 rejects as backwards/circular) must be rejected
    through the exact same check_edge_validity a chat-proposed edge goes
    through -- no side channel that bypasses that guarantee just because
    a human drew it."""
    commands = [AddEdgeCommand(from_id="svc_be", to_id="inf_lb", protocol="http", sync_async="sync")]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "error"
    assert fake_repo.versions_created == []


async def test_remove_node_also_removes_its_edges(fake_repo, base_version, state):
    commands = [RemoveNodeCommand(id="inf_lb")]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    new_state = result.version["state"]
    assert all(n["id"] != "inf_lb" for n in new_state["nodes"])
    assert all(e["from_id"] != "inf_lb" and e["to_id"] != "inf_lb" for e in new_state["edges"])


async def test_remove_edge(fake_repo, base_version, state):
    commands = [RemoveEdgeCommand(id="edge_1")]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    assert all(e["id"] != "edge_1" for e in result.version["state"]["edges"])


async def test_empty_command_list_is_a_clean_error_not_a_no_op_version(fake_repo, base_version, state):
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], [])
    assert result.kind == "error"
    assert fake_repo.versions_created == []


async def test_unknown_base_version_is_a_clean_error(fake_repo, base_version, state):
    result = await direct_apply_commands(base_version["project_id"], uuid4(), [RemoveNodeCommand(id="inf_lb")])
    assert result.kind == "error"


async def test_none_base_version_starts_a_genuinely_new_project_from_scratch(fake_repo, base_version):
    """The one real gap found live: a brand-new project has no version at
    all until something creates the first one -- the very first manual
    add_node has to start from empty_state() with no parent, exactly like
    a project's first chat-proposed architecture already does (kind
    "initial", not "edit")."""
    commands = [AddNodeCommand(ref="fe", node_type="service", name="Frontend", attributes={"type": "frontend"})]
    result = await direct_apply_commands(base_version["project_id"], None, commands)

    assert result.kind == "architecture"
    assert result.version["parent_version_id"] is None
    assert result.version["kind"] == "initial"
    assert [n["name"] for n in result.version["state"]["nodes"]] == ["Frontend"]


async def test_rationale_round_trips_through_add_node(fake_repo, base_version, state):
    """A manually-added node can carry its own rationale (AddNodeMenu's
    optional "Why" textarea) through the exact same attributes dict the
    LLM's add_node already uses -- no separate field, no separate code path."""
    commands = [
        AddNodeCommand(
            ref="cache",
            node_type="database",
            name="Redis Cache",
            attributes={"type": "keyvalue", "engine": "redis", "rationale": "Caches session lookups to keep p95 under the 50ms latency target."},
        )
    ]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    cache_node = next(n for n in result.version["state"]["nodes"] if n["name"] == "Redis Cache")
    assert cache_node["rationale"] == "Caches session lookups to keep p95 under the 50ms latency target."


async def test_rationale_is_none_when_omitted_never_auto_backfilled(fake_repo, base_version, state):
    """A manually-added node with no "Why" text stays rationale=None --
    this path is deliberately LLM-free, so there's nothing that could fill
    it in on the person's behalf."""
    commands = [AddNodeCommand(ref="worker", node_type="service", name="Email Worker", attributes={"type": "worker"})]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    worker_node = next(n for n in result.version["state"]["nodes"] if n["name"] == "Email Worker")
    assert worker_node["rationale"] is None


async def test_rationale_round_trips_through_update_node(fake_repo, base_version, state):
    """Editing an existing node's rationale (NodeDetailCard's multiline
    field) goes through the same update_node attributes dict as every
    other editable field."""
    commands = [UpdateNodeCommand(id="svc_be", attributes={"rationale": "Owns order placement; split from the monolith once checkout traffic needed independent scaling."})]
    result = await direct_apply_commands(base_version["project_id"], base_version["id"], commands)

    assert result.kind == "architecture"
    be_node = next(n for n in result.version["state"]["nodes"] if n["id"] == "svc_be")
    assert be_node["rationale"] == "Owns order placement; split from the monolith once checkout traffic needed independent scaling."
