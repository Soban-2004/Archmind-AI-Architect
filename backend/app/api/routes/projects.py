from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db import repository as repo
from app.models.commands import ApplyCommandsRequest
from app.models.state import ArchitectureState, empty_state
from app.services.diff import diff_states
from app.services.interview import direct_apply_commands, direct_update_node

router = APIRouter(prefix="/projects", tags=["projects"])


def _state_of(version_row: dict) -> ArchitectureState:
    return ArchitectureState.model_validate(version_row["state"])


@router.post("")
async def create_project(body: dict):
    name = body.get("name", "Untitled Project")
    project = await repo.create_project(name)
    return project


@router.get("")
async def list_projects():
    return await repo.list_projects()


@router.patch("/{project_id}")
async def rename_project(project_id: UUID, body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    project = await repo.rename_project(project_id, name)
    if project is None:
        raise HTTPException(404, "project not found")
    return project


@router.delete("/{project_id}")
async def delete_project(project_id: UUID):
    deleted = await repo.delete_project(project_id)
    if not deleted:
        raise HTTPException(404, "project not found")
    return {"ok": True}


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


@router.patch("/{project_id}/versions/{version_id}/nodes/{node_id}")
async def update_node_direct(project_id: UUID, version_id: UUID, node_id: str, body: dict):
    """Direct node edit from the canvas (click a node, tweak a field,
    save) — deterministic, no LLM call (see services/interview.py's
    direct_update_node). Branches a new version off `version_id` exactly
    like a chat edit would, just skipping the interview loop entirely."""
    attributes = body.get("attributes")
    if not isinstance(attributes, dict) or not attributes:
        raise HTTPException(400, "body must be {'attributes': {...}}")

    result = await direct_update_node(project_id, version_id, node_id, attributes)
    if result.kind == "error":
        raise HTTPException(400, result.error)
    return {"summary": result.summary, "version": result.version, "diff": result.diff}


@router.post("/{project_id}/versions/{version_id}/commands")
async def apply_commands_direct(project_id: UUID, version_id: UUID, body: ApplyCommandsRequest):
    """Manual canvas edits — add a node via the palette, drag-connect two
    nodes, delete something — land here as real MutationCommands, the
    same shape and the same validation (see services/interview.py's
    direct_apply_commands) a chat edit already goes through. No LLM call."""
    result = await direct_apply_commands(project_id, version_id, body.commands)
    if result.kind == "error":
        raise HTTPException(400, result.error)
    return {"summary": result.summary, "version": result.version, "diff": result.diff}


@router.post("/{project_id}/commands")
async def apply_commands_to_new_project(project_id: UUID, body: ApplyCommandsRequest):
    """The one case the route above can't cover: a genuinely brand-new
    project has no version at all yet (handleCreateProject deliberately
    doesn't auto-create a blank one — see its own comment in page.tsx), so
    the very first manual add_node has no version_id to branch off. Same
    direct_apply_commands, just with base_version_id=None — starts from
    empty_state(), matching how a project's first chat-proposed
    architecture already does."""
    result = await direct_apply_commands(project_id, None, body.commands)
    if result.kind == "error":
        raise HTTPException(400, result.error)
    return {"summary": result.summary, "version": result.version, "diff": result.diff}


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
