"""
Declared monthly cost assumptions (spec §... "the moat is the model that
surrounds the LLM" — a real cost check, not just a collected-but-unchecked
budget field). Same philosophy as capacity.py: fixed, versioned, inspectable
numbers, never something the LLM estimates per-run. Deliberately rough,
single-small-managed-instance figures — a real bill depends on region,
vendor, committed-use discounts, and actual traffic this tool has no way to
know. Every estimate is shown with its basis so it's never presented as
more precise than it is. Bump COST_VERSION if these numbers change.
"""
from __future__ import annotations

from app.analyzer.numeric import parse_upper_bound
from app.models.analysis import CostLineItem
from app.models.state import ArchitectureState, Node

COST_VERSION = "v1"

# Rough monthly USD for one small managed instance of each kind — the same
# "single small instance" assumption capacity.py uses for RPS, applied to
# $ instead. A replica or extra instance is a second node in this schema
# (spec's own modeling choice), so it's already counted once per node —
# this deliberately does NOT try to guess a bulk/reserved discount for
# having several.
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
    """Returns (monthly_cost_usd, basis) — basis is shown to the user so a
    cost number is never presented as unexplained, mirroring
    capacity.py's capacity_for()."""
    if node.node_kind in ("database", "infra_node"):
        key = f"{node.node_kind}:{node.type}"
    else:
        key = node.node_kind

    cost = _MONTHLY_COST_USD.get(key, FALLBACK_MONTHLY_COST_USD)
    basis = f"declared default for {key} (cost set {COST_VERSION})" if key in _MONTHLY_COST_USD else f"no declared default for {key}; using fallback"
    return float(cost), basis


def estimate_monthly_cost(state: ArchitectureState) -> tuple[float, list[CostLineItem]]:
    breakdown: list[CostLineItem] = []
    total = 0.0
    for n in state.nodes:
        cost, basis = monthly_cost_for(n)
        breakdown.append(CostLineItem(node_id=n.id, node_name=n.name, monthly_cost_usd=cost, basis=basis))
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
