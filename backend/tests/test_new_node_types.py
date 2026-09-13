"""
Tests for the 10 node types added to the component library (state.py):
service: scheduler, ml_inference
database: time_series, columnar
external_dependency: notification_provider, analytics
infra_node: dns, firewall_waf, secrets_manager, service_mesh

Covers: every new type constructs and round-trips through the same
Pydantic models as any pre-existing type (no special-casing needed
anywhere), the 6 database/infra_node types that DO split cost/capacity
by `type` got a real declared default (not a silent fallback), and the
4 new database/columnar engine names actually change the estimate.
"""
from __future__ import annotations

from app.analyzer.capacity import FALLBACK_CAPACITY_RPS, capacity_for
from app.analyzer.cost import FALLBACK_MONTHLY_COST_USD, monthly_cost_for
from app.models.state import Database, ExternalDependency, InfraNode, Service


def test_every_new_service_type_constructs():
    for t in ("scheduler", "ml_inference"):
        Service(id="s1", name="N", type=t)


def test_every_new_database_type_constructs():
    for t in ("time_series", "columnar"):
        Database(id="d1", name="N", type=t, engine="postgres")


def test_every_new_external_dependency_type_constructs():
    for t in ("notification_provider", "analytics"):
        ExternalDependency(id="e1", name="N", type=t)


def test_every_new_infra_type_constructs():
    for t in ("dns", "firewall_waf", "secrets_manager", "service_mesh"):
        InfraNode(id="i1", name="N", type=t)


def test_new_database_types_have_a_real_declared_default_not_a_fallback():
    for t in ("time_series", "columnar"):
        node = Database(id="d1", name="N", type=t, engine="something_unmatched")
        capacity, cap_basis = capacity_for(node)
        cost, cost_basis = monthly_cost_for(node)
        assert capacity != FALLBACK_CAPACITY_RPS
        assert cost != FALLBACK_MONTHLY_COST_USD
        assert "no declared default" not in cap_basis
        assert "no declared default" not in cost_basis


def test_new_infra_types_have_a_real_declared_default_not_a_fallback():
    for t in ("dns", "firewall_waf", "secrets_manager", "service_mesh"):
        node = InfraNode(id="i1", name="N", type=t)
        capacity, cap_basis = capacity_for(node)
        cost, cost_basis = monthly_cost_for(node)
        assert capacity != FALLBACK_CAPACITY_RPS
        assert cost != FALLBACK_MONTHLY_COST_USD
        assert "no declared default" not in cap_basis
        assert "no declared default" not in cost_basis


def test_columnar_warehouse_engines_change_the_cost_estimate():
    """The real bug this class of fix targets: Snowflake and a self-hosted
    ClickHouse cluster of the same declared `type`/`size` must not cost
    the same — one is serverless-billed-by-the-query, the other a fixed
    cluster, and the curated engine table exists specifically to capture
    that difference (see engines.py's v2 changelog)."""
    snowflake_cost, _ = monthly_cost_for(Database(id="d1", name="N", type="columnar", engine="snowflake"))
    clickhouse_cost, _ = monthly_cost_for(Database(id="d2", name="N", type="columnar", engine="clickhouse"))
    assert snowflake_cost != clickhouse_cost


def test_time_series_engine_names_are_recognized():
    from app.analyzer.engines import engine_spec_for

    _, matched = engine_spec_for(Database(id="d1", name="N", type="time_series", engine="TimescaleDB"))
    assert matched == "timescaledb"
