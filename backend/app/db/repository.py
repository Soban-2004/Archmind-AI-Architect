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


async def list_projects() -> list[dict]:
    """Every project, newest-activity-first — a project with no versions
    yet (created but abandoned before the first message) sorts by its own
    created_at instead. node_count/last_activity_at come from each
    project's own most recent version via a lateral join, so this is one
    query rather than N+1."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select p.id, p.name, p.created_at,
               lv.created_at as last_activity_at,
               lv.node_count
        from projects p
        left join lateral (
            select v.created_at, jsonb_array_length(v.state -> 'nodes') as node_count
            from versions v
            where v.project_id = p.id
            order by v.created_at desc
            limit 1
        ) lv on true
        order by coalesce(lv.created_at, p.created_at) desc
        """
    )
    return [dict(r) for r in rows]


async def rename_project(project_id: UUID, name: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "update projects set name = $2 where id = $1 returning id, name, created_at",
        project_id,
        name,
    )
    return dict(row) if row else None


async def delete_project(project_id: UUID) -> bool:
    """Cascades to that project's versions/adrs/messages (schema.sql's `on
    delete cascade`) — one statement, no manual cleanup needed."""
    pool = await get_pool()
    result = await pool.execute("delete from projects where id = $1", project_id)
    return result != "DELETE 0"


async def create_version(
    project_id: UUID,
    state: ArchitectureState,
    kind: str,
    parent_version_id: Optional[UUID] = None,
    label: Optional[str] = None,
    layout: Optional[dict[str, Any]] = None,
    evidence: Optional[dict[str, Any]] = None,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into versions (project_id, parent_version_id, label, kind, state, layout, evidence)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id, project_id, parent_version_id, label, kind, state, layout, evidence, created_at
        """,
        project_id,
        parent_version_id,
        label,
        kind,
        state.model_dump(mode="json"),
        layout or {},
        evidence or {},
    )
    return dict(row)


async def get_latest_version(project_id: UUID) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select id, project_id, parent_version_id, label, kind, state, layout, evidence, created_at
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
        select id, project_id, parent_version_id, label, kind, state, layout, evidence, created_at
        from versions where id = $1
        """,
        version_id,
    )
    return dict(row) if row else None


async def update_version_layout(version_id: UUID, layout: dict[str, Any]) -> None:
    pool = await get_pool()
    await pool.execute("update versions set layout = $2 where id = $1", version_id, layout)


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


async def add_message(project_id: UUID, role: str, content: str, version_id: Optional[UUID] = None) -> UUID:
    """`version_id` is the version this turn was building on (a question,
    which creates nothing new) or the version it produced (an edit/tier) —
    see get_branch_history(). Returns the new message's id so a caller can
    retag it later via set_message_version once an outcome is known (the
    user's own message is inserted before handle_chat_turn knows what it's
    going to produce)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "insert into messages (project_id, role, content, version_id) values ($1, $2, $3, $4) returning id",
        project_id,
        role,
        content,
        version_id,
    )
    return row["id"]


async def set_message_version(message_id: UUID, version_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute("update messages set version_id = $2 where id = $1", message_id, version_id)


async def get_messages(project_id: UUID) -> list[dict]:
    """Every message in the project, flat — kept for anything that
    genuinely wants the whole log (not currently used by the interview
    loop itself; see get_branch_history for that)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "select role, content, created_at from messages where project_id = $1 order by created_at asc",
        project_id,
    )
    return [dict(r) for r in rows]


async def get_branch_history(project_id: UUID, version_id: Optional[UUID]) -> list[dict]:
    """The conversation relevant to `version_id`'s own branch: messages
    tagged with `version_id` itself or any of its ancestors (walking
    parent_version_id up to the root), plus any untagged message (legacy
    rows from before this column existed, or a version-less project) —
    never a sibling tier's or a different branch's conversation. Falls
    back to the full flat log when `version_id` is None (a brand new
    project has no version to scope by yet, so nothing to exclude)."""
    if version_id is None:
        return await get_messages(project_id)

    pool = await get_pool()
    rows = await pool.fetch(
        """
        with recursive ancestry as (
            select id, parent_version_id from versions where id = $2
            union all
            select v.id, v.parent_version_id
            from versions v
            join ancestry a on v.id = a.parent_version_id
        )
        select m.role, m.content, m.created_at
        from messages m
        where m.project_id = $1
          and (m.version_id is null or m.version_id in (select id from ancestry))
        order by m.created_at asc
        """,
        project_id,
        version_id,
    )
    return [dict(r) for r in rows]
