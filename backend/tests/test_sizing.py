"""
Unit tests for the compute-size/storage extension (analyzer/sizing.py) —
capacity_for()/monthly_cost_for() scaling by a node's declared `size`, and
a database's `storage_gb` adding its own independent cost line. No LLM,
no database — pure function tests against real Pydantic node models.
"""
from __future__ import annotations

from app.analyzer.capacity import capacity_for
from app.analyzer.cost import estimate_monthly_cost, monthly_cost_for
from app.analyzer.sizing import SIZE_SPECS, STORAGE_COST_PER_GB_USD
from app.models.state import ArchitectureState, Database, InfraNode, InstanceSize, Queue, Service, ServiceType


def _service(**overrides) -> Service:
    data = {"id": "svc_1", "name": "Orders API", "type": ServiceType.service}
    data.update(overrides)
    return Service(**data)


def _queue(**overrides) -> Queue:
    data = {"id": "que_1", "name": "Swipe Queue", "type": "queue", "engine": "sqs"}
    data.update(overrides)
    return Queue(**data)


def _database(**overrides) -> Database:
    data = {"id": "db_1", "name": "PostgreSQL", "type": "relational", "engine": "postgres"}
    data.update(overrides)
    return Database(**data)


def test_default_size_is_small_and_unchanged_from_v1_numbers():
    """A node that never sets `size` must produce EXACTLY the same
    capacity/cost numbers as before this feature existed — small's
    multiplier is 1.0, so this is a pure regression check."""
    svc = _service()
    assert svc.size == InstanceSize.small

    capacity, _ = capacity_for(svc)
    assert capacity == 500.0  # service's declared base capacity, untouched

    cost, _ = monthly_cost_for(svc)
    assert cost == 25.0  # service's declared base cost, untouched


def test_larger_size_scales_capacity_and_cost_by_its_declared_multiplier():
    small = _service(size=InstanceSize.small)
    large = _service(size=InstanceSize.large)

    small_capacity, _ = capacity_for(small)
    large_capacity, _ = capacity_for(large)
    assert large_capacity == small_capacity * SIZE_SPECS[InstanceSize.large].capacity_multiplier

    small_cost, _ = monthly_cost_for(small)
    large_cost, basis = monthly_cost_for(large)
    assert large_cost == small_cost * SIZE_SPECS[InstanceSize.large].cost_multiplier
    # A bigger instance should never cost MORE per unit of capacity than
    # scaling out with more small instances would -- the whole point of
    # sub-linear cost scaling.
    assert large_cost / large_capacity <= small_cost / small_capacity
    assert "Large instance" in basis
    assert "vCPU" in basis


def test_basis_stays_unchanged_for_default_small_nodes():
    """No "Small instance (1 vCPU / 2GB) -> 1x" noise for the common case
    -- the basis string should read exactly as it did before this feature,
    when the multiplier is a no-op."""
    _, basis = monthly_cost_for(_service())
    assert basis == "declared default for service (cost set v2)"
    assert "vCPU" not in basis


def test_infra_node_and_external_dependency_are_unaffected_by_sizing():
    """These node kinds never carry a `size` field at all -- size_spec_for
    must default them to small/1.0x via getattr, not error."""
    lb = InfraNode(id="inf_1", name="LB", type="load_balancer")
    capacity, _ = capacity_for(lb)
    assert capacity == 50_000.0  # unchanged from the declared base table


def test_storage_gb_adds_an_independent_cost_line():
    state = ArchitectureState(
        nodes=[_database(storage_gb=500)],
        edges=[],
        constraints=[],
        adrs=[],
    )
    total, breakdown = estimate_monthly_cost(state, incoming_rps={})
    expected_storage_cost = 500 * STORAGE_COST_PER_GB_USD
    # No traffic -> 1 instance at the base per-instance rate (20) + storage.
    assert total == 20.0 + expected_storage_cost
    assert "500GB storage" in breakdown[0].basis


def test_no_storage_gb_means_no_storage_cost_line():
    state = ArchitectureState(nodes=[_database()], edges=[], constraints=[], adrs=[])
    total, breakdown = estimate_monthly_cost(state, incoming_rps={})
    assert total == 20.0
    assert "storage" not in breakdown[0].basis.lower()


def test_size_and_load_scaling_compose():
    """A large database handling real load should cost its scaled
    per-instance rate times however many instances the load needs -- the
    two mechanisms (size multiplier, instance count) apply independently,
    not one overriding the other."""
    db = _database(size=InstanceSize.large, id="db_big")
    state = ArchitectureState(nodes=[db], edges=[], constraints=[], adrs=[])
    # database:relational base capacity 200 rps * large's 4x = 800 rps/instance.
    # 1600 rps of load -> ceil(1600/800) = 2 instances.
    total, breakdown = estimate_monthly_cost(state, incoming_rps={"db_big": 1600.0})
    base_cost = 20.0 * SIZE_SPECS[InstanceSize.large].cost_multiplier
    assert total == round(base_cost * 2, 2)
    assert "2x instances" in breakdown[0].basis


# --- v3: queue/keyvalue capacity, fact-checked against real published
# benchmarks (RabbitMQ/Kafka/SQS/Redis) and found to be off by 1-2 orders
# of magnitude -- see capacity.py's own v3 changelog comment for the real
# numbers behind these.

def test_queue_capacity_differs_by_declared_type():
    """A point-to-point queue (SQS/RabbitMQ-shaped) and a pub/sub stream
    (Kafka-shaped) are genuinely different systems -- they must no longer
    collapse to one flat "queue" capacity number the way they used to."""
    queue_capacity, _ = capacity_for(_queue(type="queue"))
    pubsub_capacity, _ = capacity_for(_queue(type="pubsub"))
    stream_capacity, _ = capacity_for(_queue(type="stream"))

    assert queue_capacity == 10_000.0
    assert pubsub_capacity == 20_000.0
    assert stream_capacity == 20_000.0
    # None of these should still be anywhere near the old, fact-checked-
    # wrong 2000 rps -- real single-node RabbitMQ/Kafka/SQS all clear it
    # by at least an order of magnitude.
    assert queue_capacity > 2_000 * 4


def test_keyvalue_database_capacity_raised_to_realistic_level():
    kv_capacity, basis = capacity_for(_database(type="keyvalue", engine="redis"))
    assert kv_capacity == 30_000.0
    # Still deliberately conservative relative to real single-instance
    # Redis benchmarks (100k+ ops/sec unpipelined) -- just no longer off
    # by two orders of magnitude the way the old 5000 rps was.
    assert kv_capacity > 5_000 * 4
    assert "capacity set v3" in basis
