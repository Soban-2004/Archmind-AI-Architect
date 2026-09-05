# AI Architect — Implementation Plan

> An AI architecture intelligence platform that converts natural-language requirements
> and existing codebases into a structured, stateful system architecture — then lets you
> analyze, stress-test, and evolve it toward production.

**This is a planning/spec document for Claude Code.** No code is included here. Use this
as the source of truth for scope, architecture, phasing, and acceptance criteria. Build
incrementally, phase by phase, and do not skip ahead — each phase must be demoable on
its own before starting the next.

---

## 0. Product Positioning (read this first)

This is **not** a "voice system design assistant" and **not** a "ChatGPT wrapper that
draws diagrams." The product is:

> **An architecture intelligence engine** that maintains a structured, queryable
> representation of a system's architecture (the **Architecture State**), which can be
> created two ways — from a natural-language conversation, or from analyzing an existing
> codebase — and which powers visualization, simulation, analysis, and blueprint
> generation on top of that single shared state.

Voice is explicitly **out of scope** for this project (decided separately — this is the
"AI Architecture Engineer" resume project, not the Voice AI project). Interaction is via
text chat + an interactive architecture canvas.

**The single most important engineering decision, non-negotiable:**

> The LLM never directly owns or free-generates the diagram. The LLM only ever emits
> **structured, validated mutation commands** against the Architecture State. The
> visualization is a deterministic render of that state, not an LLM output.

If this rule is violated anywhere in the implementation, treat it as a bug. This
decision is what separates this project from a shallow "LLM + Mermaid" wrapper and is
the primary thing that makes it defensible in an interview.

---

## 1. Goals

- Build a genuinely deep, defensible portfolio project for an **AI Engineer** resume
  slot (not RAG-over-documents — this resume already has two RAG projects; this project
  must prove **different** skills: structured state management, static code analysis,
  deterministic agent tool-calling, graph modeling, and simulation).
- Ship a working, demoable product at the end of **every phase**, not just at the end.
- Stay on a mostly free/open-source stack, buildable solo.
- Avoid scope collapse: prefer a smaller, deeper, real system over a large, shallow one.

## 2. Non-Goals (explicitly out of scope)

- Voice/speech interaction (text chat only).
- Supporting "any GitHub repo in any language" — MVP explicitly limits language/infra
  coverage (see §6.5). Do not try to generalize early.
- Real cloud deployment / IaC execution (Terraform apply, actual AWS provisioning) —
  this is a **simulation and advisory** tool, not an infrastructure-provisioning tool.
- Perfectly accurate physical simulation — the simulation engine is a **constraint-based
  heuristic model**, not a discrete-event queueing simulator with validated real-world
  accuracy. Be explicit about this in the README (see §11) so it isn't misread as fake
  rigor.
- Multi-tenant SaaS, billing, teams/collaboration — single-user only.

---

## 3. Core Abstraction: Architecture State

Everything in this product reads from and writes to one shared, structured
representation. Design this schema first, before any UI or LLM work.

### 3.1 Entities

- **Service** — id, name, type (`gateway | service | worker | frontend | edge/cdn`),
  language/runtime (optional), responsibilities (short text), scaling mode
  (`stateless | stateful`).
- **Database** — id, name, type (`relational | document | keyvalue | search | graph`),
  engine (e.g. `postgres`, `mongodb`, `redis`), role (`primary | replica | cache`).
- **Queue/Stream** — id, name, type (`queue | pubsub | stream`), engine (e.g. `kafka`,
  `rabbitmq`, `sqs`).
- **External Dependency** — id, name, type (`third_party_api | payment | market_data |
  auth_provider | storage`), criticality (`hard | soft`).
- **Infrastructure Node** — id, type (`cdn | load_balancer | api_gateway |
  object_storage | container_runtime`).
- **Connection/Edge** — from_id, to_id, protocol (`http | grpc | queue | sql | cache`),
  sync/async, notes.
- **Constraint** — type (`budget_monthly_usd | expected_users | expected_rps |
  availability_target | consistency_requirement | latency_target_ms`), value.
- **Architecture Decision Record (ADR)** — id, timestamp, decision text, rationale text,
  triggered_by (`user_request | ai_recommendation | simulation_finding`), superseded_by
  (nullable).
