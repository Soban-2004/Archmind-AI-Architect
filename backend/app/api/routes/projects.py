from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db import repository as repo
from app.models.state import ArchitectureState, empty_state
from app.services.diff import diff_states

router = APIRouter(prefix="/projects", tags=["projects"])


def _state_of(version_row: dict) -> ArchitectureState:
    return ArchitectureState.model_validate(version_row["state"])


@router.post("")
async def create_project(body: dict):
    name = body.get("name", "Untitled Project")
    project = await repo.create_project(name)
    return project


@router.get("/{project_id}")
async def get_project(project_id: UUID):
    project = await repo.get_project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    latest = await repo.get_latest_version(project_id)
    return {**project, "latest_version": latest}


@router.get("/{project_id}/versions")
async def list_versions(project_id: UUID):
    return await repo.list_versions(project_id)


@router.get("/{project_id}/versions/{version_id}")
async def get_version(project_id: UUID, version_id: UUID):
    version = await repo.get_version(version_id)
    if version is None or version["project_id"] != project_id:
        raise HTTPException(404, "version not found")
    return version


@router.put("/{project_id}/versions/{version_id}/layout")
async def put_version_layout(project_id: UUID, version_id: UUID, body: dict):
    version = await repo.get_version(version_id)
    if version is None or version["project_id"] != project_id:
        raise HTTPException(404, "version not found")
    layout = body.get("layout")
    if not isinstance(layout, dict):
        raise HTTPException(400, "body must be {'layout': {node_id: {x, y}}}")
    await repo.update_version_layout(version_id, layout)
    return {"ok": True}


@router.get("/{project_id}/versions/{version_id}/diff")
async def get_version_diff(project_id: UUID, version_id: UUID, against: Optional[UUID] = None):
    """Diff any two versions (spec: compare engine must work on arbitrary
    pairs, not just parent/child — Phase 3 tiers branch off a shared parent
    rather than forming a line). Defaults `against` to this version's own
    parent, i.e. "what did this edit change"."""
    version = await repo.get_version(version_id)
    if version is None or version["project_id"] != project_id:
        raise HTTPException(404, "version not found")

    against_id = against or version["parent_version_id"]
    if against_id is None:
        before_state = empty_state()
    else:
        against_version = await repo.get_version(against_id)
        if against_version is None or against_version["project_id"] != project_id:
            raise HTTPException(404, "'against' version not found")
        before_state = _state_of(against_version)

    return diff_states(before_state, _state_of(version))
