"""
Tests for the 3 node types added alongside rate limiting (state.py):
service: realtime
database: vector
external_dependency: feature_flags

Same coverage shape as test_new_node_types.py's earlier batch: every type
constructs, database:vector (the one that splits cost/capacity by `type`)
got a real declared default, its curated engines actually differentiate
the estimate, and the two substring-ordering traps this batch introduced
(pgvector vs. postgres; a recognized-but-imageless engine vs. an
unrecognized one) resolve correctly.
"""
from __future__ import annotations

from app.analyzer.capacity import FALLBACK_CAPACITY_RPS, capacity_for
from app.analyzer.cost import FALLBACK_MONTHLY_COST_USD, monthly_cost_for
from app.analyzer.docker_images import docker_image_for
from app.analyzer.engines import engine_spec_for
from app.models.state import Database, ExternalDependency, Service


def test_service_realtime_constructs():
    Service(id="s1", name="Live Chat", type="realtime")


def test_database_vector_constructs():
    Database(id="d1", name="Embeddings", type="vector", engine="qdrant")


def test_external_dependency_feature_flags_constructs():
    ExternalDependency(id="e1", name="LaunchDarkly", type="feature_flags")


def test_database_vector_has_a_real_declared_default_not_a_fallback():
    node = Database(id="d1", name="N", type="vector", engine="something_unmatched")
    capacity, cap_basis = capacity_for(node)
    cost, cost_basis = monthly_cost_for(node)
    assert capacity != FALLBACK_CAPACITY_RPS
    assert cost != FALLBACK_MONTHLY_COST_USD
    assert "no declared default" not in cap_basis
    assert "no declared default" not in cost_basis


def test_vector_engines_differentiate_the_estimate():
    """The same real bug class as the columnar-engine test in the earlier
    batch: Pinecone (managed, billed-by-the-query) and self-hosted Qdrant
    must not cost the same for the same declared type/size."""
    pinecone_cost, _ = monthly_cost_for(Database(id="d1", name="N", type="vector", engine="pinecone"))
    qdrant_cost, _ = monthly_cost_for(Database(id="d2", name="N", type="vector", engine="qdrant"))
    assert pinecone_cost != qdrant_cost


def test_pgvector_wins_over_plain_postgres_substring_match():
    """Free text like "postgres with the pgvector extension" contains
    both "postgres" and "pgvector" as substrings -- the more specific,
    more informative vector-workload match must win, in both the cost/
    capacity engine table AND the docker-image table (each has its own
    ordering to get right, found live while wiring this up)."""
    node = Database(id="d1", name="N", type="vector", engine="postgres with the pgvector extension")

    _, engine_name = engine_spec_for(node)
    assert engine_name == "pgvector"

    spec, _ = docker_image_for(node)
    assert spec is not None
    assert spec.image == "pgvector/pgvector:pg16"


def test_pinecone_has_no_local_image_but_a_real_honest_stand_in():
    node = Database(id="d1", name="N", type="vector", engine="pinecone")
    spec, note = docker_image_for(node)
    assert spec is not None  # a real stand-in (Qdrant), not a dead end
    assert spec.image == "qdrant/qdrant:latest"
    assert note and "managed serverless saas" in note.lower()


def test_milvus_is_recognized_but_honestly_has_no_single_container_image():
    """milvus IS in the curated engine vocabulary (engine_spec_for
    recognizes it for cost/capacity) but its docker-compose stand-in note
    must say WHY it has none (etcd/MinIO dependency) rather than the
    generic "not recognized" message an actually-unknown engine gets --
    the whole reason _ENGINE_NO_IMAGE_NOTES exists as a separate table
    from a bare unmatched-engine fallback."""
    node = Database(id="d1", name="N", type="vector", engine="milvus")

    _, engine_name = engine_spec_for(node)
    assert engine_name == "milvus"  # cost/capacity DOES recognize it

    spec, note = docker_image_for(node)
    assert spec is not None  # still falls back to a real default (qdrant)
    assert spec.image == "qdrant/qdrant:latest"
    assert note is not None
    assert "not recognized" not in note  # milvus IS recognized -- just has no image of its own
    assert "etcd" in note.lower()
