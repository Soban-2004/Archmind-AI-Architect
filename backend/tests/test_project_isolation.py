"""
Tests for the new "does the caller own this project" gate added to
handle_chat_turn/direct_update_node/direct_apply_commands — the
service-layer half of per-visitor project isolation (see db/schema.sql's
`owner_token` column for the full mechanism). The actual SQL-level
ownership filtering in repository.py needs a real database to test
meaningfully (same reasoning as every other DB-touching function in this
codebase — verified live, not offline); what's unit-testable here is that
these three entry points genuinely check ownership FIRST, before falling
through to "brand new project" or any other permissive branch, using a
FakeRepo whose get_project can be told to simulate "this project exists
but isn't yours" by returning None.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.commands import AddNodeCommand
from app.services.interview import direct_apply_commands, direct_update_node, handle_chat_turn


class _NotMyProjectRepo:
    """A FakeRepo variant that always reports "not found" for
    get_project — simulating a project that's real, but owned by someone
    else's token. Everything else would raise if called, since a correct
    implementation must never get past the ownership check to reach it."""

    async def get_project(self, project_id, owner_token=None):
        return None

    async def get_version(self, *a, **kw):
        raise AssertionError("get_version must not be called once get_project already denied access")

    async def get_latest_version(self, *a, **kw):
        raise AssertionError("get_latest_version must not be called once get_project already denied access")

    async def add_message(self, *a, **kw):
        raise AssertionError("add_message must not be called once get_project already denied access")


@pytest.fixture
def not_my_project_repo(monkeypatch):
    import app.services.interview as interview

    repo = _NotMyProjectRepo()
    monkeypatch.setattr(interview.repo, "get_project", repo.get_project)
    monkeypatch.setattr(interview.repo, "get_version", repo.get_version)
    monkeypatch.setattr(interview.repo, "get_latest_version", repo.get_latest_version)
    monkeypatch.setattr(interview.repo, "add_message", repo.add_message)
    return repo


async def test_chat_on_someone_elses_project_is_rejected_before_touching_anything_else(not_my_project_repo):
    result = await handle_chat_turn(uuid4(), "add a cache", owner_token="attacker-token")
    assert result.kind == "error"
    assert "not found" in result.error


async def test_direct_node_edit_on_someone_elses_project_is_rejected(not_my_project_repo):
    result = await direct_update_node(uuid4(), uuid4(), "svc_1", {"name": "New Name"}, owner_token="attacker-token")
    assert result.kind == "error"
    assert "not found" in result.error


async def test_manual_commands_on_someone_elses_project_is_rejected(not_my_project_repo):
    result = await direct_apply_commands(
        uuid4(),
        uuid4(),
        [AddNodeCommand(ref="n1", node_type="service", name="Sneaky Service", attributes={"type": "service"})],
        owner_token="attacker-token",
    )
    assert result.kind == "error"
    assert "not found" in result.error


async def test_manual_commands_with_no_base_version_on_someone_elses_project_is_also_rejected(not_my_project_repo):
    """The trickiest case: base_version_id=None normally means "start a
    brand-new project from empty_state()" -- this confirms that path
    still checks project_id ownership first, rather than treating a
    None base_version_id as an automatic pass to attach a new version to
    ANY project_id the caller names."""
    result = await direct_apply_commands(
        uuid4(),
        None,
        [AddNodeCommand(ref="n1", node_type="service", name="Sneaky Service", attributes={"type": "service"})],
        owner_token="attacker-token",
    )
    assert result.kind == "error"
    assert "not found" in result.error
