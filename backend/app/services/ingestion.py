"""
Existing-project ingestion orchestration (spec §6 Phase 5): file discovery
-> static extraction -> Evidence Graph -> LLM reconstruction -> the same
validated mutation-command pipeline every other architecture-producing
path in this app goes through (services/mutation_engine.py). The LLM
never sees raw code, only the Evidence Graph (ingestion_extract.py) — and
its own citations are checked against real evidence ids in code, not
trusted at face value, so "every proposed node traceable to specific
evidence" (spec's Phase 5 acceptance criterion) is an enforced guarantee,
not just a prompt instruction the model could ignore or hallucinate.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_llm_provider
from app.llm.prompts import build_ingestion_prompt
from app.models.commands import AddEdgeCommand, AddNodeCommand
from app.models.evidence import Evidence, EvidenceGraph, IngestionTurnOutput
from app.models.state import ArchitectureState, empty_state
from app.services.ingestion_discovery import discover_files
from app.services.ingestion_extract import extract_evidence
from app.services.mutation_engine import apply_commands


@dataclass
class IngestionResult:
    ok: bool
    state: ArchitectureState | None = None
    citations: dict[str, list[str]] = field(default_factory=dict)  # real node id -> evidence id(s), after ref->id resolution
    evidence: EvidenceGraph | None = None
    summary: str = ""
    dropped_uncited_refs: list[str] = field(default_factory=list)  # refs the model proposed but couldn't/didn't cite real evidence for
    error: str | None = None


def build_evidence_graph(root: Path) -> EvidenceGraph:
    """Steps 1-3 of the Phase 5 pipeline: discover -> extract -> Evidence
    Graph. No LLM call in this function at all — everything here is
    deterministic, same philosophy as every other Tier-1-style piece of
    this codebase (spec §7)."""
    files = discover_files(root)
    evidence, unsupported = extract_evidence(files)
    if not files:
        unsupported.append("No files matched this pipeline's MVP language/infra coverage (Python, JS/TS, Docker Compose) — nothing to reconstruct from.")
    return EvidenceGraph(evidence=evidence, unsupported_notes=unsupported)


def _filter_uncited_nodes(turn: IngestionTurnOutput, evidence: EvidenceGraph) -> tuple[list, list[str]]:
    """Enforces the grounding contract in code, not just in the prompt: an
    add_node whose ref has no citation, or whose citation points at an
    evidence id that doesn't actually exist, is dropped — along with any
    add_edge that referenced it (a dangling edge would just fail
    apply_commands validation anyway; this reports WHY up front instead
    of a generic 'dangling edge' error). Every other command passes
    through unchanged, in its original order, so add_node/add_edge
    ordering within the batch is preserved for _resolve() in
    mutation_engine.py."""
    real_ids = {e.id for e in evidence.evidence}
    dropped_refs: list[str] = []
    kept = []

    for cmd in turn.commands:
        if isinstance(cmd, AddNodeCommand):
            cited = turn.citations.get(cmd.ref, [])
            valid_citations = [c for c in cited if c in real_ids]
            if not valid_citations:
                dropped_refs.append(cmd.ref)
                continue
        kept.append(cmd)

    if dropped_refs:
        kept = [
            cmd for cmd in kept
            if not (isinstance(cmd, AddEdgeCommand) and (cmd.from_id in dropped_refs or cmd.to_id in dropped_refs))
        ]

    return kept, dropped_refs


async def reconstruct_architecture(evidence: EvidenceGraph) -> IngestionResult:
    """Step 4 of the pipeline: the one and only LLM call. Reuses the exact
    same InterviewTurnOutput command vocabulary and apply_commands
    validation as every other architecture-producing path — ingestion is
    just a different way to arrive at the first version of a project, not
    a separate, less-validated one."""
    if not evidence.evidence:
        return IngestionResult(ok=False, evidence=evidence, error="No evidence extracted — nothing to reconstruct from.")

    provider = get_llm_provider()
    prompt = build_ingestion_prompt(evidence)
    try:
        turn = await provider.structured_json(prompt, "Reconstruct the architecture from this evidence.", IngestionTurnOutput)
    except Exception as e:
        return IngestionResult(ok=False, evidence=evidence, error=f"LLM reconstruction failed: {e}")

    commands, dropped_refs = _filter_uncited_nodes(turn, evidence)
    result = apply_commands(empty_state(), commands)
    if not result.ok:
        errors = "; ".join(f"[{e.op}] {e.error}" for e in result.errors)
        return IngestionResult(ok=False, evidence=evidence, dropped_uncited_refs=dropped_refs, error=f"Reconstructed architecture failed validation: {errors}")

    assert result.state is not None
    # Resolve ref -> real generated node id so the returned citations map
    # is keyed the same way the rest of the app addresses nodes (real
    # ids), not the transient refs only meaningful within this one batch.
    ref_to_real_id: dict[str, str] = {}
    idx = 0
    for cmd in commands:
        if isinstance(cmd, AddNodeCommand):
            ref_to_real_id[cmd.ref] = result.state.nodes[idx].id
            idx += 1
    real_citations = {ref_to_real_id[ref]: cites for ref, cites in turn.citations.items() if ref in ref_to_real_id}

    return IngestionResult(
        ok=True, state=result.state, citations=real_citations, evidence=evidence,
        summary=turn.summary, dropped_uncited_refs=dropped_refs,
    )


async def ingest_repository(project_name: str, root: Path) -> IngestionResult:
    """Top-level entry point: the whole Phase 5 pipeline against a
    directory already extracted on disk (services/ingestion_discovery.py
    doesn't care whether that directory came from an unzipped upload or a
    cloned repo — see api/routes/ingestion.py for how it gets there).
    Does NOT create a project/version itself on failure — only a
    reconstruction that actually validated gets persisted, so a failed
    ingestion never leaves a broken half-project behind."""
    evidence = build_evidence_graph(root)
    result = await reconstruct_architecture(evidence)
    return result


async def persist_ingestion(project_name: str, result: IngestionResult) -> dict:
    """Creates the new project + its initial version from a successful
    IngestionResult. Separate from ingest_repository so a caller (the API
    route) can inspect/reject a low-confidence result — e.g. a large
    dropped_uncited_refs list, or heavy unsupported_notes — before
    committing it, rather than this always silently persisting whatever
    came back."""
    assert result.ok and result.state is not None
    project = await repo.create_project(project_name)
    # "reconstruction", not "initial" -- schema.sql documents this kind
    # explicitly, and the frontend's VersionHistory timeline already has a
    # dedicated visual treatment for it (orange dot, History icon) that
    # never actually triggered until this was fixed, since every ingested
    # version was silently tagged as a normal fresh interview instead.
    version = await repo.create_version(project["id"], result.state, kind="reconstruction")
    return {"project": project, "version": version}
