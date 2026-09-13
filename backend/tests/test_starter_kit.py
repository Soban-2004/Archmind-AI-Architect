"""
Tests for services/starter_kit.py (the ARCHITECTURE.md / AI_BRIEF.md /
docker-compose.yml / .env.example export) and its docker_images.py table.
"""
from __future__ import annotations

import zipfile
from io import BytesIO

from app.analyzer.docker_images import docker_image_for
from app.models.state import ArchitectureState, Database, InfraNode, Service, empty_state
from app.services.starter_kit import build_order, build_starter_kit_files, build_starter_kit_zip, slugify


def _state() -> ArchitectureState:
    return ArchitectureState.model_validate(
        {
            "nodes": [
                {"id": "fe", "name": "Frontend", "node_kind": "service", "type": "frontend", "rationale": "client app"},
                {"id": "be", "name": "API", "node_kind": "service", "type": "service", "rationale": "core logic"},
                {"id": "db", "name": "Primary DB", "node_kind": "database", "type": "relational", "engine": "postgres", "role": "primary", "rationale": "stores orders"},
                {"id": "cache", "name": "Session Cache", "node_kind": "database", "type": "keyvalue", "engine": "redis", "role": "cache"},
                {"id": "ext", "name": "Stripe", "node_kind": "external_dependency", "type": "payment", "criticality": "hard"},
            ],
            "edges": [
                {"id": "e1", "from_id": "fe", "to_id": "be", "protocol": "http", "sync_async": "sync"},
                {"id": "e2", "from_id": "be", "to_id": "db", "protocol": "sql", "sync_async": "sync"},
                {"id": "e3", "from_id": "be", "to_id": "cache", "protocol": "cache", "sync_async": "sync"},
                {"id": "e4", "from_id": "be", "to_id": "ext", "protocol": "http", "sync_async": "sync"},
            ],
            "constraints": [{"type": "budget_monthly_usd", "value": "100"}],
        }
    )


def test_slugify():
    assert slugify("Stock Hinge!!") == "stock-hinge"
    assert slugify("") == "architecture"


def test_build_order_puts_callees_before_callers():
    """The real bug this exists to prevent: a build plan that tells you to
    build the frontend before the API it calls, or the API before the
    database it needs, is worse than useless -- it's actively wrong
    advice. Every callee must appear strictly before every one of its
    callers."""
    order = [n.id for n in build_order(_state())]
    assert order.index("db") < order.index("be")
    assert order.index("cache") < order.index("be")
    assert order.index("ext") < order.index("be")
    assert order.index("be") < order.index("fe")


def test_build_order_never_drops_a_node_even_with_a_cycle():
    state = ArchitectureState.model_validate(
        {
            "nodes": [
                {"id": "a", "name": "A", "node_kind": "service", "type": "service"},
                {"id": "b", "name": "B", "node_kind": "service", "type": "service"},
            ],
            "edges": [
                {"id": "e1", "from_id": "a", "to_id": "b", "protocol": "http", "sync_async": "sync"},
                {"id": "e2", "from_id": "b", "to_id": "a", "protocol": "http", "sync_async": "sync"},
            ],
        }
    )
    order = build_order(state)
    assert {n.id for n in order} == {"a", "b"}
    assert len(order) == 2


def test_build_order_on_empty_architecture():
    assert build_order(empty_state()) == []


def test_architecture_md_includes_rationale_edges_constraints_and_cost():
    files = build_starter_kit_files(_state(), "Test Project")
    md = files["ARCHITECTURE.md"]
    assert "client app" in md  # a real rationale, not omitted
    assert "core logic" in md
    assert "budget monthly usd" in md.lower()
    assert "Frontend" in md and "API" in md
    assert "Estimated cost" in md
    assert "not a real quote" in md  # never overclaims precision


def test_ai_brief_md_lists_build_order_and_service_sections():
    files = build_starter_kit_files(_state(), "Test Project")
    brief = files["AI_BRIEF.md"]
    assert "Suggested build order" in brief
    assert "Per-service responsibilities" in brief
    assert "External integrations to wire in" in brief
    assert "Stripe" in brief


def test_docker_compose_has_real_image_for_postgres_and_redis():
    files = build_starter_kit_files(_state(), "Test Project")
    compose = files["docker-compose.yml"]
    assert "postgres:16-alpine" in compose
    assert "redis:7-alpine" in compose
    # service nodes must never get a fabricated image -- only a commented placeholder
    assert "frontend:" not in compose.replace("# frontend:", "")  # the only occurrence is the commented one
    assert "# api:" in compose
    # external_dependency never gets a container -- nothing to run locally for
    # a third party. "stripe" legitimately appears inside API's commented
    # depends_on list; what must NOT appear is an actual, uncommented
    # top-level "  stripe:" service block.
    assert "\n  stripe:\n" not in compose


def test_env_example_derives_real_connection_vars_from_edges():
    files = build_starter_kit_files(_state(), "Test Project")
    env = files[".env.example"]
    assert "API_PRIMARY_DB_URL=" in env
    assert "API_SESSION_CACHE_URL=" in env
    assert "STRIPE_API_KEY=" in env
    # never a filled-in fake credential
    assert "API_PRIMARY_DB_URL=postgres" not in env


def test_zip_contains_exactly_the_four_files():
    zip_bytes = build_starter_kit_zip(_state(), "Test Project")
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
    assert names == {"ARCHITECTURE.md", "AI_BRIEF.md", "docker-compose.yml", ".env.example"}


def test_empty_architecture_does_not_crash():
    files = build_starter_kit_files(empty_state(), "Empty")
    assert all(isinstance(v, str) for v in files.values())


def test_docker_image_for_service_node_returns_none():
    """A service node has no real image this system could name -- must
    never silently fabricate one."""
    node = Service(id="s1", name="API", type="service")
    spec, note = docker_image_for(node)
    assert spec is None


def test_docker_image_for_known_engine_matches():
    node = Database(id="d1", name="DB", type="relational", engine="postgres")
    spec, note = docker_image_for(node)
    assert spec is not None
    assert spec.image == "postgres:16-alpine"


def test_docker_image_for_cloud_only_infra_type_returns_none_with_reason():
    node = InfraNode(id="i1", name="Mesh", type="service_mesh")
    spec, note = docker_image_for(node)
    assert spec is None
    assert note and "kubernetes" in note.lower()


def test_docker_image_for_unmatched_engine_falls_back_to_the_type_default_not_a_crash():
    """An engine name this table doesn't recognize (a typo, something
    obscure, something the LLM invented) still gets a real, honestly-
    noted type-level default -- e.g. every relational database falls
    back to postgres -- rather than silently guessing or throwing. The
    note says so explicitly, it's never presented as a confirmed match."""
    node = Database(id="d1", name="DB", type="relational", engine="some_made_up_engine_xyz")
    spec, note = docker_image_for(node)
    assert spec is not None
    assert spec.image == "postgres:16-alpine"
    assert note and "not recognized" in note  # honest about WHY this default was used, not silently swapped in
