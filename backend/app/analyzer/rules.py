"""
The Analyzer's rule set (spec §6 Phase 4: "Define this as an explicit,
versioned rule set"). Every rule is a plain function
`ArchitectureState -> list[Finding]` — deterministic, no LLM involved (spec
§7 tier 3). Bump RULES_VERSION whenever a rule's condition or points change,
so a stored/quoted Scorecard stays attributable to the exact rule set that
produced it.

Each rule cites the specific node/edge ids that triggered it
(`evidence_node_ids`/`evidence_edge_ids`) so the "why" Q&A flow
(services/analyzer.py) can ground its answer in real facts instead of
platitudes.
"""
from __future__ import annotations

from typing import Callable

from app.analyzer.cost import estimate_monthly_cost, parse_budget_ceiling
from app.models.analysis import SEVERITY_POINTS, Category, Finding, Severity
from app.models.state import ArchitectureState, ConstraintType, DatabaseRole, InfraType, ServiceType, SyncAsync

RULES_VERSION = "v3"  # v3: added rule_over_budget, the first rule to actually compute cost rather than just check whether a budget was stated

RuleFn = Callable[[ArchitectureState], list[Finding]]


def _finding(rule_id: str, category: Category, severity: Severity, message: str, node_ids=(), edge_ids=()) -> Finding:
    return Finding(
        rule_id=rule_id,
        category=category,
        severity=severity,
        points=SEVERITY_POINTS[severity],
        message=message,
        evidence_node_ids=list(node_ids),
        evidence_edge_ids=list(edge_ids),
    )


def _constraint_int(state: ArchitectureState, ctype: ConstraintType) -> int | None:
    for c in state.constraints:
        if c.type == ctype:
            try:
                return int(float(c.value))
            except ValueError:
                return None
    return None


# ---------------------------------------------------------------------------
# Reliability / scalability: single database, no replica
# ---------------------------------------------------------------------------

def _primary_dbs_without_replica(state: ArchitectureState):
    databases = [n for n in state.nodes if n.node_kind == "database"]
    primaries = [d for d in databases if d.role == DatabaseRole.primary]
    has_replica = any(d.role == DatabaseRole.replica for d in databases)
    if primaries and not has_replica:
        return primaries
    return []


def rule_no_replica_reliability(state: ArchitectureState) -> list[Finding]:
    primaries = _primary_dbs_without_replica(state)
    if not primaries:
        return []
    names = ", ".join(d.name for d in primaries)
    return [_finding(
        "no_replica_reliability", Category.reliability, Severity.moderate,
        f"{names} has no read replica — a single instance failure takes down all reads and writes.",
        node_ids=[d.id for d in primaries],
    )]


def rule_no_replica_scalability(state: ArchitectureState) -> list[Finding]:
    primaries = _primary_dbs_without_replica(state)
    if not primaries:
        return []
    names = ", ".join(d.name for d in primaries)
    return [_finding(
        "no_replica_scalability", Category.scalability, Severity.moderate,
        f"{names} has no read replica — all read traffic competes with writes on one instance.",
        node_ids=[d.id for d in primaries],
    )]


# ---------------------------------------------------------------------------
# Performance: missing cache layer
# ---------------------------------------------------------------------------

def _has_cache_node(state: ArchitectureState) -> bool:
    return any(
        (n.node_kind == "database" and (n.role == "cache" or n.type == "keyvalue"))
        for n in state.nodes
    )


def rule_no_cache_layer(state: ArchitectureState) -> list[Finding]:
    databases = [n for n in state.nodes if n.node_kind == "database"]
    if not databases or _has_cache_node(state):
        return []
    return [_finding(
        "no_cache_layer", Category.performance, Severity.moderate,
        f"No cache layer in front of {databases[0].name} (or the other database nodes) — every read hits the database directly.",
        node_ids=[d.id for d in databases],
    )]


