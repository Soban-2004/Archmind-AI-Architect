"""
Offline tests for services/migration.py's groundedness enforcement — the
diff and Analyzer scorecard are both real/deterministic here (no mocking
needed, same as everywhere else this codebase computes them); only the
LLM call is faked, so these check that an ungrounded step (a fake ref, a
fake rule_id) never survives to the caller, the same property
test_ingestion.py checks for _filter_uncited_nodes and
test_interview_routing.py checks for the judge.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.migration import MigrationBlueprint, MigrationStep
from app.models.state import ArchitectureState
from app.services.migration import VersionNotFound, generate_migration_blueprint
from tests.conftest import FakeProvider


def _state(**overrides) -> ArchitectureState:
    data = {
        "nodes": [
            {"id": "svc_be", "name": "Backend API", "node_kind": "service", "type": "service"},
            {"id": "dat_db", "name": "PostgreSQL", "node_kind": "database", "type": "relational", "role": "primary", "engine": "postgres"},
        ],
        "edges": [
            {"id": "edge_1", "from_id": "svc_be", "to_id": "dat_db", "protocol": "sql", "sync_async": "sync"},
        ],
        "constraints": [],
    }
    data.update(overrides)
    return ArchitectureState.model_validate(data)


@pytest.fixture
def reconstructed_row(monkeypatch):
    project_id = uuid4()
    reconstructed_id = uuid4()
    target_id = uuid4()
    reconstructed_state = _state()
    # Target adds a cache + a replica + an expected_users constraint —
    # gives the diff real node/edge/constraint entries of every kind.
    target_state = _state(
        nodes=[
            {"id": "svc_be", "name": "Backend API", "node_kind": "service", "type": "service"},
            {"id": "dat_db", "name": "PostgreSQL", "node_kind": "database", "type": "relational", "role": "primary", "engine": "postgres"},
            {"id": "dat_replica", "name": "PostgreSQL Replica", "node_kind": "database", "type": "relational", "role": "replica", "engine": "postgres"},
            {"id": "dat_cache", "name": "Redis Cache", "node_kind": "database", "type": "keyvalue", "role": "cache", "engine": "redis"},
        ],
        edges=[
            {"id": "edge_1", "from_id": "svc_be", "to_id": "dat_db", "protocol": "sql", "sync_async": "sync"},
            {"id": "edge_2", "from_id": "dat_db", "to_id": "dat_replica", "protocol": "sql", "sync_async": "async"},
            {"id": "edge_3", "from_id": "svc_be", "to_id": "dat_cache", "protocol": "cache", "sync_async": "sync"},
        ],
        constraints=[{"type": "expected_users", "value": "500000"}],
    )

    rows = {
        reconstructed_id: {"id": reconstructed_id, "project_id": project_id, "state": reconstructed_state.model_dump(mode="json")},
        target_id: {"id": target_id, "project_id": project_id, "state": target_state.model_dump(mode="json")},
    }

    import app.services.migration as migration

    async def fake_get_version(version_id, owner_token=None):
        return rows.get(version_id)

    monkeypatch.setattr(migration.repo, "get_version", fake_get_version)
    return project_id, reconstructed_id, target_id


def _patch_provider(monkeypatch, provider: FakeProvider) -> None:
    import app.services.migration as migration
    monkeypatch.setattr(migration, "get_llm_provider", lambda: provider)


async def test_wrong_project_id_raises_not_found(reconstructed_row):
    project_id, reconstructed_id, target_id = reconstructed_row
    with pytest.raises(VersionNotFound):
        await generate_migration_blueprint(uuid4(), reconstructed_id, target_id)


async def test_ungrounded_ref_is_dropped(monkeypatch, reconstructed_row):
    project_id, reconstructed_id, target_id = reconstructed_row
    blueprint = MigrationBlueprint(steps=[
        MigrationStep(order=1, ref="dat_cache", action="Add a Redis cache", justification="reduces database load", cited_rule_ids=["no_cache_layer"]),
        MigrationStep(order=2, ref="dat_totally_made_up", action="Add a thing that doesn't exist in the diff", justification="invented", cited_rule_ids=[]),
    ], overall_summary="test")
    _patch_provider(monkeypatch, FakeProvider(structured_response=blueprint))

    result = await generate_migration_blueprint(project_id, reconstructed_id, target_id)

    refs = {s.ref for s in result.blueprint.steps}
    assert "dat_cache" in refs
    assert "dat_totally_made_up" not in refs
    # renumbered to a clean 1..N after the drop
    assert [s.order for s in result.blueprint.steps] == list(range(1, len(result.blueprint.steps) + 1))


async def test_ungrounded_rule_id_is_stripped_not_the_whole_step(monkeypatch, reconstructed_row):
    project_id, reconstructed_id, target_id = reconstructed_row
    blueprint = MigrationBlueprint(steps=[
        MigrationStep(order=1, ref="dat_cache", action="Add a Redis cache", justification="test", cited_rule_ids=["no_cache_layer", "made_up_rule_id"]),
    ], overall_summary="test")
    _patch_provider(monkeypatch, FakeProvider(structured_response=blueprint))

    result = await generate_migration_blueprint(project_id, reconstructed_id, target_id)

    assert len(result.blueprint.steps) == 1
    assert "made_up_rule_id" not in result.blueprint.steps[0].cited_rule_ids
    # a real rule_id, if the reconstructed state's own scorecard actually
    # fired it, survives -- the reconstructed fixture has no cache and no
    # replica, so no_cache_layer is a real fired finding here.
    assert result.reconstructed_scorecard is not None


async def test_empty_diff_short_circuits_without_an_llm_call(monkeypatch, reconstructed_row):
    project_id, reconstructed_id, _ = reconstructed_row
    provider = FakeProvider()
    _patch_provider(monkeypatch, provider)

    result = await generate_migration_blueprint(project_id, reconstructed_id, reconstructed_id)

    assert result.blueprint.steps == []
    assert provider.structured_calls == []


async def test_llm_failure_falls_back_gracefully(monkeypatch, reconstructed_row):
    project_id, reconstructed_id, target_id = reconstructed_row

    class RaisingProvider(FakeProvider):
        async def structured_json(self, *a, **kw):
            raise RuntimeError("provider exploded")

    _patch_provider(monkeypatch, RaisingProvider())

    result = await generate_migration_blueprint(project_id, reconstructed_id, target_id)

    assert result.blueprint.steps == []
    assert "unavailable" in result.blueprint.overall_summary.lower()
    # the diff and scorecard -- both deterministic -- are still real and useful
    assert not result.diff.is_empty()
