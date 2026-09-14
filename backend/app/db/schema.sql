-- AI Architect schema (spec §3.2). Run this once against your Supabase
-- Postgres database (SQL Editor in the Supabase dashboard, or `psql`).

create extension if not exists pgcrypto;

create table if not exists projects (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    created_at  timestamptz not null default now(),
    -- No login here, by design (a guest-mode app, not an oversight) —
    -- but "no login" and "no privacy between visitors" turned out to be
    -- two different things once asked directly, so this is real, if
    -- lightweight, per-visitor isolation: an opaque random id the
    -- frontend generates once per browser and sends as the X-Guest-Token
    -- header on every request. Person A's browser and Person B's browser
    -- get different tokens, so list_projects() and every project-scoped
    -- read/write in repository.py only ever returns/touches a project
    -- whose owner_token matches the caller's own — Person B genuinely
    -- cannot see or touch Person A's project, not just "it's not in
    -- their list". A project with owner_token IS NULL (every project
    -- created before this column existed) is the one deliberate
    -- exception: reachable by anyone who already has its id, same
    -- behavior it always had — this feature didn't retroactively lock
    -- anyone out of their own pre-existing data.
    --
    -- The real, honest limitation of a token instead of an account:
    -- it lives in one browser's localStorage. Clear site data, switch
    -- browsers, or use a different device, and that identity — and
    -- every project tied to it — is gone for good. There's nothing to
    -- log back in with. That's the deliberate tradeoff for "no signup
    -- screen, just open the app and your projects are yours."
    owner_token text,
    -- `hidden`: a SEPARATE, narrower exception from owner_token above —
    -- for a project belonging to whoever's actually running/demoing this
    -- deployment (kept out of the public browse list even though nobody
    -- else could see it anyway once it's token-owned; mainly relevant
    -- for a legacy owner_token-less project like this repo's own real
    -- "Stock Hinge"). get_project() deliberately does NOT filter on
    -- this column — only list_projects() (the public browse list) does.
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
create index if not exists idx_projects_owner_token on projects(owner_token);

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

-- Same idempotent-add pattern, for a database that already had `projects`
-- from before the `owner_token` column existed. Every pre-existing
-- project gets owner_token=NULL, i.e. the "reachable by anyone with its
-- id" grandfather case schema.sql's own comment on the column describes
-- — never silently locked away from whoever was actually using it.
alter table projects add column if not exists owner_token text;
create index if not exists idx_projects_owner_token on projects(owner_token);
