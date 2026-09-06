"""
Existing-project ingestion endpoint (spec §6 Phase 5). Accepts a ZIP
upload, extracts it to a temporary directory, and runs it through the
full deterministic-discovery -> LLM-reconstruction pipeline
(services/ingestion.py) — same validated mutation-command path as every
other architecture-producing flow, never a special-cased shortcut.
"""
from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services.ingestion import ingest_repository, persist_ingestion

router = APIRouter(prefix="/ingest", tags=["ingestion"])

MAX_UPLOAD_BYTES = 25_000_000  # 25MB — generous for a small sample project's source, not its node_modules/venv (discovery skips those anyway)


@router.post("")
async def ingest_project(file: UploadFile = File(...), name: str = Form("Ingested Project")):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "upload must be a .zip file")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"upload exceeds the {MAX_UPLOAD_BYTES // 1_000_000}MB limit")

    with tempfile.TemporaryDirectory(prefix="ai_architect_ingest_") as tmp_str:
        tmp = Path(tmp_str)
        zip_path = tmp / "upload.zip"
        zip_path.write_bytes(raw)

        extract_dir = tmp / "extracted"
        extract_dir.mkdir()
        try:
            with zipfile.ZipFile(zip_path) as zf:
                # Reject a zip-slip attempt (a member path that would
                # escape extract_dir) outright rather than silently
                # sanitizing it — an upload trying that is not a project
                # worth reconstructing from.
                for member in zf.namelist():
                    member_path = (extract_dir / member).resolve()
                    if not str(member_path).startswith(str(extract_dir.resolve())):
                        raise HTTPException(400, "zip contains an unsafe path")
                zf.extractall(extract_dir)
        except zipfile.BadZipFile:
            raise HTTPException(400, "not a valid zip file")

        # A single top-level directory (the common "repo-name/" shape a
        # GitHub "Download ZIP" produces) shouldn't change what gets
        # discovered — walk into it so paths cited as evidence read as
        # real repo-relative paths, not "repo-name/real/path".
        entries = list(extract_dir.iterdir())
        root = entries[0] if len(entries) == 1 and entries[0].is_dir() else extract_dir

        result = await ingest_repository(name, root)

        if not result.ok:
            return {
                "ok": False,
                "error": result.error,
                "unsupported_notes": result.evidence.unsupported_notes if result.evidence else [],
            }

        persisted = await persist_ingestion(name, result)
        return {
            "ok": True,
            "project": persisted["project"],
            "version": persisted["version"],
            "summary": result.summary,
            "citations": result.citations,
            "evidence": [e.model_dump(mode="json") for e in result.evidence.evidence] if result.evidence else [],
            "unsupported_notes": result.evidence.unsupported_notes if result.evidence else [],
            "dropped_uncited_refs": result.dropped_uncited_refs,
        }
