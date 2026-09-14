# AI Architect

Describe a system in plain language — *"a stock trading app for college
students"* — and get back a real, structured system architecture: a
canvas of services, databases, queues, and infrastructure, versioned,
cost-estimated, and load-tested, that you can keep editing by chat or by
hand.

**The core idea the whole project is built around: the LLM never draws
the diagram.** It only ever emits a small set of validated *mutation
commands* — add this node, connect these two, change this field — which
are checked against real structural rules (connectivity, schema,
duplicate nodes) before anything reaches the canvas. The diagram itself
is always rendered deterministically from that checked state. This is
also why the same guarantee holds no matter *who* proposes a change: a
chat message, a manual drag-and-drop edit, or an imported repo all go
through the identical validated pipeline — there's no separate, less-
trusted path.

See [AI_ARCHITECT_IMPLEMENTATION.md](./AI_ARCHITECT_IMPLEMENTATION.md)
for the full original spec this was built against, and
[DEVLOG.md](./DEVLOG.md) for the real, chronological build log — every
bug a live run against a real model and a real database actually
surfaced, and how it got found and fixed. This file is the overview.

## What it does

- **Describe → build.** A short requirements interview (users, scale,
  budget, availability) produces the first real architecture — never a
  single LLM call guessing at a diagram, always the validated command
  pipeline above.
- **Keep talking to it.** Every edit is a new, diffed, versioned commit —
  the canvas highlights exactly what changed. Ask for "the $0 student
  version" or "production for 1M users" and get a fresh, grounded sibling
  architecture, not a resize of the current one. Compare any two versions
  and get a deterministic diff plus an LLM narration that can only
  reference facts actually in that diff.
- **Or build it by hand.** Add, connect, edit, or delete components
  directly on the canvas — the exact same validated pipeline a chat edit
  uses, with real undo/redo.
- **Every component explains itself.** Not a generic textbook definition
  — a real, project-specific reason *this* architecture needs *this*
  node, tied to what you actually asked for.
- **A real cost and capacity model**, not a flat guess: ~30 component
  types across services, databases, queues, external dependencies, and
  infrastructure, each with declared, versioned capacity/cost
  assumptions that scale with compute size, storage, and the actual
  engine you name (CockroachDB and Postgres are not priced the same;
  neither are DynamoDB and Redis).
- **Simulate load and failure.** Pick a traffic multiplier or kill a
  component and watch a deterministic capacity-propagation model show
  what breaks, in what order, and why — animated live on the canvas.
- **A deterministic Analyzer** scores any version across 7 categories
  (scalability, reliability, security, cost, observability, performance,
  maintainability), citing the exact facts behind each finding — and a
  one-click **"Fix it"** button hands a specific finding straight to the
  architect agent to resolve.
- **Import a real, existing repo** — upload a zip or just paste a GitHub
  URL — and a deterministic discovery pipeline (imports, routes, ORM
  models, SQL migrations, real third-party API calls, auth usage) hands
  the LLM only discrete, source-attributed facts, never raw code, which
  it reconstructs into a real architecture. Every proposed component is
  checked against real citations before it's accepted — click a node to
  see the exact file and line that justified it. Works across Python,
  JS/TS, and the common frameworks/ORMs/BaaS platforms in each, not just
  one stack.
- **Export a real starter kit** — `ARCHITECTURE.md`, `AI_BRIEF.md` (a
  dependency-ordered build plan meant to be handed straight to a coding
  agent), a real `docker-compose.yml` with runnable images for every
  component that has an honest local equivalent, and `.env.example` —
  turning a validated design into an actual starting point, not just a
  picture of one.
- **Guest mode, with real privacy.** No login, no signup — but your
  projects are genuinely only visible to you, not every other visitor,
  via a private per-browser identity. See [DEVLOG.md](./DEVLOG.md)'s
  last two sections for exactly how, and its one honest limitation.

## Project layout

```
backend/   FastAPI + Pydantic — Architecture State schema, mutation engine,
           the Groq/Gemini interview loop, deterministic Analyzer/Simulator,
           repo-ingestion pipeline, per-visitor isolation
frontend/  Next.js + React Flow + dagre — chat panel, the deterministic
           canvas, manual editing, simulation playback
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

## Deployment

The database is already hosted (it's the same Supabase project from Setup
above) — deploying just means giving the frontend and backend a real,
public home. Recommended pair: **Vercel** for the frontend (built by the
Next.js team, zero-config), **Render** for the backend (a plain
always-on Python process, no serverless cold-start weirdness for the
in-memory rate limiter — see the note below).

### Backend → Render

1. [render.com](https://render.com) → sign in with GitHub → **New +** →
   **Blueprint** → pick this repo. Render reads
   [`backend/render.yaml`](./backend/render.yaml) and proposes one web
   service (`ai-architect-backend`) — approve it.
2. It'll pause on deploy asking for the env vars marked `sync: false` in
   that file: `SUPABASE_DB_URL`, `GROQ_API_KEY`, optionally
   `GEMINI_API_KEY`/`TAVILY_API_KEY`, and `CORS_ORIGINS` (leave this one
   blank for now — circle back once the frontend has a real URL, step 3
   below).
3. No Blueprint file? Manual setup works identically: **New +** → **Web
   Service** → this repo → **Root Directory**: `backend` → **Build
   Command**: `pip install -r requirements.txt` → **Start Command**:
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT` → add the same env
   vars by hand.
4. Once deployed, Render gives you a URL like
   `https://ai-architect-backend.onrender.com` — visit `/health` to
   confirm it's actually up (same fail-fast-on-bad-DB-URL check as
   local dev).

**Stay on the free tier's single instance.** `rate_limit.py`'s per-IP
counters are in-memory (documented in that module) — correct on exactly
one process, silently too permissive across several. Don't turn on
autoscaling later without first moving that to a Redis-backed store.

### Frontend → Vercel

1. [vercel.com](https://vercel.com) → sign in with GitHub → **Add New** →
   **Project** → pick this repo.
2. **Root Directory**: `frontend` (this is the one setting that matters —
   Vercel auto-detects Next.js and needs no other config for this repo).
3. **Environment Variables** → add `NEXT_PUBLIC_API_URL` = the Render URL
   from above (e.g. `https://ai-architect-backend.onrender.com`, no
   trailing slash).
4. Deploy. Vercel gives you a real URL, e.g.
   `https://ai-architect-yourname.vercel.app`.

### Close the loop

Go back to Render → the backend service's environment variables → set
`CORS_ORIGINS` to that real Vercel URL (comma-separated if you end up
with more than one, e.g. a production and a preview domain) → save
(Render redeploys automatically). Without this step the deployed
frontend's requests get silently blocked by the browser's own CORS
check — `CORS_ORIGINS` defaults to `localhost` only.

Visit the Vercel URL — that's the real, live app.

## Learn more

- [AI_ARCHITECT_IMPLEMENTATION.md](./AI_ARCHITECT_IMPLEMENTATION.md) —
  the original spec and phasing this project was built against.
- [DEVLOG.md](./DEVLOG.md) — the real, chronological build log: every
  bug a live run against a real Groq key, a real Supabase database, and
  real repos surfaced, how it was found, and how it was fixed and
  re-verified. This is the source of truth for *why* something works the
  way it does, if you're curious.
