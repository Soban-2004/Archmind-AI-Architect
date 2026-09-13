"""
The "starter kit" export (spec extension — see AI_ARCHITECT_IMPLEMENTATION.md
comparison notes): turns a validated ArchitectureState into a small bundle
of real files meant to be handed to a coding agent (or a person) as the
actual starting point for building the thing, not just a picture of it.

Four files, each generated purely from data this system already computed
and validated — nothing here is invented per export:
- ARCHITECTURE.md   — the full design: every node (with its real, project-
  specific rationale), every edge, the stated constraints, the ADR
  history, and the cost estimate. The human- and AI-readable ground truth.
- AI_BRIEF.md        — a real dependency-ordered build plan (topological
  sort of the actual call graph, not a guess) plus each service's
  responsibilities and what its edges say it needs to expose/call —
  written to be handed directly to a coding agent as its starting brief.
- docker-compose.yml — real, runnable images for every infra/data node
  that has an honest local equivalent (see analyzer/docker_images.py for
  what does and doesn't), so local dev has a working environment before
  any service code exists. Service nodes appear as commented-out
  placeholders, never a fabricated "hello world" container — there's no
  real code to run yet, and pretending otherwise would be exactly the
  kind of invented precision this project avoids everywhere else.
- .env.example       — every connection-string env var a service will
  need, derived from its real outgoing edges (who it actually calls, over
  what protocol), plus a blank placeholder for each external_dependency.

STARTER_KIT_VERSION exists for the same reason every other declared-
assumption module in this codebase versions itself — bump it if the
generated file SHAPES change (not for wording tweaks).
"""
from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime, timezone

from app.analyzer.cost import estimate_monthly_cost
from app.analyzer.docker_images import docker_image_for
from app.models.state import ArchitectureState, Edge, ExternalDependency, Node

STARTER_KIT_VERSION = "v1"


