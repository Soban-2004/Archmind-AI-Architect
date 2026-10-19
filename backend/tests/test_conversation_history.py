"""Private conversation history must be gated before repository access."""
import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from fastapi import FastAPI

from app.api.routes import projects


def test_history_is_private_before_any_messages_are_read():
    async def check():
        app = FastAPI()
        app.include_router(projects.router)
        read_messages = AsyncMock(side_effect=AssertionError("private messages were read"))
        with patch.object(projects.repo, "get_project", AsyncMock(return_value=None)) as owner_check, patch.object(projects.repo, "get_messages", read_messages):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                project_id = uuid4()
                response = await client.get(f"/projects/{project_id}/messages", headers={"X-Guest-Token": "other-browser"})
                assert response.status_code == 404
                owner_check.assert_awaited_once_with(project_id, "other-browser")
                read_messages.assert_not_awaited()
    asyncio.run(check())


def test_owned_history_preserves_message_order_and_timestamps():
    async def check():
        app = FastAPI()
        app.include_router(projects.router)
        project_id = uuid4()
        history = [
            {"role": "user", "content": "Build a storefront", "created_at": "2026-10-14T12:00:00Z"},
            {"role": "assistant", "content": "What traffic do you expect?", "created_at": "2026-10-14T12:00:01Z"},
        ]
        with patch.object(projects.repo, "get_project", AsyncMock(return_value={"id": project_id})), patch.object(projects.repo, "get_messages", AsyncMock(return_value=history)) as read_messages:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get(f"/projects/{project_id}/messages", headers={"X-Guest-Token": "owner-browser"})
                assert response.status_code == 200
                assert response.json() == history
                read_messages.assert_awaited_once_with(project_id)
    asyncio.run(check())
