# AI Architect

An architecture intelligence engine: describe a project in plain language, and
a validated command-based state machine (not free-form LLM diagram
generation) builds and renders a structured, versioned system architecture.

See [AI_ARCHITECT_IMPLEMENTATION.md](./AI_ARCHITECT_IMPLEMENTATION.md) for
the full spec, phasing, and the core engineering decision this project is
built around: **the LLM never owns the diagram — it only ever emits
validated mutation commands against a structured state, which is rendered
deterministically.**

Currently implemented:
- **Phase 1** — new-project requirements interview → first Architecture
  State → rendered diagram.
- **Phase 2** — conversational editing: every edit produces a new,
  diffed version; the canvas highlights what changed (green/amber/red-dashed
  ghost) instead of just re-rendering; positions persist across edits
  instead of reshuffling; every meaningful edit gets an ADR (LLM-authored,
  or a deterministic templated fallback if it forgets); unambiguous
  requests ("remove the queue") resolve without an LLM call at all.
- **Phase 3** — architecture tiers: "show me the $0 student version" or
  "production for 1M users" generates a fresh sibling version (not an edit
  of the current graph) grounded in a small reference-pattern library and
  the project's known constraints. A compare view picks any two versions
  and gets the deterministic structural diff plus an LLM narration that's
  only allowed to reference facts actually present in that diff — anything
  else is filtered out before it reaches the UI.
- **Phase 4** — the Analyzer: a versioned, deterministic rule engine scores
  any version across 7 categories (scalability, reliability, security,
  cost, observability, performance, maintainability), citing the exact
  node/edge facts that triggered each finding. Follow-up questions ("why
  is scalability only 62?") get an LLM-authored explanation that can only
  cite findings the rule engine actually produced — the score itself is
  never computed or touched by the LLM.

## Project layout

```
backend/   FastAPI + Pydantic (Architecture State schema, mutation engine, Groq interview loop)
frontend/  Next.js + React Flow + dagre (chat panel + deterministic canvas)
```

## Setup

### 1. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run [`backend/app/db/schema.sql`](./backend/app/db/schema.sql).
3. Project Settings → Database → Connection string → URI. Copy it.

### 2. Groq (LLM)

1. Get a free API key at [console.groq.com](https://console.groq.com).

### 3. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env          # fill in SUPABASE_DB_URL and GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/health` to confirm it's up (this also confirms
the DB connection, since the app fails fast on startup if `SUPABASE_DB_URL`
is wrong).

### 4. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # defaults to http://localhost:8000, adjust if needed
npm run dev
```

Visit `http://localhost:3000`. Describe a project (e.g. *"I want to build a
stock trading app for college students"*) — the system asks a few
clarifying questions, then renders the first architecture on the canvas.

## Design notes carried into this implementation

- **Mutation commands only.** The LLM's only output shape is
  `InterviewTurnOutput` (`ask_question` | `propose_architecture` with a
  closed set of typed commands) — see
  [`backend/app/models/commands.py`](./backend/app/models/commands.py).
  Every command is schema-validated before being applied
  ([`backend/app/services/mutation_engine.py`](./backend/app/services/mutation_engine.py));
  failures are fed back to the model as structured errors for a bounded
  number of retries, never silently dropped.
- **Local `ref` aliasing.** New nodes and the edges between them are
  proposed in the same batch, before the server has minted real ids — the
  model wires them together with a local `ref` string, resolved to real ids
  by the mutation engine. This also protects against edge injection: the
  model cannot fabricate an edge to any id the engine can't resolve.
- **Layout is never LLM output.** The diagram's positions are computed by
  `dagre` from the graph structure alone
  ([`frontend/src/lib/layout.ts`](./frontend/src/lib/layout.ts)).
- **Versions are immutable.** Every accepted mutation batch inserts a new
  `versions` row rather than updating one in place, which is what makes
  version history/diffing/tiering (Phases 2–3) free later instead of a
  retrofit.

## Phase 2 design notes

- **Diff engine** ([`backend/app/services/diff.py`](./backend/app/services/diff.py))
  is pure and order-independent — it takes any two `ArchitectureState`s, not
  just a parent/child pair, so it already supports Phase 3's arbitrary
  version comparison. Nodes are matched by id; edges by `(from_id, to_id)`
  since there's no `update_edge` command, so a protocol change reads as
  "changed" rather than an unrelated remove+add.
- **Layout persistence.** `versions.layout` is filled in by the *frontend*
  (dagre and incremental placement are JS-side) via
  `PUT /versions/{id}/layout`, immediately after each render. Existing
  nodes carry their position forward unchanged
  ([`frontend/src/lib/incrementalLayout.ts`](./frontend/src/lib/incrementalLayout.ts));
  only genuinely new nodes get placed, near the centroid of their connected
  neighbors. Full dagre re-layout only happens when there's no persisted
  layout to build on yet.
- **ADR guarantee.** If the model's `propose_architecture` output doesn't
  include an `annotate_decision`, the backend appends a templated one
  derived purely from the diff summary
  ([`backend/app/services/adr.py`](./backend/app/services/adr.py)) — every
  edit is guaranteed a rationale on record without depending on model
  compliance.
- **Deterministic fast path** ([`backend/app/services/deterministic.py`](./backend/app/services/deterministic.py))
  implements §7's "no LLM call" tier for the unambiguous case: "remove/delete
  X" resolves directly to a `remove_node` command when exactly one node
  matches by name, skipping the LLM turn entirely. Anything ambiguous falls
  through to the interview loop.
- **Version history is read-only for now.** Clicking an older version in
  the right-hand panel shows it (with its diff against its own parent) but
  new chat edits always continue from the true latest version — branching
  from an older version is Phase 3's tiering work, not built yet.

## Phase 3 design notes

- **Tiers branch, they don't chain.** Every chat call now carries an
  explicit `base_version_id` (whatever the frontend currently has active)
  instead of the backend always assuming "the most recently created row."
  This is what lets a "$0 student" tier and a "production, 1M users" tier
  both branch off the *same* base rather than the second one accidentally
  branching off the first. It also means editing from an older version in
  history now properly branches instead of being blocked, which is a
  generalization of Phase 2's read-only restriction, not a new special
  case.
- **A tier is a fresh generation, not an edit.** The model builds it from
  an empty state via the same `add_node`/`add_edge` + local-`ref`
  mechanism as the very first Phase 1 architecture — it does not reuse the
  base's node ids. One consequence worth knowing: because node identity is
  id-based, the diff between a base and a tier shows even structurally
  identical components (e.g. the frontend) as "removed + added" rather
  than "unchanged," since their ids differ across independently-generated
  graphs. This is an honest diff (they really are two separate generated
  graphs), just not the friendliest possible one — a future refinement
  would match unmatched nodes by `(kind, name)` across tier comparisons
  specifically, without changing Phase 2's edit-diff semantics (where
  id-based matching is exactly correct, since renames should show as
  "changed", not "removed+added").
