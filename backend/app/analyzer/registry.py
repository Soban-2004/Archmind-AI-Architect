"""
Component connectivity registry (spec §3.3 extension) — declared, versioned
structural rules for what edge shapes make sense at all, in the same spirit
as capacity.py's declared capacity assumptions: not something the LLM (or
the judge) has to reason about from scratch every single time, and not
something inferred by the mutation engine's own prompt-facing error text
either. This exists specifically so the real edge-direction/bypass bugs
found via live testing this session (CDN pointing the wrong way, a service
calling a load balancer instead of the reverse, a caller bypassing a
gateway that already fronts its target, a load balancer routing directly to
a static frontend) get caught here, deterministically and for free, instead
of relying on the LLM remembering a prompt rule or the judge catching it
after the fact on a second, paid model call.

Deliberately narrow: this catches specific, confirmed-bad *shapes*, not an
exhaustive closed-world allowlist of every valid pairing — the latter would
risk rejecting legitimate designs this project hasn't seen yet. Bump
CONNECTIVITY_RULES_VERSION if these rules change.
"""
from __future__ import annotations

from app.models.state import ArchitectureState, Node

CONNECTIVITY_RULES_VERSION = "v2"  # v2: added rule 5 (load_balancer/api_gateway -> static frontend)

_FRONTING_INFRA_TYPES = {"load_balancer", "api_gateway"}
_ROUTING_INFRA_TYPES = _FRONTING_INFRA_TYPES | {"cdn"}
_STATIC_SERVICE_TYPES = {"frontend", "edge_cdn"}  # served by a CDN, not by running server instances


def check_edge_validity(source: Node, target: Node, working: ArchitectureState) -> str | None:
    """Returns a human-readable reason the edge source -> target is
    structurally invalid, or None if it's fine. `working` is the
    in-progress batch state (base state plus every earlier command in this
    same batch already applied), used only for the bypass check below,
    which needs to know what already fronts `target`."""

    # Rule 1: external dependencies are always callees in this model — this
    # tool has no representation for an external system calling into us.
    if source.node_kind == "external_dependency":
        return f"'{source.name}' is an external_dependency and cannot be the caller of an edge — external systems are only ever called, never callers, in this model"

    # Rule 2: a CDN always points toward what it serves/its origin; nothing
    # calls a CDN as a destination.
    if target.node_kind == "infra_node" and target.type == "cdn":
        return f"'{target.name}' is a CDN — nothing should call it as a destination, a CDN only ever points outward to what it serves or its origin"

    # Rule 3: a load_balancer/api_gateway routes callers TO a service; the
    # reverse (a service/database/queue/external_dependency calling INTO
    # one) is backwards. Only another routing infra_node (e.g. a CDN or a
    # chained load_balancer -> api_gateway) may point into one.
    if target.node_kind == "infra_node" and target.type in _FRONTING_INFRA_TYPES and source.node_kind != "infra_node":
        return f"'{source.name}' ({source.node_kind}) cannot call '{target.name}' — a {target.type} routes callers TO a service, the edge direction is backwards"

    # Rule 4: no caller may bypass a load_balancer/api_gateway that already
    # fronts the same target — the exact shape of the real bug found live
    # this session (a frontend node with a direct edge to one backend
    # instance alongside the API gateway that was supposed to front it).
    already_fronted_by = [
        e.from_id
        for e in working.edges
        if e.to_id == target.id
        and (fronting := working.get_node(e.from_id)) is not None
        and fronting.node_kind == "infra_node"
        and fronting.type in _FRONTING_INFRA_TYPES
    ]
    if already_fronted_by and not (source.node_kind == "infra_node" and source.type in _ROUTING_INFRA_TYPES):
        fronting_names = ", ".join(working.get_node(fid).name for fid in already_fronted_by if working.get_node(fid))
        return f"'{target.name}' is already routed to by {fronting_names} — '{source.name}' calling it directly would bypass that routing layer"

    # Rule 5: a load_balancer/api_gateway never targets a static frontend
    # directly. A load balancer/gateway implies multiple running server
    # instances to distribute across, which a static frontend has none of
    # — its entry point is a CDN, not a load balancer, whether or not a
    # CDN is also present. (Rule 3 above only catches a service calling
    # INTO a load_balancer/api_gateway — the reverse direction, the
    # routing layer correctly pointing OUT to something that shouldn't
    # receive it, needed its own check.)
    if (
        source.node_kind == "infra_node"
        and source.type in _FRONTING_INFRA_TYPES
        and target.node_kind == "service"
        and target.type in _STATIC_SERVICE_TYPES
    ):
        return f"'{source.name}' ({source.type}) cannot route to '{target.name}', a static {target.type} — a load balancer/API gateway implies multiple running server instances to distribute across, which a static frontend has none of; its entry point is a CDN"

    return None