def rule_no_cache_at_scale(state: ArchitectureState) -> list[Finding]:
    users = _constraint_int(state, ConstraintType.expected_users)
    if users is None or users <= 100_000 or _has_cache_node(state):
        return []
    return [_finding(
        "no_cache_at_scale", Category.performance, Severity.major,
        f"expected_users is {users:,} with no cache layer — read latency and database load will scale linearly with traffic.",
    )]


# ---------------------------------------------------------------------------
# Security: no gateway / rate-limiting signal
# ---------------------------------------------------------------------------

def rule_no_gateway_or_rate_limiting(state: ArchitectureState) -> list[Finding]:
    services = [n for n in state.nodes if n.node_kind == "service"]
    if not services:
        return []
    has_gateway_service = any(n.type == ServiceType.gateway for n in services)
    has_gateway_infra = any(n.node_kind == "infra_node" and n.type in (InfraType.api_gateway, InfraType.load_balancer) for n in state.nodes)
    if has_gateway_service or has_gateway_infra:
        return []
    return [_finding(
        "no_gateway_or_rate_limiting", Category.security, Severity.moderate,
        "No API gateway or load balancer in front of the backend services — no structural signal of rate limiting or centralized request policy.",
        node_ids=[n.id for n in services],
    )]


# ---------------------------------------------------------------------------
# Observability: no monitoring/logging/tracing infra
# ---------------------------------------------------------------------------

def rule_no_observability(state: ArchitectureState) -> list[Finding]:
    services = [n for n in state.nodes if n.node_kind == "service"]
    if not services:
        return []
    has_observability = any(n.node_kind == "infra_node" and n.type == InfraType.observability for n in state.nodes)
    if has_observability:
        return []
    return [_finding(
        "no_observability", Category.observability, Severity.major,
        f"No observability infra_node (monitoring/logging/tracing) covering {len(services)} service(s) — failures and slowdowns have no structural signal for detection.",
        node_ids=[n.id for n in services],
    )]


# ---------------------------------------------------------------------------
# Reliability: a long fully-synchronous call chain (cascading-failure risk)
# ---------------------------------------------------------------------------
#
# NOTE: an earlier version of this rule flagged any node with both an
# incoming and an outgoing sync edge. That's wrong — a load balancer or API
# gateway *always* looks like that; it's what routing infrastructure does,
# not a structural flaw. Confirmed by a real run: it scored a production
# tier (with a CDN/gateway/LB in front) WORSE on reliability than the
# barebones tier it was generated from, which is backwards. This version
# only flags a single, genuinely deep synchronous chain (>=4 hops, no async
# break anywhere in it) — normal 2-3 hop request paths never trigger it.

CHAIN_THRESHOLD_HOPS = 4


def _longest_sync_path(sync_adj: dict[str, list[str]], node_id: str, visiting: frozenset[str]) -> list[str]:
    best: list[str] = []
    for nxt in sync_adj.get(node_id, []):
        if nxt in visiting:
            continue  # cycle guard
        candidate = [nxt] + _longest_sync_path(sync_adj, nxt, visiting | {nxt})
        if len(candidate) > len(best):
            best = candidate
    return best


def rule_long_sync_chain(state: ArchitectureState) -> list[Finding]:
    sync_adj: dict[str, list[str]] = {}
    edge_by_pair: dict[tuple[str, str], str] = {}
    for e in state.edges:
        if e.sync_async == SyncAsync.sync:
            sync_adj.setdefault(e.from_id, []).append(e.to_id)
            edge_by_pair[(e.from_id, e.to_id)] = e.id

    best_path: list[str] = []
    for n in state.nodes:
        path = [n.id] + _longest_sync_path(sync_adj, n.id, frozenset({n.id}))
        if len(path) > len(best_path):
            best_path = path

    if len(best_path) - 1 < CHAIN_THRESHOLD_HOPS:
        return []

    id_to_name = {n.id: n.name for n in state.nodes}
    chain_desc = " -> ".join(id_to_name.get(nid, nid) for nid in best_path)
    edge_ids = [edge_by_pair[(best_path[i], best_path[i + 1])] for i in range(len(best_path) - 1)]
    return [_finding(
        "long_sync_chain", Category.reliability, Severity.moderate,
        f"A fully synchronous call chain {len(best_path) - 1} hops deep with no async decoupling anywhere in it: {chain_desc}.",
        node_ids=best_path,
        edge_ids=edge_ids,
    )]