- **Explanation groundedness is enforced in code, not just prompted.** The
  compare LLM call is given only the deterministic diff, both versions'
  constraints, and both versions' ADRs — nothing else — and every
  explanation it returns must carry a `ref` that matches a real diff entry
  exactly; anything that doesn't is dropped before the result reaches the
  API response (`backend/app/services/compare.py`).
- **Reference patterns are grounding, not a template engine.** The list in
  `backend/app/llm/reference_patterns.py` is fed into the tier-generation
  prompt as context the model reasons over — it is explicitly instructed
  not to apply patterns mechanically. There is no code path that turns a
  pattern into a command directly.

## Phase 4 design notes

- **The rule engine is plain Python, not a DSL.** Each rule in
  `backend/app/analyzer/rules.py` is a function
  `ArchitectureState -> list[Finding]`, registered in `ALL_RULES`. This
  keeps them easy to read and test individually, at the cost of not being
  data-driven — adding a rule means adding a function, not editing a config
  file. `RULES_VERSION` is bumped whenever a condition or point value
  changes, so a Scorecard stays attributable to the exact rules that
  produced it (spec's "explicit, versioned rule set").
- **Scoring formula:** every category starts at 100; each fired finding
  subtracts its severity's points (minor 5 / moderate 15 / major 30),
  floored at 0; the overall score is the unweighted mean of the 7 category
  scores. `score_architecture` is a pure function — re-running it on an
  unchanged state is byte-identical, which is what makes it possible to
  test §10's "analyzer consistency" requirement directly (see the
  determinism assertion in the commit history / test script).
- **11 rules ship at v1**, deliberately not exhaustive — one or more per
  category, each citing real node/edge ids as evidence rather than a
  vague category-level statement. `no_replica` fires under *both*
  scalability and reliability per the spec's own example, from one shared
  condition check.
- **The "why" Q&A is the same grounding pattern as Phase 3's compare
  view**: the LLM gets the already-computed Scorecard and is told never to
  recompute or contradict it, only cite specific `rule_id`s; any cited id
  that isn't a real finding on that scorecard is dropped before the answer
  reaches the API response.

## What's next (not yet built)

Phase 5 — existing-project ingestion (repo/ZIP → static analysis →
evidence graph → LLM reasoning over evidence → Architecture State via the
same validated mutation commands used everywhere else).
