"""Unit tests for the Simulator engine (services/simulator.py). No prior
test file exercised run_simulation directly at all before this — added
alongside a real bug found live: a market-data external_dependency called
on every request showed "overloaded" from ordinary baseline traffic alone
(<100 rps stated peak against the old flat 100 rps external_dependency
capacity default), with the exact same alarming wording an underprovisioned
internal service gets. Pins both halves of the fix: the raised default
(capacity.py v7) and the distinct, honest finding message for a
third-party dependency (this isn't infra the architecture can scale)."""
from __future__ import annotations

from app.models.state import ArchitectureState, ConstraintType, Edge, ExternalDependency, Service
from app.services.simulator import run_simulation


def _constraint(type_, value):
    return {"type": type_, "value": value}


def _state_with_external_dependency(expected_rps: str) -> ArchitectureState:
    backend = Service(id="svc_backend", name="Backend API", type="service")
    market_api = ExternalDependency(id="ext_market", name="Market Data API", type="market_data")
    return ArchitectureState(
        nodes=[backend, market_api],
        edges=[Edge(id="e1", from_id="svc_backend", to_id="ext_market", protocol="http", sync_async="sync")],
        constraints=[_constraint(ConstraintType.expected_rps, expected_rps)],
    )


def test_external_dependency_called_on_every_request_no_longer_trips_at_stated_peak():
    """The exact real scenario: a backend that calls a third-party API on
    every request, at a stated peak of <100 rps. Rule 2's fan-out sends the
    backend's full incoming load straight to the dependency, so this used
    to land right at/over the old 100 rps default -- now comfortably under
    the raised 300 rps default (capacity.py v7)."""
    state = _state_with_external_dependency("< 100 rps")

    result = run_simulation(state, multiplier=1.0, kill_node_ids=[])

    market_load = next(l for l in result.loads if l.node_id == "ext_market")
    assert market_load.capacity_rps == 300.0
    assert market_load.status == "ok"
    assert not any(f.node_id == "ext_market" for f in result.findings)


def test_overloaded_external_dependency_gets_a_distinct_non_infra_message():
    """Push well past the raised default so it genuinely does overload --
    the finding for it must read as a third-party rate-limit risk, not the
    generic 'at X% of capacity' wording used for an internal service the
    architecture actually controls the scaling of."""
    state = _state_with_external_dependency("1000 rps")

    result = run_simulation(state, multiplier=1.0, kill_node_ids=[])

    market_load = next(l for l in result.loads if l.node_id == "ext_market")
    assert market_load.status == "overloaded"
    finding = next(f for f in result.findings if f.node_id == "ext_market")
    assert "isn't infra you can scale directly" in finding.message
    assert "third-party" in finding.message
    # And must NOT use the internal-service wording, which implies the
    # architecture itself is under-provisioned and just needs more of it.
    assert "assumed capacity" not in finding.message


def test_overloaded_internal_service_keeps_the_original_infra_wording():
    """Contrast case: an actual internal service still gets the original
    'at X% of capacity' framing, since that one genuinely is something the
    architecture can fix by adding capacity."""
    backend = Service(id="svc_backend", name="Backend API", type="service")
    state = ArchitectureState(
        nodes=[backend],
        edges=[],
        constraints=[_constraint(ConstraintType.expected_rps, "5000 rps")],
    )

    result = run_simulation(state, multiplier=1.0, kill_node_ids=[])

    finding = next(f for f in result.findings if f.node_id == "svc_backend")
    assert "assumed capacity" in finding.message
    assert "third-party" not in finding.message
