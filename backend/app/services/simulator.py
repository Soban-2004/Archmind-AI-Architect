"""
Simulation engine (spec §6 Phase 7). Deterministic, rule-based, no LLM
(spec §7 tier 3) — a constraint-based heuristic capacity model, explicitly
NOT a discrete-event queueing simulator. Every propagation rule below is
declared and documented here; nothing is inferred at runtime.

Declared rules (the whole model, in one place):
  1. Traffic enters at nodes with no incoming edges, at the project's
     expected_rps constraint (its upper bound, if stated as a range like
     "40-80" — see _base_entry_rps; a small fallback if unset or
     unparseable), times the requested multiplier.
  2. A node forwards its FULL incoming load down EVERY outgoing edge
     (a conservative "every downstream call happens on every request"
     fan-out assumption — simpler and more conservative than guessing
     per-edge branch probabilities the schema doesn't capture).
  3. Exception: a cache-role database only forwards CACHE_MISS_RATE of
     what it receives down its own outgoing edge(s) — the rest is
     considered absorbed by the cache.
  4. Exception: a primary-role database with a direct edge to one or more
     replica-role databases shares its OWN incoming load with them —
     WRITE_SHARE always stays with the primary, and the remaining
     READ_SHARE is split evenly across every member of the group (primary
     included). This fires off the primary->replica edge itself, not off
     who calls the primary, since that's how the model actually tends to
     represent a replica in practice (a replication edge, not a second
     caller-facing query path) — confirmed by a real run where the
     earlier caller-fanout version of this rule completely missed it and
     the replica silently did nothing. This is what makes "add a read
     replica" visibly reduce the primary's load in the fix-it flow.
  5. A killed cache node's traffic bypasses it entirely, undiscounted
     (no cache means every request that would have hit it now goes
     straight to what was behind it). A killed node of any other kind
     simply stops forwarding load downstream, and anything that still
     calls it is flagged as having a failing dependency.
  6. Utilization = incoming_rps / declared capacity_rps (capacity.py).
     ok < 70%, warning 70-99.999%, overloaded >= 100%. Findings are
     ordered by utilization descending — an approximation of "what would
     likely saturate first as load ramps up", not a timed simulation.
"""
from __future__ import annotations

from app.analyzer.capacity import capacity_for
from app.analyzer.numeric import parse_upper_bound
from app.models.simulation import EdgeLoad, NodeLoad, SimulationFinding, SimulationResult
from app.models.state import ArchitectureState, ConstraintType, Edge

CACHE_MISS_RATE = 0.2
WRITE_SHARE = 0.3
READ_SHARE = 1.0 - WRITE_SHARE
FALLBACK_ENTRY_RPS = 10.0

WARNING_THRESHOLD = 70.0
OVERLOADED_THRESHOLD = 100.0


def _base_entry_rps(state: ArchitectureState) -> float:
    """expected_rps is stored as free text and, like every other numeric
    constraint the model writes, usually a range ("40-80") rather than a
    bare number — this used to silently fail to parse a range at all
    (`float("40-80")` raises) and fall back to a generic 10 rps regardless
    of what was actually stated, making every simulation run against the
    wrong baseline for any project with a range-valued constraint. Now
    goes through the same shared range parser cost.py uses, taking the
    upper bound (the more conservative "worst case" reading for a
    capacity simulation, matching the peak-load spirit of the rest of
    this model)."""
    for c in state.constraints:
        if c.type == ConstraintType.expected_rps:
            parsed = parse_upper_bound(c.value)
            if parsed is not None:
                return parsed
    return FALLBACK_ENTRY_RPS


def _bypass_killed_caches(state: ArchitectureState, killed_ids: set[str]) -> list[Edge]:
    """Rule 5: synthesize Y->X edges around a killed cache so its incoming
    traffic still reaches whatever was behind it, undiscounted."""
    synthetic: list[Edge] = []
    for node in state.nodes:
        if node.id not in killed_ids or node.node_kind != "database" or node.role != "cache":
            continue
        upstream = [e for e in state.edges if e.to_id == node.id]
        downstream = [e for e in state.edges if e.from_id == node.id]
        for u in upstream:
            if u.from_id in killed_ids:
                continue
            for d in downstream:
                if d.to_id in killed_ids:
                    continue
                synthetic.append(
                    Edge(id=f"bypass_{node.id}", from_id=u.from_id, to_id=d.to_id, protocol=d.protocol, sync_async=d.sync_async)
                )
    return synthetic