- **Version/Snapshot** — id, label (e.g. `"student-$0"`, `"production-1M-users"`),
  timestamp, full state snapshot, parent_version_id (for diffing/lineage).

### 3.2 State Storage

- Represent state as a single JSON document per version (services, databases, queues,
  external deps, infra nodes, edges, constraints, ADRs).
- Persist versions in Postgres (Supabase free tier) — one row per version snapshot, plus
  a `projects` table and an `adrs` table for querying decision history independent of
  snapshots.
- Never mutate a version in place from a user command — mutations create a new version
  with a diff against its parent. This gives you version history "for free" and enables
  the compare/diff feature in §6.7 without extra engineering.

### 3.3 Mutation Commands (LLM output contract)

Define a small, closed set of command types the LLM is allowed to emit. Do not allow
free-form state edits. Example command shapes (describe intent, not exact code):

- `add_node(type, name, attributes)`
- `remove_node(id)`
- `update_node(id, attributes)`
- `add_edge(from_id, to_id, protocol, sync_async)`
- `remove_edge(id)`
- `set_constraint(type, value)`
- `annotate_decision(text, rationale, triggered_by)`

Every command must be validated against a schema before being applied (reject dangling
edges, duplicate names, invalid types, etc.) and validation failures must be surfaced
back to the LLM as structured errors so it can retry — never silently drop an invalid
command.

---

## 4. High-Level Architecture

```
                    ┌──────────────────────┐
                    │   User (Chat + UI)    │
                    │  Chat panel + Canvas  │
                    └──────────┬────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   AI Architect Agent  │
                    │  requirements intake  │
                    │  reasoning / planning │
                    │  emits mutation cmds  │
                    └──────────┬────────────┘
                               │  validated commands
                               ▼
                    ┌──────────────────────┐
                    │  Architecture State   │
                    │  (versioned, graph)   │
                    └──────────┬────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  ┌───────────┐        ┌──────────────┐       ┌──────────────┐
  │ Visualizer │        │  Simulator   │       │   Analyzer   │
  │(React Flow)│        │ (heuristic   │       │ (rule-based +│
  │            │        │  constraint  │       │  LLM-assisted│
  │            │        │  model)      │       │  scoring)    │
  └───────────┘        └──────────────┘       └──────────────┘
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ Versions + Diffs +    │
                    │ ADR history           │
                    └──────────────────────┘

Separate ingestion path (Phase 5):

  GitHub repo / ZIP
        │
        ▼
  File discovery (respect .gitignore, size/type filters)
        │
        ▼
  Static analysis (per-language extractors)
        │
        ▼
  Evidence Graph (facts: "found Redis import in file X",
                  "found docker-compose service Y", ...)
        │
        ▼
  LLM reasoning over evidence (NOT raw file dump)
        │
        ▼
  Architecture State (same schema as above)
```

---

## 5. Recommended Stack (verify current pricing/limits before relying on them)

- **Frontend:** Next.js + React Flow (or a similar node-graph library) for the
  interactive architecture canvas; Tailwind for styling.
- **Backend:** Python + FastAPI.
- **Database:** Supabase Postgres (free tier) for state versions, ADRs, project
  metadata.
- **LLM:** Start with a free-tier API (e.g. Groq or Gemini free tier) for reasoning
  calls; use deterministic non-LLM logic wherever possible (see §6.3 rule) to keep cost
  near $0 and latency low.
- **Static analysis:** Language-native parsers/tools per language (see §6.5) — do not
  hand-roll a full AST parser; use existing open-source tooling per language.
- **Repo ingestion:** GitHub REST API (5,000 req/hr authenticated) with local caching of
  fetched files; support ZIP upload as a fallback for private/local repos.
- **Diagram rendering:** deterministic layout from the Architecture State graph (e.g.
  dagre/elk layout algorithm feeding React Flow) — never let the LLM decide node
  positions.
- **Observability:** structured logs of every mutation command + validation result;
  optional Langfuse tracing for LLM calls specifically (reuse familiarity from prior
  projects).

---

## 6. Feature Scope by Phase

Build in this exact order. Each phase must produce a working, demoable slice. Do not
start a phase until the previous one is demo-ready.

