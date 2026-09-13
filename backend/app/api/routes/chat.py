import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

from app.services.interview import ChatTurnResult, handle_chat_turn

router = APIRouter(prefix="/projects", tags=["chat"])


def _result_payload(result: ChatTurnResult) -> dict:
    """Shared by both routes below so the plain and streaming endpoints
    always agree on what a given ChatTurnResult looks like over the
    wire — one place, not two copies that could quietly drift apart."""
    if result.kind == "error":
        return {"kind": "error", "error": result.error}
    if result.kind == "question":
        return {"kind": "question", "question": result.question, "quick_replies": result.quick_replies or [], "usage": result.usage}
    if result.kind == "answer":
        # A non-mutating turn (services/intent_router.py's advisory/
        # analysis lanes, or the empty-commands safety net in
        # handle_chat_turn) — no version/diff, nothing on the canvas
        # changed, this is purely a chat reply. `sources` is only ever
        # populated for a web-grounded advisory answer (see
        # _handle_advisory) — jsonable_encoder (used by the streaming
        # route) handles the WebSource pydantic models fine either way.
        return {"kind": "answer", "answer": result.summary, "usage": result.usage, "sources": result.sources or []}
    return {"kind": "architecture", "summary": result.summary, "version": result.version, "diff": result.diff, "usage": result.usage}


@router.post("/{project_id}/chat")
async def chat(project_id: UUID, body: dict):
    message = body.get("message", "")
    if not message.strip():
        raise HTTPException(400, "message is required")

    base_version_id_raw = body.get("base_version_id")
    base_version_id = UUID(base_version_id_raw) if base_version_id_raw else None

    result = await handle_chat_turn(project_id, message, base_version_id)
    return _result_payload(result)


@router.post("/{project_id}/chat/stream")
async def chat_stream(project_id: UUID, body: dict):
    """Same real pipeline as POST /chat (handle_chat_turn) — this doesn't
    replace it, it's additive for a caller that wants live progress.
    Streamed as Server-Sent Events: a real `{"type": "stage", ...}` event
    fires exactly when each step of the pipeline actually starts (Tier 1
    check, routing, the real Groq call, validation, the judge pass,
    finalizing — see services/interview.py's OnStage), never a client-side
    timer guessing what might be happening. Ends with one
    `{"type": "result", ...}` event carrying the exact same payload shape
    POST /chat returns."""
    message = body.get("message", "")
    if not message.strip():
        raise HTTPException(400, "message is required")
    base_version_id_raw = body.get("base_version_id")
    base_version_id = UUID(base_version_id_raw) if base_version_id_raw else None

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_stage(stage: str) -> None:
            await queue.put({"type": "stage", "stage": stage})

        async def run() -> None:
            try:
                result = await handle_chat_turn(project_id, message, base_version_id, on_stage=on_stage)
                await queue.put({"type": "result", "payload": _result_payload(result)})
            except Exception as e:
                # Mirrors handle_chat_turn's own never-let-a-raw-exception-
                # escape philosophy (see _friendly_provider_error) — a
                # broken stream should still end in one readable error
                # event, not a silently dropped connection.
                await queue.put({"type": "result", "payload": {"kind": "error", "error": str(e)}})
            finally:
                await queue.put(None)  # sentinel: nothing more is coming

        task = asyncio.create_task(run())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps(jsonable_encoder(item))}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
