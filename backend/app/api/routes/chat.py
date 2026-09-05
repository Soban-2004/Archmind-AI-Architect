from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.services.interview import handle_chat_turn

router = APIRouter(prefix="/projects", tags=["chat"])


@router.post("/{project_id}/chat")
async def chat(project_id: UUID, body: dict):
    message = body.get("message", "")
    if not message.strip():
        raise HTTPException(400, "message is required")

    result = await handle_chat_turn(project_id, message)

    if result.kind == "error":
        return {"kind": "error", "error": result.error}
    if result.kind == "question":
        return {"kind": "question", "question": result.question}
    return {"kind": "architecture", "summary": result.summary, "version": result.version}