### Phase 1 — Core: Idea → Requirements → Architecture (New Project Only)

**Goal:** A user describes a project idea in a chat box; the system interviews them
conversationally, then produces a first Architecture State and renders it on the
canvas.

- Requirements interview: system asks about expected users, traffic pattern, budget,
  consistency needs, availability needs, real-time requirements, whether this is a
  student/hobby project or production-track — one or two questions at a time, not a
  giant form.
- Once enough constraints are gathered, LLM proposes an initial Architecture State via
  mutation commands (not free text).
- Render the state as a diagram (services, DB, edges) using the deterministic
  layout/render pipeline.
- Store this as version 1 of the project.

**Acceptance criteria:** Given "I want to build a stock trading app for college
students," the system asks 3–6 clarifying questions, then renders a coherent, labeled
architecture diagram with at least: frontend, one backend service, one database, and
correctly directed edges.

### Phase 2 — Live, Conversational Architecture Editing

**Goal:** The user can modify the architecture through natural language and see the
diagram update as a state diff, not a regeneration.

- Support commands like "add Redis between the API and the database," "remove the
  queue," "make the database a managed Postgres with a read replica."
- Every edit produces a new version with a diff against the parent (added/removed/
  changed nodes and edges highlighted on the canvas).
- Maintain an ADR entry for every meaningful architectural change with a short
  rationale (even a templated one, e.g. "Added Redis because user requested caching").

**Acceptance criteria:** Ask for 5 sequential edits in a row; after each, the diagram
updates incrementally (previous nodes keep their layout position where possible) and
the version history shows all 5 versions with correct diffs.

### Phase 3 — Architecture Tiers & Cost/Constraint Reasoning

**Goal:** Given a base architecture, generate alternative tiers under different
constraints, and let the user compare them.

- Support: "show me the $0 / student version," "show me the production version for 1M
  users," "what if my budget is $50/month."
- Each tier is a distinct version, generated by re-running the reasoning step with
  different constraints against the same requirements — not manually authored templates
  (though a small library of reference patterns, e.g. "add CDN + LB + horizontal
  scaling above N users," is fine as grounding for the LLM, not as the entire
  intelligence).
- Compare view: pick two versions, get a rendered diff (added/removed/changed) plus a
  natural-language explanation of *why* the differences exist, grounded in the ADRs and
  constraints, not freely invented.

**Acceptance criteria:** Generate a "$0 student" and a "production, 1M users" tier from
the same base requirements; the compare view correctly lists at least 4 real structural
differences and explains each with reference to a specific constraint (budget, scale,
availability).

### Phase 4 — Analyzer: Architecture Scoring & Q&A

**Goal:** Given any Architecture State, produce a structured quality assessment the
user can question conversationally.

- Rule-based checks first (deterministic, not LLM-guessed): single database with no
  replica flagged under "scalability/reliability," missing cache layer flagged under
  "performance," no rate limiting flagged under "security," no observability nodes
  flagged under "observability," synchronous call chains flagged under "reliability,"
  etc. Define this as an explicit, versioned rule set.
- Present results as a scorecard across categories (scalability, reliability, security,
  cost, observability, performance, maintainability) with a score and the specific
  triggering facts, not just a vague number.
- Allow follow-up questions ("why is scalability only 62?") answered by referencing the
  specific rule(s) that fired plus the relevant state facts — the LLM explains, it does
  not re-derive the score independently (score must stay deterministic/reproducible).

**Acceptance criteria:** Two different architectures with objectively different
reliability characteristics receive different, correctly-ordered reliability scores; the
"why" explanation cites specific real structural facts from the state, not generic
platitudes.

### Phase 5 — Existing Project Ingestion (Repo → Architecture State)

**Goal:** Given a GitHub repo (or ZIP), reconstruct an Architecture State via static
analysis + evidence graph + LLM reasoning over evidence (not raw code dump).

- **Language/infra coverage for MVP (do not exceed this initially):**
  - Languages: Python, JavaScript/TypeScript.
  - Infra: Docker / docker-compose; Kubernetes YAML as a stretch item within this
    phase, not a blocker.
  - Databases detectable via import statements / connection strings / compose service
    names: PostgreSQL, MySQL, MongoDB, Redis.
  - Communication detectable via code patterns: REST route decorators/handlers, GraphQL
    schema files, WebSocket usage, common HTTP client calls (e.g. axios/fetch/requests)
    to internal-looking paths.
