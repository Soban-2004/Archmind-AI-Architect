from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.services.compare import VersionNotFound, compare_versions

router = APIRouter(prefix="/projects", tags=["compare"])


@router.get("/{project_id}/compare")
async def compare(project_id: UUID, version_a: UUID, version_b: UUID):
    try:
        return await compare_versions(project_id, version_a, version_b)
    except VersionNotFound as e:
        raise HTTPException(404, f"version not found: {e}")
