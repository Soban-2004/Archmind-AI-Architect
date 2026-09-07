"""
Declared capacity assumptions for the Simulator (spec §6 Phase 7). Every
number here is a documented guess, not measured data — the point is that
it's a FIXED, versioned, inspectable assumption, not something the LLM
invents per run. Bump CAPACITY_VERSION if these numbers change.

These are deliberately round, conservative, order-of-magnitude figures for
a single SMALL instance of each kind — a real system's actual ceiling
depends on hardware, query complexity, and tuning this tool has no way to
know. Treat every simulation output as "given these assumptions", never as
a real capacity prediction.

v2 change: that "small instance" assumption is no longer unconditional — a
node's declared `size` (see analyzer/sizing.py) scales the number by that
tier's capacity_multiplier. A node that never sets `size` defaults to
small (multiplier 1.0), so this is purely additive: every number below is
still exactly what a "small" node gets, unchanged.
"""
from __future__ import annotations

from app.analyzer.sizing import size_spec_for
from app.models.state import Node

CAPACITY_VERSION = "v2"

# requests/sec a single small instance of each kind is assumed to
# saturate at, absent any other signal from the graph
_DEFAULT_CAPACITY_RPS: dict[str, float] = {
    "service": 500,
    "queue": 2000,
    "external_dependency": 100,
    "database:relational": 200,
    "database:document": 400,
    "database:keyvalue": 5000,
    "database:search": 500,
    "database:graph": 200,
    "infra_node:cdn": 100_000,
    "infra_node:load_balancer": 50_000,
    "infra_node:api_gateway": 20_000,
    "infra_node:object_storage": 10_000,
    "infra_node:container_runtime": 5_000,
    "infra_node:observability": 100_000,  # not request-serving in the traffic-path sense
}

FALLBACK_CAPACITY_RPS = 500.0


def capacity_for(node: Node) -> tuple[float, str]:
    """Returns (capacity_rps, basis) — basis is shown to the user so a
    capacity number is never presented as unexplained."""
    if node.node_kind in ("database", "infra_node"):
        key = f"{node.node_kind}:{node.type}"
    else:
        key = node.node_kind

    base_capacity = _DEFAULT_CAPACITY_RPS.get(key, FALLBACK_CAPACITY_RPS)
    spec = size_spec_for(node)
    capacity = base_capacity * spec.capacity_multiplier

    if key not in _DEFAULT_CAPACITY_RPS:
        basis = f"no declared default for {key}; using fallback"
    elif spec.capacity_multiplier == 1.0:
        basis = f"declared default for {key} (capacity set {CAPACITY_VERSION})"
    else:
        basis = f"declared default for {key} (capacity set {CAPACITY_VERSION}); {spec.label} instance ({spec.vcpu} vCPU / {spec.ram_gb}GB) -> {spec.capacity_multiplier:g}x"

    return float(capacity), basis