- **Pipeline:**
  1. File discovery (respect `.gitignore`, skip binaries/vendored deps/lockfiles,
     size-cap per file).
  2. Static extraction per language: import/dependency lists, route/handler
     definitions, environment variable usage (for DB/service detection), Docker
     Compose service definitions.
  3. Build an **Evidence Graph**: a list of discrete, source-attributed facts (e.g.
     `{fact: "redis_dependency", evidence: "backend/cache.py:3 imports redis"}`), not
     prose summaries.
  4. Feed only the evidence graph (not raw files) to the LLM to propose an Architecture
     State via the same validated mutation commands as Phases 1–2.
  5. Render and version this as the project's "current/reconstructed" architecture.
- Explicitly detect and message when a repo is outside MVP coverage (e.g. a Go
  monorepo) rather than silently producing a wrong architecture.

**Acceptance criteria:** Given a small real Python/FastAPI + Postgres + Redis + Docker
Compose sample project, the reconstructed architecture correctly includes all 4
components and at least the primary API→DB and API→cache edges, with every proposed
node traceable to specific evidence.

### Phase 6 — Reconstructed-vs-Ideal Comparison & Migration Blueprint

**Goal:** Combine Phase 4 (analysis) and Phase 5 (reconstruction) into the flagship
workflow: "take my existing project and show me how to make it production-ready."

