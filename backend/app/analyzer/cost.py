"""
Declared monthly cost assumptions (spec §... "the moat is the model that
surrounds the LLM" — a real cost check, not just a collected-but-unchecked
budget field). Same philosophy as capacity.py: fixed, versioned, inspectable
numbers, never something the LLM estimates per-run.

v2 change: cost used to be a flat per-node-type guess — one $/mo figure per
node, completely blind to the project's actual expected_rps/expected_users.
A 3-backend fan-out behind a load balancer and a single lonely backend cost
the same. That's not "precise", it's just a constant wearing a cost label.

Now, when the caller has real per-node load (the simulator's own baseline
run — see services/analyzer.py, which is also what powers the Simulate tab),
cost scales with it: each node's instance count is
ceil(its incoming req/s ÷ its declared per-instance capacity, capacity.py),
and the monthly cost is unit_cost * instances. This reuses the exact same
capacity assumptions already shown to the user in the simulator, so a cache
that absorbs 80% of traffic, or a read replica that splits load, now
visibly reduces the *downstream* node's cost too — not just its own
utilization bar. Without load data (e.g. an empty architecture) this
degrades to the old flat 1-instance-per-node estimate.

Per-instance dollar figures are still deliberately rough, single-SMALL-
managed-instance numbers — a real bill depends on region, vendor, and
committed-use discounts this tool has no way to know. What changed in v2
was HOW MANY instances that estimate is multiplied by, not the honesty of
the per-instance number itself.

v3 (COST_VERSION) change: a node's declared `size` (analyzer/sizing.py) —
small/medium/large/xlarge, defaulting to small — now scales the per-
instance number by that tier's cost_multiplier, and a database's declared
`storage_gb` adds a separate, independent per-GB line on top. Both are
purely additive: a node that never sets either behaves exactly as before
(size defaults to small = 1.0x, storage_gb defaults to None = no line).
Every estimate is shown with its basis so it's never presented as more
precise than it actually is. Bump COST_VERSION if the per-instance/
per-GB numbers change; bump COST_MODEL_VERSION if the instance-counting
logic itself changes.

v3 change: a node's real, declared `engine` (analyzer/engines.py) now also
scales the per-instance number — before this, `engine` was stored and
shown to the user but never actually read by this calculation, so
"postgres" and "cockroachdb" cost identically despite CockroachDB's
distributed-by-default architecture being a real, meaningfully higher
cost even at "small". Composes with `size`: base * size_multiplier *
engine_multiplier. A node whose engine doesn't match anything in the
curated table gets a neutral 1.0x, same as today.
"""
from __future__ import annotations

import math

from app.analyzer.capacity import capacity_for
from app.analyzer.engines import engine_spec_for
from app.analyzer.numeric import parse_upper_bound
from app.analyzer.sizing import STORAGE_COST_PER_GB_USD, size_spec_for
from app.models.analysis import CostLineItem
from app.models.state import ArchitectureState, Node

COST_VERSION = "v3"
COST_MODEL_VERSION = "v2"  # v2: instance count derived from real load / declared capacity, not a flat 1

# Rough monthly USD for one small managed instance of each kind — the same
# "single small instance" assumption capacity.py uses for RPS, applied to
# $ instead. This is the PER-INSTANCE price; estimate_monthly_cost below is
# what multiplies it out by however many instances the load actually needs.
_MONTHLY_COST_USD: dict[str, float] = {
    "service": 25,  # one small compute instance (e.g. a $25/mo Fargate task or PaaS dyno)
    "queue": 10,
    "external_dependency": 0,  # billed by the third party directly, not part of this infra estimate
    "database:relational": 20,
    "database:document": 25,
    "database:keyvalue": 15,
    "database:search": 60,
    "database:graph": 60,
    "infra_node:cdn": 15,
    "infra_node:load_balancer": 20,
    "infra_node:api_gateway": 20,
    "infra_node:object_storage": 5,
    "infra_node:container_runtime": 30,
    "infra_node:observability": 25,
}

FALLBACK_MONTHLY_COST_USD = 20.0


