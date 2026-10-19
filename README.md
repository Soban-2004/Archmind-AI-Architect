# ArchMind

**Design, validate, and pressure-test software architecture with AI.**

[Live application](https://140.245.234.125) · [Product overview](./PRODUCT.md) · [Design system](./DESIGN.md) · [Production deployment](./deploy/README.md)

ArchMind turns a product idea or an existing repository into a structured system architecture. You can refine it through conversation or direct canvas edits, compare versions, inspect costs and risks, simulate load and failures, and export a starter kit for implementation.

![ArchMind in dark mode](./docs/archmind-dark.png)

The central rule is simple: **the LLM never draws or mutates the diagram directly.** It proposes typed mutation commands such as `add_node`, `add_edge`, and `update_node`. The backend validates those commands against the architecture schema and structural rules before creating a version. The frontend then renders the accepted state deterministically.

This same pipeline handles AI suggestions, manual canvas changes, and repository reconstruction. There is no separate unchecked editing path.

## What ArchMind can do

- **Requirements interview:** turns a short product description into an architecture after collecting the scale, budget, availability, and platform constraints that matter.
- **Conversational refinement:** answers architecture questions, proposes targeted changes, and creates a new version only when the architecture actually changes.
- **Direct canvas editing:** add, connect, edit, reposition, and delete components without spending LLM tokens. Manual changes still use the same validation and versioning engine.
- **Version history:** branch from earlier versions, inspect diffs, compare any two designs, and keep architecture decisions traceable.
- **Architecture Analyzer:** scores scalability, reliability, security, cost, observability, performance, and maintainability with deterministic findings and evidence.
- **Load and failure simulation:** vary traffic, kill dependencies, and inspect propagated load, utilization, bottlenecks, and failure order on the canvas.
- **Cost and capacity estimation:** applies declared assumptions for roughly 30 service, database, queue, dependency, and infrastructure types.
- **Repository reconstruction:** upload a ZIP or paste a public GitHub repository URL. ArchMind extracts source-attributed evidence from supported Python and JavaScript/TypeScript projects before asking the model to reconstruct the system.
- **Evidence and rationale:** inspect why a component exists and, for imported systems, which source files support it.
- **Exports:** download diagrams or a starter-kit ZIP containing `ARCHITECTURE.md`, `AI_BRIEF.md`, `docker-compose.yml`, and `.env.example`.
- **Guest projects:** no signup is required. A private per-browser token scopes project access.
- **Responsive themes:** the Redline & Moss visual system includes light and dark modes, reduced-motion support, responsive workbench navigation, and accessible semantic states.

## How it works

```mermaid
flowchart LR
    A[Idea, question, or repo evidence] --> B[Intent router]
    B -->|Question or advice| C[Compact advisory context]
    B -->|Architecture change| D[Typed mutation commands]
    B -->|Deterministic task| E[Non-LLM handler]
    D --> F[Schema and structural validation]
    E --> F
    F --> G[Versioned PostgreSQL state]
    G --> H[Deterministic React Flow canvas]
    G --> I[Analyzer, simulator, compare, and export]
```

The backend remains authoritative. Canvas coordinates, visual effects, and UI state never replace the stored architecture model.

## Token and reliability controls

ArchMind is designed to avoid sending the entire session to an LLM on every turn.

- Common greetings, checklist answers, and deterministic edits use zero-token paths where possible.
- Intent routing separates mutations, advisory questions, analysis, and unrelated requests before choosing a prompt.
- Advisory questions receive a compact topology instead of the mutation-capable full state.
- Edit prompts omit accumulated ADR history and deterministically truncate verbose free-text fields while preserving IDs and structural facts.
- Conversation context is branch-aware. A durable project brief and the most recent messages are retained; older messages are trimmed to a token budget.
- User messages are capped at 6,000 characters, output defaults to 1,800 tokens, and a preflight estimate rejects requests that cannot safely fit.
- Only one repair attempt is allowed, with a 12,000-token cumulative ceiling for a turn.
- Actual provider usage is returned to the frontend and displayed as last-turn and cumulative session tokens.
- Optional provider fallback reduces failures caused by one provider's quota or availability.

These controls reduce token use without summarizing away node IDs, edges, constraints, or other facts required for safe mutations.

## Technology

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Architecture canvas | React Flow and dagre |
| Backend | FastAPI, Pydantic, asyncpg |
| Database | PostgreSQL 16 |
| Architect providers | OpenRouter when configured, then Groq, then optional Mistral fallback |
| Optional review | Gemini structural judge |
| Optional web grounding | Tavily for time-sensitive advisory questions |
| Production | Docker Compose, Caddy, OCI Ampere A1 |

## Repository layout

```text
backend/
  app/api/          FastAPI routes
  app/db/           PostgreSQL schema and repository
  app/llm/          providers, prompts, token estimation, fallback
  app/models/       architecture, commands, analysis, simulation
  app/services/     interview, validation, ingestion, analysis, export
  tests/            backend regression tests

frontend/
  src/app/          Next.js routes and global design tokens
  src/components/   workbench, canvas, panels, landing, shared UI
  src/lib/          API client, graph transforms, theme and state helpers

deploy/             OCI, Caddy, backup, verification, and setup scripts
compose.production.yml
DESIGN.md           final Redline & Moss design system
```

## Local development

### Prerequisites

- Python 3.12+
- Node.js 22+
- PostgreSQL 16 or a Supabase PostgreSQL project
- A Groq API key

### 1. Configure PostgreSQL

Create a database, then apply the schema:

```bash
psql "postgresql://USER:PASSWORD@HOST:5432/DATABASE" -f backend/app/db/schema.sql
```

The environment variable is still named `SUPABASE_DB_URL` for compatibility, but it accepts a standard PostgreSQL connection URL.

### 2. Start the backend

```bash
cd backend
python -m venv .venv
```

Activate the environment:

```bash
# macOS or Linux
source .venv/bin/activate

# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

Install dependencies and configure the service:

```bash
pip install -r requirements.txt
cp .env.example .env
```

At minimum, set these values in `backend/.env`:

```env
SUPABASE_DB_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
GROQ_API_KEY=gsk_...
CORS_ORIGINS=http://localhost:3000
```

Then start FastAPI:

```bash
uvicorn app.main:app --reload --port 8000
```

Verify it at [http://localhost:8000/health](http://localhost:8000/health).

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Yes | PostgreSQL connection URL |
| `GROQ_API_KEY` | Yes | Required architect provider |
| `GROQ_MODEL` | No | Groq model override |
| `LLM_MAX_OUTPUT_TOKENS` | No | Completion ceiling; defaults to `1800` |
| `OPENROUTER_API_KEY` | No | First optional fallback provider |
| `OPENROUTER_MODEL` | No | OpenRouter model override |
| `MISTRAL_API_KEY` | No | Final optional fallback provider |
| `MISTRAL_MODEL` | No | Mistral model override |
| `GEMINI_API_KEY` | No | Enables the independent structural judge |
| `GEMINI_MODEL` | No | Gemini judge model override |
| `TAVILY_API_KEY` | No | Enables web-grounded current-information answers |
| `CORS_ORIGINS` | Yes in production | Comma-separated allowed frontend origins |
| `NEXT_PUBLIC_API_URL` | Yes for frontend | Backend origin locally; `/api` in the Docker deployment |

See [`backend/.env.example`](./backend/.env.example) and [`deploy/production.env.example`](./deploy/production.env.example) for the complete templates. Never commit populated environment files.

## Validation

Run the backend suite:

```bash
cd backend
pytest
```

Validate the frontend:

```bash
cd frontend
npm run lint
npm run build
```

Tests cover mutation validation, intent routing, context budgets, project isolation, provider fallback, repository evidence, analysis, comparison, sizing, simulation, and error handling.

## Production deployment

The live portfolio deployment runs on an OCI Ampere A1 instance using ARM64-compatible containers:

- Caddy owns public ports 80 and 443, redirects HTTP to HTTPS, and proxies `/api/*` to FastAPI.
- Next.js and FastAPI are private Docker services.
- PostgreSQL is reachable only on the private application network and persists in a named volume.
- Ports 3000, 8000, and 5432 are not exposed publicly.
- Caddy manages the HTTPS certificate for the public IP and can switch to a domain later.

The server layout supports multiple projects behind the same gateway:

```text
/opt/apps/gateway
/opt/apps/archmind
/opt/apps/project-2
/opt/apps/project-3
```

After configuring `deploy/production.env` and the shared gateway, deploy ArchMind with:

```bash
docker compose --env-file deploy/production.env -f compose.production.yml config --quiet
docker compose --env-file deploy/production.env -f compose.production.yml up -d --build
./deploy/verify.sh
```

Operational instructions, NSG rules, HTTPS setup, custom-domain steps, backups, and update commands are documented in [`deploy/README.md`](./deploy/README.md).

Deployment is currently manual. Pushing to GitHub does **not** automatically update the OCI instance; the production Compose stack must be rebuilt after new source is transferred or pulled.

## Security and current limitations

- Guest ownership is based on a random token stored in browser local storage. Clearing site data loses the browser's reference to those projects. This is privacy isolation, not a full account system.
- API routes are rate-limited per IP: general traffic defaults to 60 requests per minute, LLM endpoints to 20 per hour, and ingestion to 10 per hour.
- Rate-limit counters use in-memory storage and reset when the backend restarts. A multi-instance deployment should move them to Redis.
- Simulation and cost results are deterministic planning estimates based on declared assumptions. They are not benchmarks, cloud-provider quotes, or production guarantees.
- Repository import supports the detected ecosystems documented in the UI; it does not claim complete language or framework coverage.
- Provider quotas and free-model availability can change. Provider failures are surfaced as readable errors and optional fallbacks are attempted when configured.
- The public portfolio deployment is intentionally a single-node system without high availability.

## Additional documentation

- [`PRODUCT.md`](./PRODUCT.md) — product scope and supported workflow
- [`PRODUCT_WORKFLOW_REVIEW.md`](./PRODUCT_WORKFLOW_REVIEW.md) — product and engineering review
- [`DESIGN.md`](./DESIGN.md) — final visual system, themes, typography, and motion rules
- [`DEVLOG.md`](./DEVLOG.md) — chronological engineering decisions and live-test findings
- [`AI_ARCHITECT_IMPLEMENTATION.md`](./AI_ARCHITECT_IMPLEMENTATION.md) — original implementation specification
- [`deploy/README.md`](./deploy/README.md) — OCI production operations

## License

No license file is currently included. All rights are reserved by the repository owner unless a license is added.
