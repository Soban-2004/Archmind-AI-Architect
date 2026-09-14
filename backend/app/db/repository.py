from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from app.db.client import get_pool
from app.models.state import ArchitectureState


async def create_project(name: str, owner_token: Optional[str] = None) -> dict:
    # owner_token is the one thing standing in for a real account (see
    # schema.sql's own comment on the column) — an opaque, random id the
    # frontend generates once per browser and sends on every request
    # (X-Guest-Token). None here (no header sent) creates a project
    # nobody owns, same as every project created before this column
    # existed — visible/editable by anyone, matching the pre-isolation
    # behavior exactly rather than a new hole.
    pool = await get_pool()
    row = await pool.fetchrow(
        "insert into projects (name, owner_token) values ($1, $2) returning id, name, created_at",
        name,
        owner_token,
    )
    return dict(row)


async def get_project(project_id: UUID, owner_token: Optional[str] = None) -> Optional[dict]:
    # `owner_token is null OR owner_token = $2`: a project with no owner
    # (every project created before this feature existed — e.g. this
    # session's own real "Stock Hinge" project) stays reachable by
    # anyone who already has its id, same as always; a project WITH an
    # owner is only ever returned to that same owner_token. A genuinely
    # nonexistent id and a real-but-not-yours id both return None here on
    # purpose — the caller always turns either into the same 404, so a
    # stranger can never use the response to tell "doesn't exist" apart
    # from "exists but isn't yours". Deliberately NOT filtered on
    # `hidden` for the same "still directly reachable" reason.
    pool = await get_pool()
    row = await pool.fetchrow(
        "select id, name, created_at from projects where id = $1 and (owner_token is null or owner_token = $2)",
        project_id,
        owner_token,
    )
    return dict(row) if row else None


async def list_projects(owner_token: Optional[str]) -> list[dict]:
    """Every NON-hidden project belonging to `owner_token` — strictly
    `owner_token = $1`, no null-matches-anyone fallback the way
    get_project() above has: this is "MY projects", not "every project
    an anonymous caller could also see one at a time by id". A caller
    with no token (owner_token=None) gets an empty list, not everyone
    else's legacy/unowned projects — there's no meaningful "my projects"
    for a caller with no identity at all.

    A project with no versions yet (created but abandoned before the
    first message) sorts by its own created_at instead of last activity.
    node_count/last_activity_at come from each project's own most recent
    version via a lateral join, so this is one query rather than N+1."""
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
        where p.hidden = false and p.owner_token = $1
        order by coalesce(lv.created_at, p.created_at) desc
        """,
        owner_token,
    )
    return [dict(r) for r in rows]


async def rename_project(project_id: UUID, name: str, owner_token: Optional[str] = None) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "update projects set name = $2 where id = $1 and (owner_token is null or owner_token = $3) returning id, name, created_at",
        project_id,
        name,
        owner_token,
    )
    return dict(row) if row else None


async def set_project_hidden(project_id: UUID, hidden: bool) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "update projects set hidden = $2 where id = $1 returning id, name, hidden, created_at",
        project_id,
        hidden,
    )
    return dict(row) if row else None


async def delete_project(project_id: UUID, owner_token: Optional[str] = None) -> bool:
    """Cascades to that project's versions/adrs/messages (schema.sql's `on
    delete cascade`) — one statement, no manual cleanup needed. Same
    null-or-match ownership filter as every other write above — a
    mismatched token deletes 0 rows, indistinguishable from the id not
    existing at all."""
    pool = await get_pool()
    result = await pool.execute(
        "delete from projects where id = $1 and (owner_token is null or owner_token = $2)",
        project_id,
        owner_token,
    )
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


async def get_latest_version(project_id: UUID, owner_token: Optional[str] = None) -> Optional[dict]:
    # Joined to projects for the same null-or-match ownership filter
    # get_project() uses, independently of it — this function has its
    # own real callers (handle_chat_turn's "no base_version_id" branch)
    # that don't necessarily call get_project() first, so it enforces
    # ownership itself rather than trusting an earlier check happened.
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select v.id, v.project_id, v.parent_version_id, v.label, v.kind, v.state, v.layout, v.evidence, v.created_at
        from versions v
        join projects p on p.id = v.project_id
        where v.project_id = $1 and (p.owner_token is null or p.owner_token = $2)
        order by v.created_at desc limit 1
        """,
        project_id,
        owner_token,
    )
    return dict(row) if row else None


async def get_version(version_id: UUID, owner_token: Optional[str] = None) -> Optional[dict]:
    # Same ownership filter as get_project()/get_latest_version() above,
    # via a join since a version has no owner_token of its own — it
    # belongs to whichever project it's under.
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select v.id, v.project_id, v.parent_version_id, v.label, v.kind, v.state, v.layout, v.evidence, v.created_at
        from versions v
        join projects p on p.id = v.project_id
        where v.id = $1 and (p.owner_token is null or p.owner_token = $2)
        """,
        version_id,
        owner_token,
    )
    return dict(row) if row else None


async def update_version_layout(version_id: UUID, layout: dict[str, Any]) -> None:
    pool = await get_pool()
    await pool.execute("update versions set layout = $2 where id = $1", version_id, layout)


async def list_versions(project_id: UUID, owner_token: Optional[str] = None) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select v.id, v.project_id, v.parent_version_id, v.label, v.kind, v.created_at
        from versions v
        join projects p on p.id = v.project_id
        where v.project_id = $1 and (p.owner_token is null or p.owner_token = $2)
        order by v.created_at asc
        """,
        project_id,
        owner_token,
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
