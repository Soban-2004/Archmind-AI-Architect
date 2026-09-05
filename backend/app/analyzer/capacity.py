"""
Declared capacity assumptions for the Simulator (spec §6 Phase 7). Every
number here is a documented guess, not measured data — the point is that
it's a FIXED, versioned, inspectable assumption, not something the LLM
invents per run. Bump CAPACITY_VERSION if these numbers change.

These are deliberately round, conservative, order-of-magnitude figures for
a single small instance of each kind — a real system's actual ceiling
depends on hardware, query complexity, and tuning this tool has no way to
know. Treat every simulation output as "given these assumptions", never as
a real capacity prediction.
"""
from __future__ import annotations

from app.models.state import Node

CAPACITY_VERSION = "v1"

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

    capacity = _DEFAULT_CAPACITY_RPS.get(key, FALLBACK_CAPACITY_RPS)
    basis = f"declared default for {key} (capacity set {CAPACITY_VERSION})" if key in _DEFAULT_CAPACITY_RPS else f"no declared default for {key}; using fallback"
    return float(capacity), basis
