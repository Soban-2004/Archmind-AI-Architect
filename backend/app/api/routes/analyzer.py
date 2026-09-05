from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.db import repository as repo
from app.models.state import ArchitectureState
from app.services.analyzer import explain_scorecard, score_architecture

router = APIRouter(prefix="/projects", tags=["analyzer"])


async def _load_state(project_id: UUID, version_id: UUID) -> ArchitectureState:
    version = await repo.get_version(version_id)
    if version is None or version["project_id"] != project_id:
        raise HTTPException(404, "version not found")
    return ArchitectureState.model_validate(version["state"])


@router.get("/{project_id}/versions/{version_id}/scorecard")
async def get_scorecard(project_id: UUID, version_id: UUID):
    state = await _load_state(project_id, version_id)
    return score_architecture(state)


@router.post("/{project_id}/versions/{version_id}/scorecard/ask")
async def ask_scorecard(project_id: UUID, version_id: UUID, body: dict):
    question = body.get("question", "")
    if not question.strip():
        raise HTTPException(400, "question is required")

    state = await _load_state(project_id, version_id)
    scorecard = score_architecture(state)
    answer = await explain_scorecard(state, scorecard, question)
    return {"scorecard": scorecard, "answer": answer}
