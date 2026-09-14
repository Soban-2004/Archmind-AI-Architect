-- AI Architect schema (spec §3.2). Run this once against your Supabase
-- Postgres database (SQL Editor in the Supabase dashboard, or `psql`).

create extension if not exists pgcrypto;

create table if not exists projects (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    created_at  timestamptz not null default now(),
    -- This app has no auth or per-user scoping at all (a deliberate
    -- guest-mode design, not an oversight) — every project is visible to
    -- every visitor by default. `hidden` exists for the one real
    -- exception that design needs: a project belonging to whoever's
    -- actually running/demoing this deployment, kept out of the public
    -- list_projects() result while staying fully reachable by anyone who
    -- already has its id (a saved link, or the owner's own browser) —
    -- get_project() below deliberately does NOT filter on this column.
    hidden      boolean not null default false
);

-- One row per version. Never updated in place (spec §3.2) — every mutation
-- inserts a new row. parent_version_id makes this a tree (branches for
-- Phase 3 tiers), not a line, so it's nullable for the very first version.
create table if not exists versions (
    id                 uuid primary key default gen_random_uuid(),
    project_id         uuid not null references projects(id) on delete cascade,
    parent_version_id  uuid references versions(id),
    label              text,
    kind               text not null default 'edit', -- initial | edit | tier | reconstruction
    state              jsonb not null,                -- ArchitectureState
    layout             jsonb not null default '{}',   -- {node_id: {x, y}} — presentation only, never LLM-owned
    -- {"evidence": [Evidence, ...], "citations": {node_id: [evidence_id, ...]}}
    -- from services/ingestion.py's IngestionResult — populated ONLY for
    -- kind='reconstruction' versions, '{}' for every chat/manual edit
    -- (those were never evidence-grounded from a real repo, so there's
    -- honestly nothing to store). Lets a node's real source citations
    -- (which file/line justified it) survive past the one-time ingest
    -- response, so the canvas can show them any time the version is
    -- reopened, not just in the moment right after import.
    evidence           jsonb not null default '{}',
    created_at         timestamptz not null default now()
);

create index if not exists idx_versions_project on versions(project_id);
create index if not exists idx_versions_parent on versions(parent_version_id);

-- Queryable independent of snapshots (spec §3.2). Each ADR is also embedded
-- in the state.adrs of the version it was created in; this table exists so
-- decision history can be queried/filtered without loading full snapshots.
create table if not exists adrs (
    id             uuid primary key default gen_random_uuid(),
    project_id     uuid not null references projects(id) on delete cascade,
    version_id     uuid not null references versions(id) on delete cascade,
    decision       text not null,
    rationale      text not null,
    triggered_by   text not null,
    superseded_by  uuid references adrs(id),
    created_at     timestamptz not null default now()
);

create index if not exists idx_adrs_project on adrs(project_id);

-- Conversation history per project, so the (stateless) backend can
-- reconstruct interview context on every turn.
create table if not exists messages (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references projects(id) on delete cascade,
    role        text not null, -- user | assistant
    content     text not null,
    -- Which version this turn was building on (a question) or produced (an
    -- edit/tier) — lets get_branch_history() scope the conversation a turn
    -- sees to its own branch's ancestry instead of the whole project's flat
    -- log, so an unrelated sibling tier's messages don't confuse the model
    -- (a real, live-observed bug — see README's testing-findings log).
    -- Nullable: messages from before this column existed, or from a
    -- version-less request, still count everywhere via the null check in
    -- get_branch_history's query.
    version_id  uuid references versions(id) on delete set null,
    created_at  timestamptz not null default now()
);

create index if not exists idx_messages_project on messages(project_id, created_at);
create index if not exists idx_messages_version on messages(version_id);

-- Safe to re-run against a database that already had `messages` from
-- before `version_id` existed — `create table if not exists` above is a
-- no-op there, so this picks up the column separately, idempotently.
alter table messages add column if not exists version_id uuid references versions(id) on delete set null;

-- Same idempotent-add pattern, for a database that already had `versions`
-- from before the `evidence` column existed.
alter table versions add column if not exists evidence jsonb not null default '{}';

-- Same idempotent-add pattern, for a database that already had `projects`
-- from before the `hidden` column existed.
alter table projects add column if not exists hidden boolean not null default false;
