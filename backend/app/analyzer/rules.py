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

from app.models.analysis import SEVERITY_POINTS, Category, Finding, Severity
from app.models.state import ArchitectureState, ConstraintType, DatabaseRole, InfraType, ServiceType, SyncAsync

RULES_VERSION = "v1"

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
# Reliability: chained synchronous calls (cascading-failure risk)
# ---------------------------------------------------------------------------

def rule_chained_sync_calls(state: ArchitectureState) -> list[Finding]:
    findings: list[Finding] = []
    incoming_sync: dict[str, list] = {}
    outgoing_sync: dict[str, list] = {}
    for e in state.edges:
        if e.sync_async == SyncAsync.sync:
            outgoing_sync.setdefault(e.from_id, []).append(e)
            incoming_sync.setdefault(e.to_id, []).append(e)

    for node in state.nodes:
        ins = incoming_sync.get(node.id, [])
        outs = outgoing_sync.get(node.id, [])
        if ins and outs:
            evidence_edges = [e.id for e in ins + outs]
            findings.append(_finding(
                "chained_sync_calls", Category.reliability, Severity.moderate,
                f"{node.name} both receives and makes synchronous calls — a slowdown downstream blocks callers upstream with no isolation.",
                node_ids=[node.id],
                edge_ids=evidence_edges,
            ))
    return findings


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
    rule_chained_sync_calls,
    rule_hard_external_dependency,
    rule_no_budget_constraint,
    rule_no_language_specified,
    rule_monolith_at_scale,
]
