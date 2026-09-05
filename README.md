# AI Architect

An architecture intelligence engine: describe a project in plain language, and
a validated command-based state machine (not free-form LLM diagram
generation) builds and renders a structured, versioned system architecture.

See [AI_ARCHITECT_IMPLEMENTATION.md](./AI_ARCHITECT_IMPLEMENTATION.md) for
the full spec, phasing, and the core engineering decision this project is
built around: **the LLM never owns the diagram — it only ever emits
validated mutation commands against a structured state, which is rendered
deterministically.**

Currently implemented: **Phase 1** — new-project requirements interview →
first Architecture State → rendered diagram.

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

## What's next (not yet built)

Phase 2 (conversational editing + diffs) is the next slice — see the
implementation doc's phase list. Note the diagram currently re-lays-out
fully on every render; Phase 2 needs positions to persist per version
(`versions.layout` already exists in the schema for this) so edits don't
reshuffle the whole canvas.
