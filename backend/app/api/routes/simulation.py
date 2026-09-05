from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db import repository as repo
from app.models.simulation import SimulationRequest
from app.models.state import ArchitectureState
from app.services.simulator import run_simulation

router = APIRouter(prefix="/projects", tags=["simulation"])


@router.post("/{project_id}/versions/{version_id}/simulate")
async def simulate(project_id: UUID, version_id: UUID, body: SimulationRequest):
    version = await repo.get_version(version_id)
    if version is None or version["project_id"] != project_id:
        raise HTTPException(404, "version not found")

    state = ArchitectureState.model_validate(version["state"])
    real_ids = state.node_ids()
    unknown = [nid for nid in body.kill_node_ids if nid not in real_ids]
    if unknown:
        raise HTTPException(400, f"unknown node id(s) to kill: {unknown}")

    return run_simulation(state, body.multiplier, body.kill_node_ids)