# ---------------------------------------------------------------------------
# Reliability: hard external dependency, no stated fallback
# ---------------------------------------------------------------------------

def rule_hard_external_dependency(state: ArchitectureState) -> list[Finding]:
    findings: list[Finding] = []
    for n in state.nodes:
        if n.node_kind == "external_dependency" and n.criticality == "hard":
            findings.append(_finding(
                "hard_external_dependency", Category.reliability, Severity.minor,
                f"{n.name} is a hard external dependency — verify there's a fallback or degraded mode if it's unavailable.",
                node_ids=[n.id],
            ))
    return findings


# ---------------------------------------------------------------------------
# Cost: no budget constraint recorded
# ---------------------------------------------------------------------------

def rule_no_budget_constraint(state: ArchitectureState) -> list[Finding]:
    if not state.nodes:
        return []
    has_budget = any(c.type == ConstraintType.budget_monthly_usd for c in state.constraints)
    if has_budget:
        return []
    return [_finding(
        "no_budget_constraint", Category.cost, Severity.minor,
        "No budget_monthly_usd constraint recorded — cost cannot be evaluated against a target.",
    )]


def rule_over_budget(state: ArchitectureState) -> list[Finding]:
    """The only rule in Category.cost that actually checks a number against
    a number, rather than just whether a budget was stated at all — see
    analyzer/cost.py for the declared per-component cost assumptions this
    is built on."""
    if not state.nodes:
        return []
    budget_str = next((c.value for c in state.constraints if c.type == ConstraintType.budget_monthly_usd), None)
    if budget_str is None:
        return []  # already flagged by rule_no_budget_constraint
    ceiling = parse_budget_ceiling(budget_str)
    if ceiling is None or ceiling <= 0:
        return []

    total, _breakdown = estimate_monthly_cost(state)
    if total <= ceiling:
        return []

    over_pct = (total / ceiling - 1) * 100
    severity = Severity.major if over_pct >= 50 else Severity.moderate
    return [_finding(
        "over_budget", Category.cost, severity,
        f"Estimated infrastructure cost is ~${total:.0f}/month against a stated budget of ~${ceiling:.0f}/month ({over_pct:.0f}% over).",
    )]


# ---------------------------------------------------------------------------
# Maintainability: unspecified service language; monolith at scale
# ---------------------------------------------------------------------------

def rule_no_language_specified(state: ArchitectureState) -> list[Finding]:
    services = [n for n in state.nodes if n.node_kind == "service" and not n.language]
    if not services:
        return []
    names = ", ".join(s.name for s in services)
    return [_finding(
        "no_language_specified", Category.maintainability, Severity.minor,
        f"{names} — no language/runtime recorded, which makes onboarding and tooling decisions harder to reason about.",
        node_ids=[s.id for s in services],
    )]


def rule_monolith_at_scale(state: ArchitectureState) -> list[Finding]:
    users = _constraint_int(state, ConstraintType.expected_users)
    services = [n for n in state.nodes if n.node_kind == "service"]
    if users is None or users <= 500_000 or len(services) > 1:
        return []
    return [_finding(
        "monolith_at_scale", Category.maintainability, Severity.minor,
        f"expected_users is {users:,} with a single service node — a monolith at this scale tends to become harder to change safely as the team and codebase grow.",
        node_ids=[s.id for s in services],
    )]


ALL_RULES: list[RuleFn] = [
    rule_no_replica_reliability,
    rule_no_replica_scalability,
    rule_no_cache_layer,
    rule_no_cache_at_scale,
    rule_no_gateway_or_rate_limiting,
    rule_no_observability,
    rule_long_sync_chain,
    rule_hard_external_dependency,
    rule_no_budget_constraint,
    rule_over_budget,
    rule_no_language_specified,
    rule_monolith_at_scale,
]
