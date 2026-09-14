from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from app.services.migration import VersionNotFound, generate_migration_blueprint

router = APIRouter(prefix="/projects", tags=["migration"])


@router.get("/{project_id}/migration-blueprint")
async def migration_blueprint(project_id: UUID, reconstructed_version: UUID, target_version: UUID, x_guest_token: Optional[str] = Header(default=None)):
    """`reconstructed_version` is the as-is architecture (typically a
    Phase 5 ingestion result); `target_version` is a production tier
    already generated against it via the existing action="generate_tier"
    chat flow (spec §6 Phase 3) — this endpoint doesn't generate a target
    itself, it explains the gap between two real, already-versioned
    architectures, the same "diff is ground truth, LLM only narrates"
    principle /compare already follows."""
    try:
        return await generate_migration_blueprint(project_id, reconstructed_version, target_version, x_guest_token)
    except VersionNotFound as e:
        raise HTTPException(404, f"version not found: {e}")