def monthly_cost_for(node: Node) -> tuple[float, str]:
    """Returns (per-instance monthly_cost_usd, basis) — basis is shown to
    the user so a cost number is never presented as unexplained, mirroring
    capacity.py's capacity_for()."""
    if node.node_kind in ("database", "infra_node"):
        key = f"{node.node_kind}:{node.type}"
    else:
        key = node.node_kind

    base_cost = _MONTHLY_COST_USD.get(key, FALLBACK_MONTHLY_COST_USD)
    size = size_spec_for(node)
    engine, engine_name = engine_spec_for(node)
    cost = base_cost * size.cost_multiplier * engine.cost_multiplier

    if key not in _MONTHLY_COST_USD:
        return float(cost), f"no declared default for {key}; using fallback"

    basis = f"declared default for {key} (cost set {COST_VERSION})"
    if size.cost_multiplier != 1.0:
        basis += f"; {size.label} instance ({size.vcpu} vCPU / {size.ram_gb}GB) -> {size.cost_multiplier:g}x"
    if engine_name is not None and engine.cost_multiplier != 1.0:
        basis += f"; {engine_name} engine -> {engine.cost_multiplier:g}x"

    return float(cost), basis


def _storage_cost_for(node: Node) -> tuple[float, str | None]:
    """A database's declared `storage_gb` (None by default — most nodes
    never set it) adds its own cost line, independent of instance count:
    storage is billed by volume, not multiplied by how many compute
    instances the load happens to need this run."""
    storage_gb = getattr(node, "storage_gb", None)
    if not storage_gb:
        return 0.0, None
    cost = storage_gb * STORAGE_COST_PER_GB_USD
    return cost, f"{storage_gb}GB storage @ ${STORAGE_COST_PER_GB_USD}/GB"


def _instances_for(node: Node, load_rps: float) -> tuple[int, str | None]:
    """How many of this node's declared per-instance capacity it'd take to
    carry `load_rps` — the same capacity.py numbers already shown on the
    Simulate tab, so this stays internally consistent with what the user
    sees there. external_dependency is excluded: a third party scales
    itself, we don't provision instances of it."""
    if node.node_kind == "external_dependency" or load_rps <= 0:
        return 1, None
    capacity, _ = capacity_for(node)
    if capacity <= 0:
        return 1, None
    instances = max(1, math.ceil(load_rps / capacity))
    note = None if instances <= 1 else f"{instances}x instances sized for {load_rps:.0f} req/s at {capacity:.0f} req/s/instance"
    return instances, note


def estimate_monthly_cost(state: ArchitectureState, incoming_rps: dict[str, float] | None = None) -> tuple[float, list[CostLineItem]]:
    """`incoming_rps` (node_id -> baseline req/s) should come from a real
    simulator run at 1x with nothing killed — see services/analyzer.py.
    When omitted, every node is costed as exactly one instance (the old
    flat behavior), which is still what you get for an empty diagram or a
    node with no traffic data of its own."""
    breakdown: list[CostLineItem] = []
    total = 0.0
    for n in state.nodes:
        unit_cost, basis = monthly_cost_for(n)
        load = incoming_rps.get(n.id, 0.0) if incoming_rps is not None else 0.0
        instances, note = _instances_for(n, load)
        cost = unit_cost * instances
        storage_cost, storage_note = _storage_cost_for(n)
        cost += storage_cost

        full_basis = f"{basis}; {note}" if note else basis
        if storage_note:
            full_basis = f"{full_basis}; {storage_note}"

        breakdown.append(CostLineItem(node_id=n.id, node_name=n.name, monthly_cost_usd=round(cost, 2), basis=full_basis))
        total += cost
    return round(total, 2), breakdown


def parse_budget_ceiling(value: str) -> float | None:
    """budget_monthly_usd is stored as free text and, in every real value
    seen from the model this session, a range ("50-100", "$200-300") more
    often than a bare number — the upper bound is the more permissive
    reading of "a budget of $50-100" to check against. Thin wrapper over
    the shared parser (see numeric.py) kept so existing imports of this
    name don't need to change."""
    return parse_upper_bound(value)