def run_simulation(state: ArchitectureState, multiplier: float, kill_node_ids: list[str]) -> SimulationResult:
    killed_ids = set(kill_node_ids)
    by_id = {n.id: n for n in state.nodes}
    active_nodes = [n for n in state.nodes if n.id not in killed_ids]

    real_edges = [e for e in state.edges if e.from_id not in killed_ids and e.to_id not in killed_ids]
    edges = real_edges + _bypass_killed_caches(state, killed_ids)

    outgoing: dict[str, list[Edge]] = {}
    incoming_count: dict[str, int] = {n.id: 0 for n in active_nodes}
    for e in edges:
        outgoing.setdefault(e.from_id, []).append(e)
        if e.to_id in incoming_count:
            incoming_count[e.to_id] += 1

    # Kahn's algorithm for a topological order; any leftover (a cycle) is
    # just appended in arbitrary order — best-effort for a heuristic tool.
    in_degree = dict(incoming_count)
    queue = [nid for nid, d in in_degree.items() if d == 0]
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for e in outgoing.get(nid, []):
            if e.to_id in in_degree:
                in_degree[e.to_id] -= 1
                if in_degree[e.to_id] == 0:
                    queue.append(e.to_id)
    for n in active_nodes:
        if n.id not in order:
            order.append(n.id)  # part of a cycle; process anyway, best-effort

    base_rps = _base_entry_rps(state) * multiplier
    incoming_rps: dict[str, float] = {n.id: 0.0 for n in active_nodes}
    edge_rps: dict[str, float] = {}
    for n in active_nodes:
        if incoming_count.get(n.id, 0) == 0:
            incoming_rps[n.id] = base_rps

    def _send(e: Edge, amount: float) -> None:
        if e.to_id in incoming_rps:
            incoming_rps[e.to_id] += amount
            edge_rps[e.id] = edge_rps.get(e.id, 0.0) + amount

    for nid in order:
        node = by_id.get(nid)
        if node is None:
            continue
        load = incoming_rps.get(nid, 0.0)
        outs = outgoing.get(nid, [])
        if not outs:
            continue

        if node.node_kind == "database" and node.role == "cache":
            for e in outs:
                _send(e, load * CACHE_MISS_RATE)
            continue

        # Rule 4: a primary shares its OWN incoming load with any replica(s)
        # it has a direct replication edge to — this fires regardless of
        # whether callers query the primary+replica directly or (far more
        # commonly, and how the LLM models it in practice) the replica only
        # appears via a primary->replica replication edge. Redistributing
        # here, at the primary, is what makes this work for both shapes.
        replica_edges = []
        if node.node_kind == "database" and node.role == "primary":
            replica_edges = [e for e in outs if by_id.get(e.to_id) and by_id[e.to_id].node_kind == "database" and by_id[e.to_id].role == "replica"]
        if replica_edges:
            group_size = 1 + len(replica_edges)
            for e in replica_edges:
                _send(e, load * (READ_SHARE / group_size))
            load = load * (WRITE_SHARE + READ_SHARE / group_size)
            incoming_rps[nid] = load  # this is what the primary itself actually bears, post-split
            outs = [e for e in outs if e not in replica_edges]

        for e in outs:
            _send(e, load)

    loads: list[NodeLoad] = []
    for n in active_nodes:
        capacity, basis = capacity_for(n)
        rps = incoming_rps.get(n.id, 0.0)
        utilization = (rps / capacity * 100) if capacity > 0 else 0.0
        status = "overloaded" if utilization >= OVERLOADED_THRESHOLD else ("warning" if utilization >= WARNING_THRESHOLD else "ok")
        loads.append(NodeLoad(node_id=n.id, node_name=n.name, incoming_rps=round(rps, 1), capacity_rps=capacity, utilization_pct=round(utilization, 1), status=status, basis=basis))
    for nid in killed_ids:
        n = by_id.get(nid)
        if n is not None:
            loads.append(NodeLoad(node_id=n.id, node_name=n.name, incoming_rps=0.0, capacity_rps=0.0, utilization_pct=0.0, status="killed", basis="removed by scenario"))

    edge_loads = [
        EdgeLoad(edge_id=e.id, from_id=e.from_id, to_id=e.to_id, rps=round(edge_rps.get(e.id, 0.0), 1))
        for e in state.edges
        if e.id in edge_rps
    ]

    findings: list[SimulationFinding] = []
    overloaded = sorted([l for l in loads if l.status == "overloaded"], key=lambda l: l.utilization_pct, reverse=True)
    for i, l in enumerate(overloaded, start=1):
        node = by_id.get(l.node_id)
        if node is not None and node.node_kind == "external_dependency":
            # Deliberately different wording: an "overloaded" internal
            # service means the architecture under-provisioned itself,
            # fixable by adding capacity. An external_dependency has no
            # instance count this architecture controls at all (see
            # cost.py) — this number is a rough stand-in for a vendor's
            # real rate limit, which this tool has no way to know, so the
            # honest framing is "you may be calling this more than its
            # plan allows", with a fix that's about call pattern (caching,
            # smoothing bursts, a higher-tier plan), not "scale it up".
            message = (
                f"{l.node_name} may be called faster than a typical third-party API plan allows — "
                f"projected {l.incoming_rps:.0f} req/s against an assumed {l.capacity_rps:.0f} req/s ceiling "
                f"({l.basis}). This isn't infra you can scale directly: consider caching its responses, "
                f"smoothing bursts through a queue, or confirming the vendor's real rate limit for your plan."
            )
        else:
            message = f"{l.node_name} is at {l.utilization_pct:.0f}% of its assumed capacity ({l.capacity_rps:.0f} req/s, {l.basis}) — projected incoming load is {l.incoming_rps:.0f} req/s."
        findings.append(SimulationFinding(order=i, node_id=l.node_id, node_name=l.node_name, message=message))

    next_order = len(overloaded) + 1
    for e in state.edges:
        if e.to_id in killed_ids and e.from_id not in killed_ids:
            caller = by_id.get(e.from_id)
            target = by_id.get(e.to_id)
            if caller and target and target.role != "cache":
                findings.append(SimulationFinding(
                    order=next_order, node_id=caller.id, node_name=caller.name,
                    message=f"{caller.name} calls {target.name}, which is killed in this scenario — those requests have no fallback modeled and would fail.",
                ))
                next_order += 1

    scenario_parts = []
    if multiplier != 1.0:
        scenario_parts.append(f"{multiplier:g}x traffic")
    if killed_ids:
        scenario_parts.append("killing " + ", ".join(by_id[i].name for i in killed_ids if i in by_id))
    scenario = "; ".join(scenario_parts) or "baseline traffic"

    return SimulationResult(scenario=scenario, multiplier=multiplier, killed_node_ids=list(killed_ids), loads=loads, edge_loads=edge_loads, findings=findings)
