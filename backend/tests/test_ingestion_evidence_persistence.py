"""
Tests for persist_ingestion actually passing the real evidence/citations
through to repo.create_version — the whole point of persisting them
(schema.sql's `evidence` column) is so they survive past the one-time
ingest HTTP response; this confirms the wiring without touching a real
database (repo.create_project/create_version monkeypatched, same
offline-only discipline as every other ingestion test in this suite).
"""
from __future__ import annotations

from app.models.evidence import Evidence, EvidenceGraph
from app.models.state import empty_state
from app.services import ingestion


async def test_persist_ingestion_passes_evidence_and_citations_to_create_version(monkeypatch):
    captured: dict = {}

    async def fake_create_project(name):
        return {"id": "proj-1", "name": name, "created_at": "2026-01-01T00:00:00Z"}

    async def fake_create_version(project_id, state, kind, parent_version_id=None, label=None, layout=None, evidence=None):
        captured["kind"] = kind
        captured["evidence"] = evidence
        return {"id": "ver-1", "project_id": project_id, "parent_version_id": None, "label": None, "kind": kind, "state": state.model_dump(mode="json"), "layout": {}, "evidence": evidence, "created_at": "2026-01-01T00:00:00Z"}

    monkeypatch.setattr(ingestion.repo, "create_project", fake_create_project)
    monkeypatch.setattr(ingestion.repo, "create_version", fake_create_version)

    ev = Evidence(id="ev_1", fact="frontend_framework", detail="React", source="src/App.tsx:1")
    result = ingestion.IngestionResult(
        ok=True,
        state=empty_state(),
        citations={"ser_1": ["ev_1"]},
        evidence=EvidenceGraph(evidence=[ev], unsupported_notes=[]),
        summary="A React frontend.",
    )

    await ingestion.persist_ingestion("Test Project", result)

    assert captured["kind"] == "reconstruction"
    assert captured["evidence"]["citations"] == {"ser_1": ["ev_1"]}
    assert captured["evidence"]["evidence"] == [ev.model_dump(mode="json")]


async def test_persist_ingestion_handles_no_evidence_gracefully(monkeypatch):
    """A theoretically-possible ok=True result with evidence=None (never
    actually produced by build_evidence_graph, which always returns a
    real EvidenceGraph, but the field IS Optional on IngestionResult)
    must not crash — empty evidence list, not an AttributeError."""
    captured: dict = {}

    async def fake_create_project(name):
        return {"id": "proj-1", "name": name, "created_at": "2026-01-01T00:00:00Z"}

    async def fake_create_version(project_id, state, kind, parent_version_id=None, label=None, layout=None, evidence=None):
        captured["evidence"] = evidence
        return {"id": "ver-1", "project_id": project_id, "parent_version_id": None, "label": None, "kind": kind, "state": state.model_dump(mode="json"), "layout": {}, "evidence": evidence, "created_at": "2026-01-01T00:00:00Z"}

    monkeypatch.setattr(ingestion.repo, "create_project", fake_create_project)
    monkeypatch.setattr(ingestion.repo, "create_version", fake_create_version)

    result = ingestion.IngestionResult(ok=True, state=empty_state(), citations={}, evidence=None, summary="")
    await ingestion.persist_ingestion("Test Project", result)

    assert captured["evidence"]["evidence"] == []
    assert captured["evidence"]["citations"] == {}
