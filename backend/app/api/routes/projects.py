from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db import repository as repo

router = APIRouter(prefix="/projects", tags=["projects"])


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
