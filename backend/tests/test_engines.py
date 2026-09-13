"""
Unit tests for the engine-specific capacity/cost extension
(analyzer/engines.py) — a node's real, declared `engine` now actually
scales capacity_for()/monthly_cost_for(), instead of being stored and
shown but never read.
"""
from __future__ import annotations

import pytest

from app.analyzer.capacity import capacity_for
from app.analyzer.cost import monthly_cost_for
from app.analyzer.engines import ENGINE_MULTIPLIERS, engine_spec_for
from app.models.state import Database, InstanceSize, Queue


def _database(**overrides) -> Database:
    data = {"id": "db_1", "name": "DB", "type": "relational", "engine": "postgres"}
    data.update(overrides)
    return Database(**data)


def _queue(**overrides) -> Queue:
    data = {"id": "que_1", "name": "Q", "type": "queue", "engine": "sqs"}
    data.update(overrides)
    return Queue(**data)


def test_different_engines_of_the_same_type_now_produce_different_numbers():
    """The actual bug report this fixes: two engines of the same declared
    `type` must no longer be numerically indistinguishable."""
    postgres_capacity, _ = capacity_for(_database(engine="postgres"))
    cockroach_capacity, _ = capacity_for(_database(engine="cockroachdb"))
    assert postgres_capacity != cockroach_capacity

    postgres_cost, _ = monthly_cost_for(_database(engine="postgres"))
    cockroach_cost, _ = monthly_cost_for(_database(engine="cockroachdb"))
    assert postgres_cost != cockroach_cost
    assert cockroach_cost > postgres_cost  # distributed-by-default really is pricier


def test_unrecognized_engine_falls_back_to_neutral_1x():
    """A typo or obscure/invented engine name must behave EXACTLY as
    before this feature -- no silent guess about a vendor we know nothing
    about."""
    spec, matched_name = engine_spec_for(_database(engine="SomeObscureDB v9"))
    assert matched_name is None
    assert spec.capacity_multiplier == 1.0
    assert spec.cost_multiplier == 1.0

    capacity, basis = capacity_for(_database(engine="SomeObscureDB v9"))
    assert capacity == 200.0  # database:relational's unmodified base
    assert "engine" not in basis  # no fabricated engine clause


def test_specific_managed_variant_wins_over_the_generic_base_name_it_contains():
    """"Amazon Aurora PostgreSQL" contains both "aurora" and "postgres" --
    the more specific, real-cost-differentiating variant (Aurora) must
    win, not whichever string happens to be matched first naively."""
    spec, matched_name = engine_spec_for(_database(engine="Amazon Aurora PostgreSQL"))
    assert matched_name == "aurora"
    assert spec == ENGINE_MULTIPLIERS["aurora"]


def test_dynamodb_capacity_and_cost_both_scale_up_from_the_keyvalue_base():
    kv_capacity, _ = capacity_for(_database(type="keyvalue", engine="redis"))
    dynamo_capacity, basis = capacity_for(_database(type="keyvalue", engine="dynamodb"))
    assert dynamo_capacity > kv_capacity
    assert "dynamodb engine" in basis


def test_rabbitmq_queue_capacity_exceeds_the_generic_queue_base():
    sqs_capacity, _ = capacity_for(_queue(engine="sqs"))
    rabbit_capacity, _ = capacity_for(_queue(engine="rabbitmq"))
    assert rabbit_capacity > sqs_capacity


def test_engine_and_size_multipliers_compose():
    """A large CockroachDB instance should scale by BOTH multipliers, not
    just whichever one happens to apply last."""
    base_cost, _ = monthly_cost_for(_database(engine="postgres", size=InstanceSize.small))
    scaled_cost, basis = monthly_cost_for(_database(engine="cockroachdb", size=InstanceSize.large))
    cockroach_spec = ENGINE_MULTIPLIERS["cockroachdb"]
    large_spec_cost_multiplier = 3.4  # analyzer/sizing.py's InstanceSize.large.cost_multiplier
    assert scaled_cost == pytest.approx(base_cost * large_spec_cost_multiplier * cockroach_spec.cost_multiplier)
    assert "Large instance" in basis
    assert "cockroachdb engine" in basis


def test_node_kinds_with_no_engine_field_are_unaffected():
    """service/external_dependency/infra_node never carry `engine` at all
    -- engine_spec_for must default them to neutral via getattr, not
    error, matching sizing.py's size_spec_for precedent."""
    from app.models.state import InfraNode

    lb = InfraNode(id="inf_1", name="LB", type="load_balancer")
    spec, matched_name = engine_spec_for(lb)
    assert matched_name is None
    assert spec.capacity_multiplier == 1.0
