from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from app.db.client import get_pool
from app.models.state import ArchitectureState


async def create_project(name: str) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        "insert into projects (name) values ($1) returning id, name, created_at",
        name,
    )
    return dict(row)


async def get_project(project_id: UUID) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow("select id, name, created_at from projects where id = $1", project_id)
    return dict(row) if row else None


async def create_version(
    project_id: UUID,
    state: ArchitectureState,
    kind: str,
    parent_version_id: Optional[UUID] = None,
    label: Optional[str] = None,
    layout: Optional[dict[str, Any]] = None,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into versions (project_id, parent_version_id, label, kind, state, layout)
        values ($1, $2, $3, $4, $5, $6)
        returning id, project_id, parent_version_id, label, kind, state, layout, created_at
        """,
        project_id,
        parent_version_id,
        label,
        kind,
        state.model_dump(mode="json"),
        layout or {},
    )
    return dict(row)


async def get_latest_version(project_id: UUID) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select id, project_id, parent_version_id, label, kind, state, layout, created_at
        from versions where project_id = $1
        order by created_at desc limit 1
        """,
        project_id,
    )
    return dict(row) if row else None


async def get_version(version_id: UUID) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select id, project_id, parent_version_id, label, kind, state, layout, created_at
        from versions where id = $1
        """,
        version_id,
    )
    return dict(row) if row else None


async def list_versions(project_id: UUID) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, project_id, parent_version_id, label, kind, created_at
        from versions where project_id = $1
        order by created_at asc
        """,
        project_id,
    )
    return [dict(r) for r in rows]


async def create_adrs(project_id: UUID, version_id: UUID, adrs: list[dict]) -> None:
    if not adrs:
        return
    pool = await get_pool()
    await pool.executemany(
        """
        insert into adrs (project_id, version_id, decision, rationale, triggered_by)
        values ($1, $2, $3, $4, $5)
        """,
        [(project_id, version_id, a["decision"], a["rationale"], a["triggered_by"]) for a in adrs],
    )


async def add_message(project_id: UUID, role: str, content: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "insert into messages (project_id, role, content) values ($1, $2, $3)",
        project_id,
        role,
        content,
    )


async def get_messages(project_id: UUID) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select role, content, created_at from messages where project_id = $1 order by created_at asc",
        project_id,
    )
    return [dict(r) for r in rows]