- Run the Analyzer (Phase 4) against the reconstructed architecture.
- Generate a target "production" tier (reusing Phase 3's tiering logic) constrained by
  user-provided targets (expected scale, budget, availability).
- Diff reconstructed-vs-target (reusing Phase 3's diff/compare engine).
- Generate a **Migration Blueprint**: ordered list of concrete changes (e.g. "1. Add
  Redis cache between API and DB. 2. Introduce a read replica. 3. Add a queue for
  async order processing."), each linked to the specific analyzer finding or scaling
  requirement that justifies it.

**Acceptance criteria:** For the same sample project from Phase 5, produce a migration
blueprint with at least 4 concrete, correctly-justified steps, matching the gaps
identified by the Phase 4 analyzer.

### Phase 7 — Simulation (Stretch Goal — only after Phases 1–6 are solid)

**Goal:** A constraint-based, heuristic simulation that models how the architecture
behaves under load or partial failure, to identify bottlenecks.

- **Be explicit in all documentation that this is a heuristic capacity/bottleneck model
  based on declared per-component capacity assumptions (e.g. "a single Postgres
  instance is assumed to saturate around N connections/req-s absent a replica"), not a
  physically validated discrete-event simulator.** This framing must appear in the
  README and any demo narration — do not let it be mistaken for real load-testing.
- Inputs: a traffic scenario (e.g. "10x normal load") and/or a failure scenario (e.g.
  "kill Redis").
- Model: propagate load/failure through the graph using simple, declared rules (e.g.
  removing a cache node routes its traffic to the node(s) it was caching for, and
  increases their load estimate by a documented multiplier) and flag nodes that exceed
  their assumed capacity.
- Output: which nodes become bottlenecks/fail, in what order, with a plain-language
  explanation referencing the specific rule that triggered each finding.
- Allow "fix it" flow: user requests a fix, system proposes an architecture change
  (reusing Phase 2's mutation engine), re-runs the simulation, shows improvement.

**Acceptance criteria:** Given an architecture with a single (non-replicated) database
and a stated capacity assumption, a "10x traffic" simulation correctly flags the
database as the first bottleneck, and after the user applies a "add read replica" fix,
re-running the simulation shows the bottleneck resolved or shifted elsewhere as
expected by the declared model.

---

## 7. Deterministic-vs-LLM Rule (apply throughout)

To control cost and improve reliability, classify every user action as one of:

- **Deterministic, no LLM call:** direct commands with unambiguous targets (e.g.
  "remove Redis," "rename service X to Y") — resolve directly to a mutation command.
- **LLM-assisted, structured output only:** ambiguous or reasoning-heavy requests (e.g.
  "add caching where it would help most," "what would you change") — LLM proposes
  mutation commands or analysis text, always validated before being applied.
- **Rule-based, no LLM at all:** the Phase 4 scoring rules and the Phase 7 bottleneck
  propagation rules — must be deterministic and reproducible; the LLM only explains
  results in natural language after the fact, never computes the score itself.

Document this classification for every new feature added; do not default to "call the
LLM" for things that can be resolved deterministically.

---

## 8. Data & Licensing

- No proprietary or user-uploaded-at-scale data is required. All architecture
  "knowledge" (reference patterns like "add CDN above N req/s") can be authored as a
  small internal reference library, not scraped/licensed data.
- If sample repos are needed for testing Phase 5, use your own throwaway sample
  projects or well-known permissively-licensed (MIT/Apache-2.0) small open-source repos
  — verify license before including any repo's code in test fixtures shipped in your
  own repository.

---

## 9. Security & Privacy Considerations

- **Repo ingestion:** never execute code from an ingested repository — static analysis
  only (parse, don't run). Treat all repo content as untrusted input.
- **Prompt injection via repo content:** README files, code comments, or config values
  could contain text designed to manipulate the LLM reasoning step — the evidence graph
  should carry structured facts, not raw injected prose, which naturally limits this
  risk; still, do not let evidence-graph text be treated as instructions.
- **Secrets:** if scanning `.env`/config files for connection strings to detect
  databases, extract only the fact ("uses Postgres") and never store or display raw
  connection strings/credentials found in the repo.
- **Storage:** if repos are private, ensure fetched content is not persisted longer
  than needed for analysis and is scoped per-user.

---

## 10. Evaluation Plan

- **Command validity rate:** % of LLM-emitted mutation commands that pass schema
  validation on first try (track and log failures for prompt iteration).
- **Reconstruction accuracy (Phase 5):** for a small hand-labeled set of sample repos
  (build 5–10 yourself), measure precision/recall of detected components (services,
  DBs, queues) and edges against your own ground truth.
- **Analyzer consistency (Phase 4):** re-running the analyzer on an unchanged
  architecture must produce identical scores (proves determinism).
- **Diff correctness (Phase 3/6):** for a set of known before/after state pairs,
  verify the diff engine reports exactly the changes you made, no more, no less.
- **Simulation sanity (Phase 7, if built):** for a small set of hand-constructed
  architectures with an obvious expected bottleneck, verify the simulator identifies
  it.

---

## 11. Portfolio Presentation Notes

- **Framing to use everywhere (README, resume bullet, interview answer):** "Built an AI
  system architect that reconstructs software architectures from existing codebases via
  static analysis, generates scalable architectures from natural-language requirements
  through a validated command-based state machine (not free-form LLM diagram
  generation), performs constraint-based bottleneck simulation, and produces
  production migration blueprints."
- **Be upfront about the simulator's nature** (heuristic capacity model, not a
  validated queueing simulator) in the README — this preempts the "is this fake"
  question rather than inviting it.
- **Emphasize the one core engineering decision** (LLM emits validated mutation
  commands against a structured state; it never owns the diagram) as the headline
  technical story — this is the single most differentiating design choice versus a
  typical "LLM + Mermaid" project and should be called out explicitly in the README's
  first section.
- Do not present Phases 5–7 as fully general ("works on any repo/any scale") — state
  the explicit MVP coverage boundaries from §6.5 confidently; a scoped, honest claim is
  more credible than an overreaching one.

---

## 12. Definition of Done (for the project as a whole)

Minimum bar to consider this resume-ready (Phases 1–6; Phase 7 is a bonus, not
required):
- Phases 1–4 fully working and demoable in one continuous session (new project →
  interview → architecture → edits → tiers → analysis).
- Phase 5 working on at least the MVP-scoped languages/infra (§6.5) against a real
  sample repository, with evidence-traceable output.
- Phase 6 working end-to-end: real repo in → reconstructed architecture → analysis →
  target production tier → diff → migration blueprint out.
- README documents the core engineering decision, the MVP scope boundaries, and the
  simulator's heuristic nature (if Phase 7 is included).
- A short demo video/script exists showing the Phase 6 flow (Phase 4 §11 of the
  original AI Architect discussion) as the primary "wow" moment.
