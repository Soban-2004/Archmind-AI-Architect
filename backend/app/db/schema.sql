-- AI Architect schema (spec §3.2). Run this once against your Supabase
-- Postgres database (SQL Editor in the Supabase dashboard, or `psql`).

create extension if not exists pgcrypto;

create table if not exists projects (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    created_at  timestamptz not null default now()
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
    created_at  timestamptz not null default now()
);

create index if not exists idx_messages_project on messages(project_id, created_at);