def slugify(name: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", name.strip().lower())) or "architecture"


def _node_slug(node: Node) -> str:
    return slugify(node.name)


# ---------------------------------------------------------------------------
# Build order — a real topological sort of the call graph (edge A->B means
# "A calls B"), not a guess dressed up as one: B must exist/be buildable
# before A can be meaningfully tested against it, so B comes first. A node
# that calls nothing (most databases, queues, infra, every
# external_dependency) has no prerequisites and is ready immediately.
# Kahn's algorithm; any leftover nodes after the queue drains (a real
# dependency cycle — the connectivity registry prevents the specific
# shapes it knows about, but doesn't guarantee there's no cycle at all)
# are appended in their original order rather than silently dropped, so
# the output always accounts for every node.
# ---------------------------------------------------------------------------
def build_order(state: ArchitectureState) -> list[Node]:
    calls: dict[str, set[str]] = {n.id: set() for n in state.nodes}
    for e in state.edges:
        if e.from_id in calls and e.to_id in calls:
            calls[e.from_id].add(e.to_id)

    dependents: dict[str, list[str]] = {n.id: [] for n in state.nodes}
    for nid, targets in calls.items():
        for t in targets:
            dependents[t].append(nid)

    remaining = {nid: len(targets) for nid, targets in calls.items()}
    by_id = {n.id: n for n in state.nodes}
    # Ready nodes are drained in original declaration order for a stable,
    # reproducible file each export — not because order among independent
    # nodes carries any real meaning.
    ready = [n.id for n in state.nodes if remaining[n.id] == 0]
    order: list[str] = []
    built: set[str] = set()

    while ready:
        nid = ready.pop(0)
        if nid in built:
            continue
        built.add(nid)
        order.append(nid)
        for dep in dependents[nid]:
            remaining[dep] -= 1
            if remaining[dep] == 0 and dep not in built:
                ready.append(dep)

    for n in state.nodes:
        if n.id not in built:
            order.append(n.id)  # cycle fallback — never drop a node

    return [by_id[nid] for nid in order]


def _callers_of(state: ArchitectureState, node_id: str) -> list[Edge]:
    return [e for e in state.edges if e.to_id == node_id]


def _calls_of(state: ArchitectureState, node_id: str) -> list[Edge]:
    return [e for e in state.edges if e.from_id == node_id]


# ---------------------------------------------------------------------------
# ARCHITECTURE.md
# ---------------------------------------------------------------------------
def _architecture_md(state: ArchitectureState, project_name: str) -> str:
    lines: list[str] = [f"# {project_name} — Architecture", ""]
    lines.append(
        f"Exported from AI Architect on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. "
        "Every component below passed the same structural validation (connectivity rules, "
        "schema checks) before it ever reached the canvas — this is the real, checked design, "
        "not a sketch."
    )
    lines.append("")

    if state.constraints:
        lines.append("## Stated constraints")
        for c in state.constraints:
            lines.append(f"- **{c.type.value.replace('_', ' ')}**: {c.value}")
        lines.append("")

    lines.append(f"## Components ({len(state.nodes)})")
    lines.append("")
    for n in state.nodes:
        kind_label = n.node_kind.replace("_", " ")
        type_label = str(n.type.value if hasattr(n.type, "value") else n.type).replace("_", " ")
        lines.append(f"### {n.name}")
        lines.append(f"*{kind_label} · {type_label}*")
        lines.append("")
        rationale = getattr(n, "rationale", None)
        if rationale:
            lines.append(f"**Why it's here:** {rationale}")
            lines.append("")
        details: list[str] = []
        engine = getattr(n, "engine", None)
        if engine:
            details.append(f"- Engine: `{engine}`")
        language = getattr(n, "language", None)
        if language:
            details.append(f"- Language: {language}")
        responsibilities = getattr(n, "responsibilities", None)
        if responsibilities:
            details.append(f"- Responsibilities: {responsibilities}")
        role = getattr(n, "role", None)
        role_value = getattr(role, "value", role)
        if role_value:
            details.append(f"- Role: {role_value}")
        scaling_mode = getattr(n, "scaling_mode", None)
        scaling_value = getattr(scaling_mode, "value", scaling_mode)
        if scaling_value:
            details.append(f"- Scaling: {scaling_value}")
        size = getattr(n, "size", None)
        size_value = getattr(size, "value", size)
        if size_value:
            details.append(f"- Size: {size_value}")
        storage_gb = getattr(n, "storage_gb", None)
        if storage_gb:
            details.append(f"- Storage: {storage_gb}GB")
        criticality = getattr(n, "criticality", None)
        criticality_value = getattr(criticality, "value", criticality)
        if criticality_value:
            details.append(f"- Criticality: {criticality_value}")
        if details:
            lines.extend(details)
            lines.append("")

    if state.edges:
        lines.append("## Connections")
        by_id = {n.id: n for n in state.nodes}
        for e in state.edges:
            src = by_id.get(e.from_id)
            dst = by_id.get(e.to_id)
            if not src or not dst:
                continue
            sync_label = "sync" if e.sync_async.value == "sync" else "async"
            note = f" — {e.notes}" if e.notes else ""
            lines.append(f"- **{src.name}** → **{dst.name}** ({e.protocol.value}, {sync_label}){note}")
        lines.append("")

    if state.adrs:
        lines.append("## Decision history")
        for adr in state.adrs:
            trigger = adr.triggered_by.value.replace("_", " ")
            lines.append(f"- **{adr.decision}** ({trigger}): {adr.rationale}")
        lines.append("")

    total_cost, breakdown = estimate_monthly_cost(state)
    if breakdown:
        lines.append("## Estimated cost")
        lines.append(f"**~${total_cost:.0f}/mo** — rough, declared per-component assumptions, not a real quote.")
        lines.append("")
        for item in breakdown:
            lines.append(f"- {item.node_name}: ${item.monthly_cost_usd:.0f}/mo — {item.basis}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# AI_BRIEF.md
# ---------------------------------------------------------------------------
def _ai_brief_md(state: ArchitectureState, project_name: str) -> str:
    order = build_order(state)
    lines: list[str] = [
        f"# {project_name} — Build Brief",
        "",
        "Written for a coding agent (or you) to pick up and start implementing this "
        "validated architecture. Read ARCHITECTURE.md first for the full design and the "
        "\"why\" behind each component — this file is about WHAT ORDER to build in and "
        "WHAT EACH SERVICE NEEDS TO DO.",
        "",
        "## Suggested build order",
        "",
        "Computed from the real dependency graph (what calls what) — a callee is built "
        "before its callers, so each new piece can be tested against something real "
        "instead of a stub.",
        "",
    ]

    for i, n in enumerate(order, start=1):
        type_label = str(n.type.value if hasattr(n.type, "value") else n.type).replace("_", " ")
        calls = _calls_of(state, n.id)
        callers = _callers_of(state, n.id)
        by_id = {x.id: x for x in state.nodes}

        lines.append(f"{i}. **{n.name}** ({n.node_kind.replace('_', ' ')} · {type_label})")
        if calls:
            targets = ", ".join(by_id[e.to_id].name for e in calls if e.to_id in by_id)
            lines.append(f"   - Depends on: {targets}")
        if callers:
            sources = ", ".join(by_id[e.from_id].name for e in callers if e.from_id in by_id)
            lines.append(f"   - Called by: {sources}")
        rationale = getattr(n, "rationale", None)
        if rationale:
            lines.append(f"   - Why: {rationale}")
    lines.append("")

    services = [n for n in state.nodes if n.node_kind == "service"]
    if services:
        lines.append("## Per-service responsibilities")
        lines.append("")
        for n in services:
            lines.append(f"### {n.name}")
            responsibilities = getattr(n, "responsibilities", None)
            if responsibilities:
                lines.append(f"- Responsibilities: {responsibilities}")
            language = getattr(n, "language", None)
            if language:
                lines.append(f"- Language: {language}")
            for e in _calls_of(state, n.id):
                target = next((x for x in state.nodes if x.id == e.to_id), None)
                if target:
                    lines.append(f"- Calls **{target.name}** over {e.protocol.value} ({e.sync_async.value})")
            for e in _callers_of(state, n.id):
                source = next((x for x in state.nodes if x.id == e.from_id), None)
                if source:
                    lines.append(f"- Exposes something **{source.name}** calls over {e.protocol.value} ({e.sync_async.value})")
            rationale = getattr(n, "rationale", None)
            if rationale:
                lines.append(f"- Why this project needs it: {rationale}")
            lines.append("")

    external = [n for n in state.nodes if isinstance(n, ExternalDependency)]
    if external:
        lines.append("## External integrations to wire in")
        lines.append("")
        for n in external:
            type_label = str(n.type.value).replace("_", " ")
            lines.append(f"- **{n.name}** ({type_label}, {n.criticality.value} dependency)" + (f" — {n.rationale}" if n.rationale else ""))
        lines.append("")

    lines.append("## Local dev environment")
    lines.append("")
    lines.append(
        "Run `docker-compose up` to bring up every infra/data component that has a real, "
        "runnable local image (see docker-compose.yml's comments for what's real vs. a "
        "documented stand-in). Copy `.env.example` to `.env` and fill in the blanks. Service "
        "nodes are NOT containerized here — there's no application code yet — build each one "
        "per its section above, then add its own block to docker-compose.yml once it exists."
    )
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# docker-compose.yml — hand-formatted, not run through a YAML library: every
# value here is a plain string/int that needs no escaping, and hand-
# formatting keeps the comments (the honest "this is a stand-in" notes)
# attached to the right line, which a round-tripped dump would lose.
# ---------------------------------------------------------------------------
def _docker_compose_yml(state: ArchitectureState) -> str:
    lines: list[str] = [
        "# Generated by AI Architect — real, runnable images for every infra/data",
        "# component that has an honest local equivalent (see the comments below for",
        "# what's a real match vs. a documented stand-in). Service nodes are commented",
        "# out: there's no application code yet to containerize.",
        "",
        "services:",
    ]
    volumes: list[str] = []
    any_real_service = False

    for n in state.nodes:
        if n.node_kind == "service":
            slug = _node_slug(n)
            lines.append(f"  # {n.name} (service) — no application code yet, this is a placeholder")
            lines.append(f"  # {slug}:")
            lines.append(f"  #   build: ./services/{slug}   # point this at your actual service code once it exists")
            lines.append("  #   ports:")
            lines.append('  #     - "8000:8000"')
            calls = _calls_of(state, n.id)
            if calls:
                lines.append("  #   depends_on:")
                by_id = {x.id: x for x in state.nodes}
                for e in calls:
                    target = by_id.get(e.to_id)
                    if target:
                        lines.append(f"  #     - {_node_slug(target)}")
            lines.append("  #   env_file: .env")
            lines.append("")
            continue

        if n.node_kind == "external_dependency":
            continue  # nothing to run locally for a third-party API/provider

        spec, note = docker_image_for(n)
        slug = _node_slug(n)
        if spec is None:
            reason = note or "no local stand-in for this component"
            lines.append(f"  # {n.name} ({n.node_kind}) — {reason}")
            lines.append("")
            continue

        any_real_service = True
        lines.append(f"  {slug}:")
        if note:
            lines.append(f"    # {note}")
        lines.append(f"    image: {spec.image}")
        if spec.env:
            lines.append("    environment:")
            for k, v in spec.env.items():
                lines.append(f'      {k}: "{v}"')
        lines.append("    ports:")
        lines.append(f'      - "{spec.port}:{spec.port}"')
        if spec.data_dir:
            volume_name = f"{slug}-data"
            lines.append("    volumes:")
            lines.append(f"      - {volume_name}:{spec.data_dir}")
            volumes.append(volume_name)
        lines.append("")

    if volumes:
        lines.append("volumes:")
        for v in volumes:
            lines.append(f"  {v}:")
        lines.append("")

    if not any_real_service:
        lines.append("# No component in this architecture has a real local Docker image yet —")
        lines.append("# add your own service definitions here as you build them.")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# .env.example — one block per service, one line per real outgoing
# connection (derived from its actual edges — never invented), plus a
# blank placeholder for each external_dependency the whole project relies
# on. Values are never filled in (this system has no real credentials to
# offer) — only the variable NAME and a comment on what it's for.
# ---------------------------------------------------------------------------
def _env_example(state: ArchitectureState) -> str:
    lines: list[str] = [
        "# Generated by AI Architect — variable NAMES only, derived from the real",
        "# declared connections in this architecture. No values are filled in.",
        "",
    ]
    by_id = {n.id: n for n in state.nodes}
    services = [n for n in state.nodes if n.node_kind == "service"]

    for svc in services:
        calls = _calls_of(state, svc.id)
        if not calls:
            continue
        lines.append(f"# --- {svc.name} ---")
        svc_prefix = slugify(svc.name).upper().replace("-", "_")
        for e in calls:
            target = by_id.get(e.to_id)
            if target is None:
                continue
            target_prefix = slugify(target.name).upper().replace("-", "_")
            engine = getattr(target, "engine", None)
            if target.node_kind == "database":
                var = f"{svc_prefix}_{target_prefix}_URL"
                lines.append(f"# connects to {target.name} ({engine or target.type.value})")
                lines.append(f"{var}=")
            elif target.node_kind == "queue":
                var = f"{svc_prefix}_{target_prefix}_URL"
                lines.append(f"# connects to {target.name} ({engine or target.type.value})")
                lines.append(f"{var}=")
            elif target.node_kind == "external_dependency":
                var = f"{target_prefix}_API_KEY"
                lines.append(f"# {target.name} — external dependency, get real credentials from its dashboard")
                lines.append(f"{var}=")
            else:
                var = f"{target_prefix}_URL"
                lines.append(f"# connects to {target.name}")
                lines.append(f"{var}=")
        lines.append("")

    return "\n".join(lines)


def build_starter_kit_files(state: ArchitectureState, project_name: str) -> dict[str, str]:
    """Returns {filename: content} for the 4 files — what api/routes/exports.py
    zips up and serves."""
    return {
        "ARCHITECTURE.md": _architecture_md(state, project_name),
        "AI_BRIEF.md": _ai_brief_md(state, project_name),
        "docker-compose.yml": _docker_compose_yml(state),
        ".env.example": _env_example(state),
    }


def build_starter_kit_zip(state: ArchitectureState, project_name: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in build_starter_kit_files(state, project_name).items():
            zf.writestr(filename, content)
    return buffer.getvalue()
