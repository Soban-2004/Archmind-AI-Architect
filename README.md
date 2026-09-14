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
- **Phase 7 (stretch)** — traffic/failure simulation: pick a load
  multiplier (1x/10x/50x/100x) and/or kill a component, and a deterministic
  capacity-propagation model (**explicitly a heuristic based on declared
  per-component assumptions, not a real load test or discrete-event
  simulator** — spec §11 requires this be stated plainly, so it's said
  again here) shows which components exceed their assumed capacity, in
  what order, and why. The canvas overlays this live: nodes glow
  green/amber/red/pulsing-red by utilization, killed nodes desaturate, and
  edges animate with their projected req/s. This is a dedicated control
  panel, not a chat request — deliberately routed around the LLM entirely
  (spec §7: an unambiguous "10x traffic" or "kill Redis" request is a
  no-LLM-call case) so it's instant and free.
- **Phase 5 (in progress)** — existing-project ingestion: upload a repo
  ZIP, and a deterministic pipeline (file discovery -> per-language static
  extraction -> Evidence Graph) hands the LLM only discrete, source-
  attributed facts — never raw code — which it reconstructs into an
  Architecture State via the SAME validated mutation commands as every
  other path. Every proposed node's citations are checked against real
  evidence ids in code before being accepted, not trusted at face value —
  see "Existing-project ingestion" below for what's covered so far
  (Python + Docker Compose, live-verified) and what's still ahead (JS/TS
  live-testing, GitHub URL cloning, frontend UI).
- **Phase 6 (built, offline-tested)** — Migration Blueprint: run the
  Analyzer against a reconstructed architecture, diff it against a
  generated target production tier (both via existing Phase 3/4 machinery,
  no new pipeline), and produce an ordered, per-step checklist grounded in
  specific Analyzer findings and/or the target's stated constraints —
  same code-enforced-groundedness pattern as Phase 3's compare view. See
  "Migration Blueprint" below: the deterministic/grounding logic is
  proven (44/44 tests, real diff + real scorecard, only the LLM call
  faked); real end-to-end verification against live model output is
  queued behind the same Groq daily-quota constraint documented above,
  not skipped.

Phases 1–4 and 7 have been run end-to-end against a real Groq key and a
real Supabase database (not just unit-tested against mocks) — see "Live
testing findings" below for the real bugs that surfaced and how they were
fixed.

## Live testing findings

Running the full interview → edit → tier → analyze → simulate flow against
a real model surfaced four real issues neither unit tests nor synthetic
test data caught:

1. **Groq model naming drift.** `llama-3.3-70b-versatile` (the model this
   was originally built against) had been retired from Groq's catalog by
   the time this ran live — model availability on hosted-inference
   providers shifts over time, so treat `GROQ_MODEL` in `.env` as
   something to re-verify against `console.groq.com/docs/models` rather
   than a fixed constant. Currently set to `openai/gpt-oss-120b`, which
   also has the nice property of returning its chain-of-thought in a
   separate `reasoning` field instead of mixing it into the JSON content.
2. **A real Analyzer rule bug, caught by the actual acceptance scenario.**
   Generating a "$0 student" tier and then a "production, 1M users" tier
   from it and comparing scorecards — precisely the flagship demo this
   project is built around — showed the production tier scoring *worse*
   on reliability (25) than the student tier (55). The cause:
   `chained_sync_calls` flagged any node with both an incoming and
   outgoing synchronous edge, which is just what routing infrastructure
   (a load balancer, an API gateway) always looks like — not a real flaw.
   Replaced with `long_sync_chain` (`backend/app/analyzer/rules.py`),
   which only fires on a single, genuinely deep synchronous chain (≥4 hops
   with no async break anywhere in it); bumped `RULES_VERSION` to `v2`.
   Re-run against the same two real tiers: student 89 overall, production
   97 — correctly ordered, and reliability ties at 85 for a legitimate
   reason each time (student: no replica; production: replica added, but
   a real new finding — the read path is still fully synchronous end to
   end despite the added infrastructure). This is exactly the kind of bug
   that only a full live run surfaces, and exactly why Phases 1–4 were
   tested before starting Phase 5.

Separately, a garbled em-dash (`â€”`) showed up in scorecard
messages during manual `curl` testing — traced to the Windows terminal's
handling of piped UTF-8 output, not the actual data (confirmed the Python
string holds the correct `U+2014` codepoint). The real JSON served over
HTTP is unaffected; a browser renders it correctly.

Building and testing Phase 7 (simulation) against the same live project
surfaced two more real issues:

3. **Conversation history isn't scoped to the branch being edited — fixed.**
   Requesting "add a read replica" against the student-tier version (after
   an earlier production-tier request in the same project) produced a
   confused clarifying question — the model saw the flat per-project
   message log, including the unrelated production-tier request, and
   couldn't tell which architecture was actually being discussed. Worked
   around live at the time by making the request self-contained; the real
   fix landed later in the same session: `messages` gained a nullable
   `version_id` column (each message tagged with the version it was built
   on — a question — or produced — an edit/tier, retagged once the outcome
   is known), and `handle_chat_turn` now calls a new
   `get_branch_history()` (a recursive `parent_version_id` walk) instead
   of the old flat `get_messages()`. Verified two ways: a direct
   repository-level test with two sibling tiers forked from the same base
   confirmed each only sees its own branch's conversation, never the
   other's; then a real live chat run confirmed the actual message tagging
   end to end (a question turn stayed tagged with its base version; the
   next turn's user+assistant pair was correctly retagged to the new
   version it produced).
4. **The read-replica sharing rule missed its own target on the first
   try.** The simulator's Rule 4 originally only redistributed load when
   one caller's outgoing edges fanned out to a primary *and* a replica
   together. But the model — reasonably — represented the fix as a
   `primary -> replica` replication edge instead, which that rule never
   looked at. Result: re-running the simulation after adding a replica
   showed the replica sitting at 0 load and the primary completely
   unchanged, i.e. the fix-it flow's core promise (spec's Phase 7
   acceptance criterion) silently didn't work. Fixed by moving the
   write/read split to fire off the primary's own replication edge(s)
   regardless of who calls it (`backend/app/services/simulator.py`).
   Re-verified on the same real before/after versions: primary DB
   utilization dropped from 200% to 130% at 100x traffic after adding one
   replica, with the replica itself landing at 70% — the split's declared
   30/70 write/read math, working exactly as documented.

Wiring the new "ask the architect to fix this simulated overload" flow
(SimulationPanel → chat) into repeated live use surfaced two more real
issues:

5. **Repeated "fix the spike" requests silently duplicated the backend
   service instead of scaling it.** Each time a component was reported
   overloaded, the model added a whole new copy of the service node
   ("Backend (replica)", "Backend (instance 2)", "Backend (instance 3)"),
   each independently wired to every downstream dependency — rather than
   recognizing the service was already `scaling_mode="stateless"` (which
   already means "runs as many instances as load requires") and just
   confirming/using that. After four rounds of this on one real project,
   the result was a service with no consistent request path at all: the
   frontend had a stray direct edge to one specific backend copy that
   bypassed the API gateway entirely, and the load balancer never
   actually fronted any of the 4 backend copies it had "created" —
   meaning nothing in the diagram decided which copy handled a request.
   Fixed with an explicit prompt rule against ever creating a second node
   as a copy of an existing one, and against a caller ever bypassing a
   load_balancer/api_gateway that already fronts its target
   (`backend/app/llm/prompts.py`). Re-verified live on a fresh project
   through two full "simulate at 10x → ask the architect to fix it"
   rounds: the backend service stayed a single node throughout.
6. **Known limitation, found in the same test:** even after fixing #5,
   asking the architect to fix several simultaneously-reported bottlenecks
   in one request only reliably addressed one of them, and once wired a
   fix (a fallback provider) to a node that wasn't actually the overloaded
   caller (attached the fallback edge to the CDN, which was fine, instead
   of to the backend service and worker that were actually driving the
   reported 1800% overload). Not yet fixed — needs either explicit
   per-finding command requirements in the prompt or a structural
   check that a proposed fix's edges actually touch the reported
   bottleneck's real callers.

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

## Phase 7 design notes

- **The whole model is declared in one place.** `backend/app/services/simulator.py`'s
  module docstring lists all six propagation rules together — traffic
  entry, full fan-out per edge, cache discount, primary/replica read
  split, kill-node bypass/failure, and the ok/warning/overloaded
  thresholds. Nothing about how load moves through the graph lives
  anywhere else, so the whole heuristic is auditable in one read.
- **Capacity numbers are a separate, versioned table**
  (`backend/app/analyzer/capacity.py`), not inline guesses — every
  `NodeLoad` in a result carries a `basis` string naming exactly which
  declared assumption produced its capacity figure, so a finding is never
  presented as an unexplained number.
- **No LLM involved anywhere in this phase.** A traffic multiplier and a
  node-kill list are exactly the kind of unambiguous input spec §7 calls
  out as a no-LLM-call case — the whole feature is a dedicated control
  panel + a pure function, deliberately kept off the interview loop.
- **Known limitation:** the fan-out rule (a node forwards its full
  incoming load down every outgoing edge) is deliberately conservative —
  it will over-count load on architectures with genuinely branching logic
  (e.g. a cache-hit path vs. a cache-miss path that only sometimes reaches
  the database), since the schema has no per-edge branch-probability
  field to draw on. Flagged as over-cautious rather than silently
  under-counting, consistent with a tool whose job is to surface risk.

## UI/UX overhaul: chat + canvas

A user-generated architecture (a swipe-based stock app) surfaced two more
real prompt bugs by inspection alone, on top of a full interaction-design
pass over chat and the canvas:

- **Two more real prompt bugs, found by reading a live-generated diagram**
  (not synthetic test data): (1) the model wired `frontend -> CDN` —
  backwards, since a CDN sits in front of the frontend serving its assets
  rather than being called by it; (2) the model added a CDN, load
  balancer, and API gateway for a project with no stated scale beyond
  "modern, simple app" — over-provisioned for an early-stage idea. Both
  fixed directly in the interview prompt (`backend/app/llm/prompts.py`):
  explicit edge-direction rules for infra nodes, and an explicit "don't
  add production infra unless the stated constraints call for it"
  instruction. Re-verified live: a fresh $0/hobby-scoped project now gets
  zero CDN/LB/gateway nodes, with its object-storage node correctly
  pointing *into* the frontend, not the reverse.
- **Quick-reply chips.** `InterviewTurnOutput` gained a `quick_replies`
  field — the model populates 3-5 short tappable options whenever a
  question has a natural small answer set (budget/scale/yes-no), always
  including an escape hatch ("Not sure"/"Other") since the options are
  never claimed to be exhaustive. Tapping one sends it exactly like typing
  it — no new command type, same `ask_question` path.
- **Typewriter reveal, not token streaming.** The interview loop's output
  is one structured JSON object end to end (that's the mutation-command
  contract, not an oversight) — Groq's JSON mode doesn't map cleanly onto
  "stream words as the model writes them" the way freeform chat
  completions do, since a client can't safely render a half-formed JSON
  document. Instead the *already-received* text is revealed progressively
  on the frontend (`components/ui.tsx`'s `TypewriterText`), which gets the
  smooth felt-sense of streaming without a backend rewrite or a
  partial-JSON parser.
- **Force-scroll to the newest message** on every new message regardless
  of where the user had scrolled — standard chat UX, wasn't there before.
- **Resizable chat panel** via a drag handle between it and the canvas,
  clamped 300–640px, plus a **collapsible version-history rail** (chevron
  toggle, slides to a 44px icon strip).
- **Click any node for details** (`NodeDetailCard.tsx`): name, kind, every
  set attribute, and — when a simulation is active — its live utilization
  bar and the exact finding message if it's flagged, without leaving the
  canvas.
- **MiniMap fix:** it was rendering empty because React Flow's MiniMap
  can't introspect an arbitrary custom node component to guess a fill
  color — it needs an explicit `nodeColor` callback, which was missing.
  Fixed by keying the minimap's color off the same node-kind palette used
  on the canvas itself.
- **Traffic particles, not just dashed lines** (`FlowEdge.tsx`): a custom
  edge type animates small circles along the connection path via SVG
  `<animateMotion>` — the technique service-mesh visualizations
  (Kiali/Istio) use for "data flowing through the pipe." Speed and
  particle count scale with simulated load status (overloaded = fast
  triple particles, ok = slow single), so the canvas shows where traffic
  is pooling up, not just which nodes are colored red.

## Judge pass (a second model as defense in depth)

Every prompt fix in the "Live testing findings" log above shares a
weakness: it's a rule the architect model has to remember, and a
differently-phrased request can still slip past it. Rather than keep
patching the architect's own prompt indefinitely, added a genuinely
independent second opinion: after the architect (Groq) proposes commands
and they're applied, a different provider (Gemini,
`backend/app/llm/gemini_provider.py`) reviews the resulting architecture
against a fixed checklist (`JUDGE_SYSTEM_PROMPT` in `llm/prompts.py`) —
backwards edge direction, a caller bypassing a load_balancer/api_gateway
that fronts it, duplicate nodes standing in for `scaling_mode`, orphaned
nodes, unjustified production infra, and whether a "fix this bottleneck"
request actually addressed every bottleneck it named. A `"blocking"`
finding triggers a retry (reusing the existing validation-failure retry
loop, same `MAX_ENGINE_RETRIES` budget); a `"minor"` finding is logged but
doesn't hold up the user's turn. Optional and additive: with no
`GEMINI_API_KEY` configured, `get_judge_provider()` returns `None` and the
architect's output is used as-is — same fallback-on-LLM-failure pattern
already used everywhere else an LLM call isn't the core path.

Verified live, not just unit-tested: ran the judge directly against the
actual polluted "Stock Hinge" project state from the duplicate-backend-
node bug found earlier — it correctly flagged both real issues as
`"blocking"` (the frontend edge bypassing the API gateway, and the three
duplicate backend nodes) by exact node id, plus a `"minor"` finding
(three database replicas, unjustified at the project's real 40-80 RPS)
that hadn't been explicitly called out before. Separately confirmed the
judge correctly downgrades a genuine but softer over-provisioning call (a
cache+replica added for a 30 RPS/$150-budget project) to `"minor"` rather
than forcing a retry over a judgment call.

Known rough edge, not yet fixed: `GroqProvider`/`GeminiProvider` are
process-wide singletons (`@lru_cache`) that stash `last_usage` as an
instance attribute rather than returning it — under real concurrent
requests two calls could race and the session token counter could
attribute one request's usage to another's response. Harmless for the
counter's actual purpose (an approximate running total) but worth fixing
properly (return usage instead of stashing it) before this matters under
real concurrent load.

## Component connectivity registry

The judge pass above catches structural mistakes, but only after paying
for a full architect call plus a judge call, and only as reliably as an
LLM reasoning about a checklist. Extended the layer that was already the
most reliable one instead: `backend/app/analyzer/registry.py` encodes the
same real bugs found live this session as plain Python, checked by
`mutation_engine.py` on every `add_edge` command before it's ever applied
— no LLM call involved. Four rules, each traced to an actual bug found
this session: an `external_dependency` can never be the caller of an edge
(it's always a callee in this model); nothing calls a CDN as a
destination; a `service`/`database`/`queue` can't call INTO a
`load_balancer`/`api_gateway` (backwards — the exact shape of the very
first CDN-direction bug); and no caller may bypass a
`load_balancer`/`api_gateway` that already fronts its target (the exact
shape of the duplicate-backend-node bug).

Deliberately narrow — it rejects specific confirmed-bad *shapes*, not an
exhaustive allowlist of every valid pairing, so it doesn't risk
false-positive-rejecting a legitimate design this project hasn't seen
before. Verified against all 4 rules directly (both the bad shape being
rejected and the corresponding legitimate shape still being allowed, 8
cases total) before ever touching the LLM.

Live testing turned up something worth recording rather than quietly
fixing: on a real run, the architect proposed a backwards
`frontend -> load_balancer` edge, got the registry's rejection fed back
as a retry, and on the *next* attempt proposed `frontend -> api_gateway`
instead — the same category of mistake, just against a different node.
The retry framing (`RETRY_SUFFIX` in `llm/prompts.py`) is worded for JSON-
schema mistakes ("Fix it and return ONLY corrected JSON") and doesn't
clearly tell the model this is a structural rule, not a formatting one —
a plausible reason a retry can end up correcting the wrong thing. Not yet
fixed; worth a structural-error-specific retry framing if this recurs.

Also surfaced, incidentally, while stress-testing this: Groq's own
*request-rate* limit (separate from the token-per-minute limit fixed
earlier) started kicking in under this session's sheer testing volume —
visible as 429s the `groq` SDK itself retries with growing backoff (7s,
18s, 20s, 56s...) before ever reaching our code. Not a bug to fix, just
the honest reason a turn can take over a minute even with every other fix
in place — exactly what the loading-state work earlier in this log exists
to make bearable.

**Rule 5, added later**: the real "Stock Hinge" project still had a
`Load Balancer -> Stock Hinge Frontend` edge alongside its
`CDN -> Frontend` edge — from the very first version ever generated, long
before the load-balancer-vs-static-frontend prompt rule above existed, and
never touched since (none of the later fixes ever asked the model to
reconsider the entry topology). Checking why it could still happen found a
real gap: registry rule 3 only catches a *service* calling INTO a
load_balancer/api_gateway — it never checked the reverse, the routing
layer correctly pointing *out* to something that shouldn't receive it.
Added rule 5: a load_balancer/api_gateway can never target a static
frontend/edge_cdn service directly, full stop, regardless of what else
already fronts it. Verified against all 5 rules together (10 cases: the
original 7 plus 3 new) — no regressions, both new bad shapes rejected.
Also cleaned up the real project's stray edge the same deterministic way
as the earlier duplicate-node cleanup (a scripted RemoveEdgeCommand
through the real apply/finalize path, not a manual DB edit) — its live
topology is now just `CDN -> Frontend` and
`Load Balancer -> API Gateway -> Backend`, no redundant second entry
point.

## Incremental layout: siblings added across separate edits now align

A second real complaint, checked empirically rather than assumed: "3
backend instances behind a load balancer look scattered, not aligned."
Tested dagre's own layout directly (a Node script computing real
coordinates for a synthetic load-balancer-fan-out-to-3-backends graph) —
its default config already centers the load balancer exactly on its 3
children when laid out fresh in one pass (verified: the load balancer
landed precisely on their vertical midpoint). Trying `align: "UL"` to
"fix" it actually made that worse, un-centering the source from its own
children — so the bug was never dagre's config.

The real cause: `computeIncrementalLayout` (used for every edit after the
first) placed each new node from its own local neighbor centroid, one at a
time, with no idea that other "sibling" nodes (added in earlier, separate
edits) existed — reproduced directly: adding 3 backends across 3 separate
incremental calls landed them at *different x-coordinates* (400, 360, 360)
instead of one aligned column, matching the reported symptom exactly.
Fixed by preferring an already-positioned sibling — another node sharing
the same relationship to the same neighbor (both fed by the same load
balancer, both feeding the same database, etc.) — over the generic
centroid: new nodes now align to a sibling's x and stack directly below
it. Verified with the same reproduction: 3 backends added across 3
separate edits now land in one column, evenly spaced.

## Simulator silently ignored range-valued expected_rps

Found while walking the user through why the real Stock Hinge simulation
showed movement at the frontend: every node in a live run showed exactly
`10 rps`, regardless of the project's actual stated `expected_rps` of
`40-80`. Cause: `_base_entry_rps` did a bare `float(c.value)`, which
raises on a range string and falls back to `FALLBACK_ENTRY_RPS = 10.0` —
silently, no error surfaced anywhere, so a simulation could run against
a completely wrong baseline for any project whose constraint (the
overwhelmingly common case — the model almost always writes constraints
as ranges) wasn't a bare number. The exact same bug shape `cost.py`'s
`parse_budget_ceiling` already had a fix for, just never applied here.

Extracted the shared parser into `analyzer/numeric.py`
(`parse_upper_bound`) so both callers — and any future one — go through
one tested implementation instead of each hand-rolling `float(value)`
and hoping. `cost.py`'s `parse_budget_ceiling` is now a one-line wrapper
over it, kept for callers that already import that name.

Verified live through the real API: the same project, same version,
before the fix showed 10 rps everywhere; after, correctly shows 80 rps
(the upper bound) everywhere, which in turn revealed something genuinely
useful that the bug had been hiding — at the project's own stated peak
load, `PostgreSQL DB` and both `Market Data API` nodes sit at 80%
utilization (warning), not comfortably idle. Not a crisis, but real
information the silent fallback had been quietly hiding as "everything's
fine at 10 rps."

## Registry rule 3 was itself over-broad: it blocked the frontend calling the API at all

The user pushed back on the "why is there no movement leaving the
frontend" explanation instead of accepting it, and they were right to:
registry rule 3 ("a load_balancer/api_gateway routes callers TO a
service, the reverse is backwards") was written generally enough to also
block `frontend -> load_balancer` — but that's not backwards, it's the
actual real-world direction: the user's browser, running the frontend's
code, is what calls the API. The rule was correctly stopping a *backend*
from circularly calling its own fronting load balancer; it just never
carved out the one caller that's supposed to call in; the frontend.
Rule 5 (added earlier) already blocks the *reverse* of this edge — a
load_balancer routing traffic TO a frontend — so the two rules were never
redundant, rule 3 just had a real gap on the other direction.

Fixed by exempting `frontend`/`edge_cdn` service types from rule 3's
restriction, and added an explicit positive prompt instruction (the
frontend calling the backend is real traffic and belongs in the diagram,
distinct from the CDN edge which only serves static assets) so the
architect adds this edge going forward instead of relying on it being
merely allowed. `CONNECTIVITY_RULES_VERSION` bumped to v3.

Verified thoroughly, not just the new case: 13 cases covering the full
prior regression (all 10 earlier cases, unchanged) plus the fix itself
(`frontend -> load_balancer` and `frontend -> api_gateway` now allowed)
plus confirming rule 4's bypass check still holds with the new allowance
(`frontend -> api_gateway` directly, when a load_balancer already fronts
that gateway, is still correctly rejected — the frontend can enter at the
top of the chain, not skip into the middle of it). Added the missing edge
to the real Stock Hinge project the same deterministic way as the earlier
fixes, and confirmed live via the simulate endpoint: the new edge now
carries load, and — a real, unplanned improvement this produced — the
Load Balancer is no longer treated as a second independent traffic entry
point once it has a real incoming edge from the frontend, so the whole
system now simulates as one single connected chain from the user in
instead of two disconnected entry points that happened to be summed.

## Simulation dock silently ate the canvas's own zoom controls

User report: "the zoom + - buttons not working." The dock (`SimulationDock`)
sits on `inset-x-0 bottom-4` so its pill can be centered across the full
canvas width via flexbox — but nothing marked the wrapper `pointer-events:
none`, so its invisible left/right edges (everything outside the visible
pill) sat on top of, and silently absorbed clicks meant for, React Flow's
own zoom Controls (default bottom-left) and MiniMap (bottom-right)
underneath. Nothing was visibly wrong — the buttons were exactly where
they'd always been, just no longer clickable.

Fixed with the standard trick for a full-width absolutely-positioned
overlay with centered content: `pointer-events-none` on the (invisible)
full-width wrapper, `pointer-events-auto` on just the actual visible bar.
Same pattern already used elsewhere in this codebase for exactly this
class of bug.

While in there, also fixed a real but previously only-flagged corner
collision: `NodeDetailCard` rendered at `bottom-4 left-4` — the same
corner React Flow's Controls claims, and now also directly behind the
dock's bottom-center bar. Moved to `left-4 top-4`, the one canvas corner
nothing else claims.

Verified with `tsc --noEmit`, `eslint --max-warnings=0`, and a full
`next build` — all clean.

## Cost estimate was a flat per-node-type guess, blind to actual scale

User: "how calculate the cost and i want precise actuall cost
calculation." Fair — the original `cost.py` gave every node of a given
type the same flat monthly figure (one `service` always $25/mo) no matter
what the project's own `expected_rps`/`expected_users` constraints said. A
lonely single backend and a load-balanced fleet of three, at the same
declared cost, was never going to read as "precise."

`cost.py` v2: each node's instance count is now derived the same way the
Simulate tab already reasons about load — `ceil(incoming req/s ÷
capacity.py's declared per-instance capacity for that node)` — and the
monthly figure is `per-instance $ × instances`. The load numbers come
from a real baseline simulation (1×, nothing killed), not a second guess:
`services/analyzer.py`'s `score_architecture` and `rules.py`'s
`rule_over_budget` each run `run_simulation(state, 1.0, [])` and feed its
per-node `incoming_rps` into `estimate_monthly_cost`, so the Scorecard's
displayed cost, the over-budget rule's verdict, and the Simulate tab's own
load bars are all reading off the same numbers — no risk of the UI
showing two different "actual" costs in two different places.

This also means the model now reflects things a flat guess structurally
couldn't: a cache absorbing most of its traffic keeps its own cost flat
*and* reduces what's costed downstream of it (less load reaches origin);
a read replica splits load off the primary the same way it already does
in the simulator. Verified synthetically — a 3-node chain (frontend →
backend → Postgres) at `expected_rps` 50 stays 1 instance / $70 total;
the same chain at 5,000 rps needs 10 backend instances and 25 Postgres
instances (Postgres's declared capacity is lower) at $1,000/mo; at 20,000
rps, $4,000/mo. Checked live against the real Stock Hinge project too:
its stated peak is 40-80 rps, comfortably under every one of its nodes'
single-instance capacity (the lowest is Postgres at 200 rps/instance), so
its total is unchanged at $220/mo against its $300/mo budget — correctly
so; at that real, modest scale nothing here actually needs a second
instance. The new model only diverges from the old flat guess once a
project's stated traffic would genuinely outgrow one instance of a
component — which is exactly when a cost estimate is supposed to move.

Per-instance dollar figures (`_MONTHLY_COST_USD`) are still the same
deliberately rough, single-region, no-discount numbers as before — that
part was never going to be "precise" without knowing a real cloud
provider, region, and SKU, none of which this schema captures. What
changed is that the estimate now scales with what the project actually
says about itself, instead of pretending every node runs alone regardless
of load. `COST_MODEL_VERSION` (new) tracks the instance-counting logic
separately from `COST_VERSION` (the per-instance dollar figures
themselves); `RULES_VERSION` bumped to v4 since `rule_over_budget`'s
output changes for any project whose real load exceeds a node's declared
capacity.

## Chat wasn't synonymous with editing: intent routing before any expensive call

User pushback, and it was the correct diagnosis: the pipeline treated
every non-deterministic message as an architecture-mutation request —
full serialized state, commands schema, Gemini judge pass, a new version
row — even for "why do we need a load balancer?" That's not just wasteful
tokens, it's the WRONG problem to spend the token budget on: the
untrimmable fixed cost (full state JSON) was already established as the
dominant term, and every message paid it regardless of whether anything
was actually being edited.

Investigating confirmed something worse than waste, too:
`InterviewTurnOutput.action` only ever had three values (`ask_question`,
`propose_architecture`, `generate_tier`) — there was no fourth "just
answer" mode. A pure question got force-fit into `propose_architecture`
with an empty-ish `commands` list and the real answer smuggled into
`summary`. And `_finalize` called `repo.create_version` *unconditionally*
— so every one of those pure questions was silently creating a new,
identical version row in the DB and paying for a Gemini judge pass that
reviewed an architecture that never changed.

**New: a deterministic pre-LLM router** (`services/intent_router.py`),
sitting alongside `deterministic.py`'s existing `try_deterministic_command`
as another Tier-1-style, no-LLM-call check — not a second LLM
classification call, which would've added a whole extra round-trip just
to decide whether to make the first one. Conservative by design, matching
that module's own philosophy: it only diverts on confident, unambiguous
phrasing, and explicitly refuses to fire at all if the message contains
any edit-shaped verb ("add", "remove", "change", "increase", ...) no
matter how question-like the rest of it reads. Anything ambiguous returns
`None` and falls straight through to the full, unchanged edit pipeline —
a false positive here (silently dropping a real edit request) is a worse
failure than the waste this exists to fix.

Three lanes now, not one:
- **Advisory** (question / recommendation — "why do we need X",
  "which database should we use") — answered from a *compact,
  topology-only* context (node id/name/kind/type + edges, plus
  constraints) instead of the full architecture state. No commands
  schema, no judge, no `create_version`.
- **Analysis** (what-if — "what happens if traffic increases 10x") —
  routed through the REAL deterministic simulator
  (`services/simulator.py`'s `run_simulation`) first; the LLM only ever
  narrates the actual simulated numbers, the same grounding pattern
  `explain_scorecard`/`ScorecardAnswer` already uses for the Scorecard
  tab. Never a guess at load from scratch. Same non-mutating contract as
  advisory.
- **Edit** (everything else, including anything ambiguous) — the
  existing full pipeline, completely unchanged: full state → Groq →
  schema validation → Gemini judge → finalize/version.

The `_finalize`-always-versions bug is fixed independently of the router,
as its own safety net: even when a message legitimately reaches the full
edit pipeline and the model still responds with zero commands, that no
longer falls through to `_finalize` — it's answered as a non-mutating
turn instead. Belt and suspenders: the router catches the common phrasing
of "this is actually just a question" before any LLM call, and this catches
whatever slips past it after the model itself decides nothing should
change.

New response kind end to end: backend `ChatTurnResult(kind="answer", ...)`
→ API route returns `{"kind": "answer", "answer": ..., "usage": ...}` →
frontend's `ChatResponse` type gains a matching variant, handled in
`page.tsx` by appending to the chat log only — no version, no diff, no
layout recompute, nothing on the canvas moves.

Verified with 30 offline tests (`backend/tests/`, `pytest`) covering the
router's classification heuristics directly and the full routed pipeline
through real `handle_chat_turn` calls (LLM provider and DB repository
faked, nothing else) — a pure question, a recommendation, a what-if
(asserting the real simulator ran at the parsed multiplier), an explicit
edit (asserting a version *is* still created), an ambiguous message
(asserting it falls back to the full pipeline), the existing Tier-1
deterministic command (asserting zero LLM calls), and the empty-commands
safety net in isolation. Then live against the real Stock Hinge project:
"why do we need a load balancer?" and "which database should we use for
read-heavy analytics?" both answered correctly through the real Groq API
(1,235 prompt tokens for the first — versus the ~6,500+ the same
project's full state alone would have cost) with the version count
unchanged (17 before, 17 after both calls) confirmed via the real
`/versions` endpoint, not just by reading the code.

## Chasing "raise the token ceiling": evaluated Gemini and Ollama Cloud as the architect, kept Groq

Two real questions from the user, both worth answering with live evidence
rather than opinion: "is there any LLM with a higher per-minute token
limit" and, once alternatives were on the table, "run a test and give the
actual comparison." Groq's `openai/gpt-oss-120b` free tier is confirmed
(its own docs) at 30 RPM / **8,000 TPM** / 200K TPD — the exact number
this codebase had already calibrated against empirically. Gemini and
Ollama Cloud were tried as real alternatives for the architect role
specifically, since that's the one call that actually hits this ceiling.

Real A/B test methodology: the exact real system prompt, the exact real
Stock Hinge state, and the exact real failing request ("add one more
backend and make sure its under our cost") sent to each candidate, with
every resulting command run through the real `apply_commands` validation
— not just "is it valid JSON."

**Ollama Cloud** genuinely disproved an earlier assumption: its `format`
field (a JSON-schema-constrained output mode) worked cleanly, fast
(1.8-6.5s vs Gemini's 8.8-38.1s), valid JSON every time. But across
repeated real trials, `gpt-oss:120b` on Ollama Cloud invented components
the user never asked for — a fabricated "User Profile Service" wired to
real infrastructure, later a "Stock Recommendation Backend" — schema-valid,
registry-valid, and (before this session's fix) judge-valid, since
nothing in the original 6-item judge checklist checks whether a proposal
actually addresses the request. Smaller (`gpt-oss:20b`) and other
catalog models (`qwen3.5:122b`, `deepseek-v4-pro`, `glm-5.3`,
`mistral-large-3`, `minimax-m3`) were also tried — most aren't accessible
on this account's plan at all (HTTP 402, subscription required, or 404,
wrong/unavailable tag), narrowing the real usable set to the two gpt-oss
variants.

**Gemini** failed differently — safely (asking a clarifying question
instead of guessing) two-thirds of the time rather than acting, and
surfaced something more important than any TPM number: its free tier for
`gemini-3.6-flash` caps at **20 requests PER DAY**, not just per minute —
a hard quota this session's own testing exhausted mid-investigation,
which meant the app's live judge pass (already running on Gemini) went
silently unavailable for the rest of that day. That's a materially
different, much tighter constraint than the TPM figure alone suggested,
and it retroactively invalidated an earlier recommendation in this same
investigation to move the architect to Gemini — 20 requests/day is
unusable for an interactive chat regardless of how large each one can be.

Conclusion: neither alternative beat Groq's real, already-proven
production behavior on the request that started this. The actual fix was
never the model — it was the fixed prompt/schema/state overhead per
request (see the next two sections), which is what was actually eating
the budget on every request regardless of provider.

## Judge check 7: does the proposal actually address what was asked

A direct, real gap found via the Ollama Cloud testing above: the judge's
original 6 checks are all about structural correctness of whatever ends
up in the final diagram — edge direction, bypass, duplicates, unwired
nodes, unjustified infra, addressing named overloads. None of them ask
whether the proposal's actual changes have anything to do with the
request. A fabricated, well-formed, correctly-wired "User Profile
Service" — added in response to "add one more backend" — violated zero
of the original 6 rules and would have sailed through review.

Fixed by adding check 7 (relevance) and, critically, giving the judge
something it never had before: `commands` — this turn's actual proposed
changes, not just the resulting final state. The judge previously only
ever saw the end state, with no way to tell a node that existed before
this turn from one just added, so it structurally could not have asked
"does what changed match the request" even if instructed to — the prompt
change and the new input are both necessary, not just the checklist item.
`build_judge_prompt` and `_run_judge` both took a `commands` parameter.

Verified directly: fed the judge the exact hallucinated "User Profile
Service" commands captured from the Ollama Cloud testing above —
`approved: False`, `blocking: "The proposal added an unrelated 'User
Profile Service' backend node rather than properly handling the request
to add backend capacity or scale the backend."` Then verified the limits
of the fix, honestly, via 8 more real end-to-end runs with Ollama Cloud
as architect: the check catches what it's supposed to when the judge
actually runs, but the judge itself failed on 2 of those 8 runs (once a
transient 503, once the Gemini daily-quota exhaustion above) — when the
judge can't run at all, `_run_judge` returns `None` and the proposal is
accepted unreviewed, same as before this fix. A judge check is only as
reliable as the judge's own provider being available, which this session
just demonstrated isn't guaranteed on a free tier under real load.

## Free-text truncation: summarize only what can safely be summarized

A user proposal worth taking seriously on its own terms: "a compactizer
LLM that summarizes if the token size goes beyond some limit... only the
ones which can be summarized." Right instinct, and worth being precise
about which parts of the payload that actually describes. Checked the
schema directly: `Service.responsibilities` and `Edge.notes` are the
ONLY free-text prose fields anywhere in `ArchitectureState` — everything
else (ids, types, roles, engine names) is either a short atomic value or
something a mutation command references directly by id, where losing
precision would silently break correctness (a paraphrased id doesn't
resolve to a real node), not just verbosity.

Implemented as a deliberately plain deterministic character cap
(`state_for_edit_prompt`, llm/prompts.py — `MAX_FREE_TEXT_CHARS = 100`),
not an actual summarizer LLM call. Reasoning: on the only two fields
that are genuinely safe to compact, a hard truncation captures
essentially all the value a real summarizer would, for zero added
latency, zero added cost, and — the more important reason, given
everything else this session found testing Ollama Cloud and Gemini as
alternatives — zero added risk of the summarizer itself dropping
something that mattered. Adding another LLM call to solve a token-budget
problem would mean adding another real point of imprecision to a
pipeline that's already spent an entire session finding out how real
that risk is.

Doesn't move the needle on the real Stock Hinge project (the longest
`responsibilities` field there is 56 characters, well under the 100-char
cap) — this is deliberately front-loaded ahead of when it'll matter, for
whenever a project's free-text fields grow verbose over many future
edits. Measured on a synthetic 50-node/50-edge project with realistically
verbose text in both fields: the state alone drops from ~7,900 tokens
untruncated to ~6,000 truncated. Also applied to the Scorecard Q&A
prompt's state serialization for the same reasoning.

## Existing-project ingestion (Phase 5) — first vertical slice

Started, and deliberately scoped to one thing proven end to end before
broadening: Python + Docker Compose, a ZIP upload, live-verified against
a real sample project rather than just unit-tested against mocks.

**Pipeline** (`backend/app/services/ingestion*.py`), matching the spec's
own 4 steps:
1. **Discovery** (`ingestion_discovery.py`) — walks the upload, applying
   real `.gitignore` semantics (`pathspec`, not a hand-rolled
   approximation — glob negation and anchoring are genuinely easy to get
   subtly wrong by hand), skips vendored directories and lockfiles
   outright, caps individual file size at 200KB.
2. **Extraction** (`ingestion_extract.py`) — Python via the stdlib `ast`
   module (a real parser, so it can't be fooled by a comment or a string
   that happens to look like an import, and gives exact line numbers for
   free); JS/TS via regex over source text, matching the spec's own
   framing ("communication detectable via code patterns" — patterns, not
   a full parser, which would be real dependency weight this MVP doesn't
   need yet); Docker Compose as real YAML. Every fact keeps its literal
   source location (`backend/cache.py:4`, not just a filename).
3. **Evidence Graph** (`models/evidence.py`) — a flat list of `{id, fact,
   detail, source}`, the same "small, concrete, citable facts, never
   prose" shape as everything else the LLM is ever handed in this
   codebase (a Finding, a diff entry, a simulation result).
4. **Reconstruction** — a new prompt (`INGESTION_SYSTEM_PROMPT`,
   `llm/prompts.py`) that never sees raw code, only the Evidence Graph,
   and builds via the exact same `add_node`/`add_edge` commands and
   `apply_commands` validation as every other architecture-producing
   path. The attribute-shape rules (`ATTRIBUTE_SHAPE_RULES`) were
   factored out of the main interview prompt so both share one source of
   truth instead of two copies that could quietly drift apart.

**The grounding guarantee is enforced in code, not just requested in the
prompt.** The model returns `citations: {ref: [evidence_id, ...]}`
alongside its commands — `services/ingestion.py`'s `_filter_uncited_nodes`
checks every `add_node`'s citation against the Evidence Graph's *real* ids
before anything reaches `apply_commands`, and silently drops (and
reports) any node the model couldn't actually point at real evidence for.
An LLM confidently proposing a plausible-but-ungrounded component — the
exact failure mode this session already measured happening for real with
a different provider (see "Evaluated Gemini and Ollama Cloud" above) —
gets caught here structurally, not hoped away.

**Live-verified**, not just unit-tested: built a real sample project
(FastAPI + Postgres + Redis + Docker Compose — the spec's own acceptance-
criteria example) and ran the full pipeline against it for real.
Deterministic discovery+extraction alone correctly found all 15 real
facts (redis/postgres imports with exact line numbers, 3 REST routes, 2
env vars, all 3 docker-compose services, the depends_on edges) with zero
LLM cost. The real Groq call then reconstructed exactly 3 nodes (Backend
API, PostgreSQL, Redis) with both critical edges (API→DB, API→cache)
correctly directed, every node cited by multiple real evidence ids, and
zero dropped/hallucinated nodes — a clean pass against the spec's own
Phase 5 acceptance criteria on the first real try. The HTTP upload
endpoint (`POST /ingest`, multipart ZIP + project name) was verified
too — both its success path structurally (it's a thin wrapper over the
same proven functions) and its failure path for real: a request hit the
same Groq daily-quota wall this session had already found, and it failed
cleanly with a real error and, confirmed by checking `/projects`
afterward, zero orphaned project data.

Offline regression tests (`backend/tests/test_ingestion.py`) cover the
fully deterministic half — discovery's vendored/lockfile/.gitignore
skipping, extraction's real fact-plus-source-location output for a
realistic multi-file sample, a syntax-error file reported instead of
crashing the whole pipeline, an empty repo producing nothing. The LLM
reconstruction step itself isn't unit-tested, by the same reasoning
already applied to every other LLM-facing path in this codebase — it
needs a real model call to test meaningfully, so it's covered by the live
run above instead.

**Not yet built, deliberately deferred rather than half-done:**
- JS/TS extraction exists (regex-based, mirrors the Python extractor's
  shape) but hasn't been live-verified against a real reconstruction the
  way the Python path has.
- GitHub URL cloning — today's entry point is a ZIP upload only; a repo
  URL would mean adding a `git clone` step ahead of the same discovery
  pipeline, not a new pipeline.
- No frontend UI yet — `POST /ingest` is real and working, but there's no
  upload screen wired to it.
- Kubernetes YAML (spec's own stretch item within Phase 5, not a blocker).

## Phase 6 — Migration Blueprint, built and offline-tested, live verification pending

Combines Phase 4 (Analyzer) with Phase 5's output into the flagship
workflow: "take my existing project and show me how to make it
production-ready." Deliberately reuses rather than reimplements — the
only genuinely new piece is turning "here's what changed, here's why the
as-is system scored what it scored, here's what the target needs" into
an ordered, grounded checklist:

1. **The target production tier isn't a new code path at all** — it's
   the existing Phase 3 `action="generate_tier"` chat flow, called
   against the reconstructed project like any other tier request (e.g.
   "generate a production tier for 500,000 users, a $2000/month budget,
   and 99.9% availability").
2. **The diff is the existing Phase 2/3 diff engine** (`diff_states`),
   unchanged — reconstructed-vs-target, same deterministic ground truth
   `/compare` already uses for any two versions.
3. **The Analyzer score is the existing Phase 4 rule engine**
   (`score_architecture`), run against the reconstructed (as-is) state —
   real findings, not anything new computed for this.
4. **The new part**: `services/migration.py` + a new prompt
   (`MIGRATION_BLUEPRINT_SYSTEM_PROMPT`, `llm/prompts.py`) that takes
   those three already-computed, already-correct things and produces an
   ordered `MigrationBlueprint` — one step per (or per small group of)
   diff entries, each with a short imperative `action` and a
   `justification` grounded in a specific Finding's `rule_id` and/or the
   target's actual stated constraints.

**Groundedness enforced in code, the established pattern**
(`CompareExplanation`, `ScorecardAnswer`, the judge's check 7): every
step's `ref` must match a real entry in the deterministic diff, and every
`cited_rule_ids` entry must match a Finding the Analyzer actually
produced — anything that doesn't is dropped before it reaches a user, an
invented ref costs the model a wasted step, not a chance to slip
something ungrounded through. `VersionDiff.valid_refs()` was factored out
of `compare.py`'s private helper into a shared method so both consumers
enforce this exactly the same way instead of two copies that could drift.

**Tested offline** (`tests/test_migration.py`, 5 new, 44/44 total) the
same way `test_ingestion.py` tests Phase 5's grounding filter: real diff,
real Analyzer scorecard, only the LLM call faked — an invented `ref` is
dropped and the remaining steps renumbered to a clean sequence; an
invented `cited_rule_ids` entry is stripped from an otherwise-valid step,
not treated as disqualifying; an empty diff short-circuits without an LLM
call at all; a real LLM failure falls back to the still-useful
deterministic diff+scorecard rather than losing them.

**Live end-to-end verification is queued, not skipped.** Attempted
against the real Phase 5 sample project (ingest → generate a real target
tier → call the new endpoint) and hit the same Groq daily-quota wall this
session had already found and documented — the ingestion step itself
succeeded live (persisted a real project, 3 correctly-cited nodes,
confirmed via `/projects`), but the tier-generation call needs more
headroom than was left in the rolling daily window at the time. The code
path is real, wired into `main.py`, and exercised end-to-end offline; the
one thing not yet captured is the real model's actual blueprint text
against real data, which needs the quota to clear (or the paid tier this
README has already made the case for) to finish honestly rather than
faked.

## Product-completeness pass: landing, import UI, export/share, real streaming progress

Direct feedback, quoted faithfully rather than summarized away: "Your
plan is strong on the engine, thin on what makes something feel like a
product rather than a working demo," followed by six concrete gaps. Two
turned out to already be built (`ProjectSwitcher.tsx`, a real project
list/rename/delete dropdown; `VersionHistory.tsx`, a real visual timeline
with click-to-view and a compare mode) — checking the actual code before
agreeing or rebuilding is the same discipline this whole README has tried
to model throughout. Checking also surfaced a real, if small, bug: ingested
versions were tagged `kind="initial"` instead of `kind="reconstruction"`,
even though `schema.sql` already documented that kind and `VersionHistory`
already had a dedicated visual treatment for it (orange dot, History icon)
that had never once fired. One-line fix in `services/ingestion.py`.

The four genuine gaps, all built this pass:

**Landing + two real entry paths** (`Landing.tsx`, new). A first-time
visitor (no project remembered in localStorage) now sees an actual
explainer and two deliberate choices — "Start a new project" or "Import
an existing repo" — instead of the old behavior of silently auto-creating
a blank "New Project" nobody asked for. `page.tsx` gained a `view: "landing"
| "import" | "app"` state machine; a returning visitor skips straight to
`"app"` as before. `ProjectSwitcher`'s "+ New" (and the post-delete-active-
project fallback) now route back through this same landing choice instead
of instant-creating, so there's one entry flow, not two that could drift.

**Import UI with three deliberately distinct result states**
(`ImportRepoScreen.tsx`, new — the frontend Phase 5's backend had been
missing entirely). Drag-and-drop or browse for a `.zip`, name the project,
submit — then one of three real, different treatments, not one generic
error box, because the three shapes `services/ingestion.py` can actually
produce call for different next actions: clean-or-caveated **success**
(node/edge counts, the real evidence count, and — only when
`dropped_uncited_refs` or `unsupported_notes` are non-empty — an explicit
"a few things worth knowing" panel naming exactly what was excluded and
why); **out of scope** (no evidence at all — explained as a scope gap,
with a "try a different repo" action, not a "try again" that would just
fail identically); **technical failure** (a real LLM/network error shown
verbatim, with "try again" since this class of failure is transient).

**Export and share** (`ExportMenu.tsx`, `exportDiagram.ts`, both new).
PNG and PDF export via `html-to-image` + `jspdf`, capturing the diagram at
a fixed generous resolution regardless of current on-screen zoom/pan —
using `useReactFlow().getNodes()` for real, post-render *measured* node
dimensions rather than the layout-only position data `ArchitectureCanvas`
already had in scope, which is why `ArchitectureCanvas`'s return is now
wrapped in `ReactFlowProvider` (a sibling overlay outside `<ReactFlow>`'s
own JSX can't otherwise reach that hook). "Copy read-only link" builds a
URL to a genuinely new route, `/shared/[projectId]/[versionId]`
(`page.tsx`, new) — no access-control layer to build here, since this app
has none at all today and every id is already reachable through the plain
API; sharing a link is just handing out a real URL to a real route that
renders without any editing controls (no chat, no history, no node
editing, no simulation dock), not a new security boundary.

**Real per-stage pipeline progress**, replacing a guess with the real
thing. `useThinkingStatus.ts`'s rotating status was already honestly
documented as cosmetic — "rather than fabricating specific steps we can't
actually confirm are happening" — precisely because a single blocking
HTTP call has no real progress to report. So the fix wasn't a frontend
trick, it was giving the backend an actual progress channel:
`services/interview.py`'s `handle_chat_turn` (and every function it calls
into — `_handle_advisory`, `_handle_analysis`, `_run_judge`, `_finalize`)
now takes an optional `on_stage: Callable[[str], Awaitable[None]] | None`,
defaulting to `None` everywhere so every existing caller (the plain JSON
route, `direct_update_node`, all 44 tests) is completely unaffected. A new
`POST /projects/{id}/chat/stream` endpoint (`api/routes/chat.py`) runs the
exact same `handle_chat_turn` with a real callback wired to an
`asyncio.Queue`, streamed out as Server-Sent Events — a `{"type": "stage"}`
frame fires exactly when each real step starts (the Tier 1 check, routing,
the actual Groq call, validation, the judge pass, finalizing — including
an honest "the first attempt needs a fix — retrying" on a real retry, not
a silent one), ending in one `{"type": "result"}` frame carrying the exact
payload the plain endpoint already returns. `ChatPanel.tsx`'s
`ThinkingBubble` now shows this real text when available, falling back to
the old cosmetic rotation only when it isn't — never claiming something's
real when it isn't, in either direction.

Live-verified against the real Stock Hinge project, both paths: a real
advisory question streamed exactly `"Checking for a direct match…"` →
`"Answering from the current architecture…"` → a real grounded answer:
`redis_dependency`/etc. evidence reasoning about the actual cache, in
1,346 real prompt tokens. A real edit attempt streamed
`"Checking for a direct match…"` → `"Consulting the architect…"` → hit
the same Groq daily-quota wall this README has already documented
extensively — and, importantly, the failure surfaced as a normal, readable
`{"type": "result", "payload": {"kind": "error", ...}}` frame through the
stream, not a dropped connection, proving the existing friendly-error
handling survives the new streaming path unchanged.

All four verified together: `tsc --noEmit`, `eslint --max-warnings=0`, and
a full `next build` all clean; the backend's full 44-test suite still
passes untouched. No visual/interactive browser confirmation was possible
in this environment (no browser automation tool available) — verification
here is real compiled/typechecked code plus live SSE/API responses
inspected directly, not a screenshot; worth a manual look before treating
the visual layer as fully confirmed.

## Landing page: the diagrams are the real canvas, not an illustration of it

Two live user reports fixed first: ~25% of the landing page was empty on
the right on a real browser (`Landing.tsx` and `ImportRepoScreen.tsx`'s
root `<div>`s had `h-full` but no `w-full` — inside `page.tsx`'s row-flex
wrapper, a flex item with no explicit width shrinks to its own content, so
everything capped at `max-w-5xl`/`max-w-xl` and centered with `mx-auto`
had nothing wider to center within), and the `ProjectSwitcher` + "+ New"
control was showing on the landing/import views where it made no sense —
now the header renders a plain "AI Architect" label until `view === "app"`.

Then the bigger ask: the hero diagram should look *exactly* like the
product's own canvas, not a bespoke illustration of it — and further down
the page, show real scenarios (overloaded, load-balancer fan-out, and
more) with diagrams and explanations, not just the resting state.

The literal way to guarantee "exactly how it looks in our systems" is to
render it with the same components the real canvas uses, not to redraw
them. `MiniArchitecturePreview.tsx` is a small non-interactive
`<ReactFlow>` instance using the exact same `nodeTypes`/`edgeTypes`
(`ArchNodeCard`, `FlowEdge`, `TrafficSourceNode`) and the exact same
`toFlowElements` + `applySimulation` pipeline `ArchitectureCanvas.tsx`
runs on a real project — panning/zooming/dragging/selecting all disabled,
`fitView` locked, otherwise identical. `lib/landingScenarios.ts` hand-
authors four fixed fixtures in the real `ArchitectureState`/
`SimulationResult` shapes (there's no live project to simulate before a
visitor has created one): a steady-state hero, a 10x traffic burst that
overloads a single-instance Orders API, a load-balancer fan-out across
three replicas, and a hard external dependency killed mid-run — each one
a real scenario the product's own simulator (Phase 7) actually models,
not an invented one. `HeroDiagram.tsx` (the earlier bespoke IBM-Plex
schematic mock) is deleted; the drafting-sheet frame around each diagram
(fig label, dashed rule, corner ticks) survives as a small `Figure`
helper in `Landing.tsx` so the real canvas renders sit inside the same
"numbered figure" visual language the rest of the page already uses.

Verified via `tsc --noEmit`, `eslint --max-warnings=0`, and a full
`next build` — all clean. As with the rest of this landing-page work, no
browser automation is available in this environment, so the actual pixel
layout (particle motion, fitView framing at various widths) is unverified
beyond compiled/typechecked code; worth a look on localhost.

## Instance sizing and storage — a real gap, closed

Asked directly: does the cost/capacity model account for compute size (2
vCPU vs. 8 vCPU) or storage volume the way real infra decisions do? It
didn't — checked `state.py`, `capacity.py`, and `cost.py` to confirm
rather than guess: every node of a given kind was assumed to be one
identical "small instance", forever. The only thing that ever varied was
instance *count* (cost.py v2's own load-aware provisioning); there was no
way to represent a node as deliberately bigger or smaller, and nowhere in
the schema to even declare it.

Closed via a new declared dataset, `analyzer/sizing.py`, in the same
spirit as capacity.py/cost.py themselves: a node's `size` (small/medium/
large/xlarge, defaulting to small — every node from before this existed
behaves identically, since small's multiplier is 1.0) scales both
`capacity_for()` and `monthly_cost_for()` by that tier's declared
capacity/cost multiplier. Cost scales sub-linearly with capacity (a
"large" instance costs less per unit of capacity than 4 separate "small"
ones would) — a genuine, real tradeoff between sizing up and scaling out,
not a wash. Deliberately t-shirt sizes, not named vendor instance types
("t3.medium") — real cloud pricing depends on region/vendor/commitment
level this tool has no way to know (cost.py's own docstring already says
so), and naming a specific SKU would quietly imply an accuracy this
doesn't have while tying a vendor-agnostic tool to one vendor's naming.

`storage_gb` (Database only) is a genuinely separate axis, not folded
into the size multiplier — storage cost is about data volume, not
request-throughput capacity, so it gets its own independent per-GB cost
line, added only when actually declared.

The LLM's `ATTRIBUTE_SHAPE_RULES` (the one shared prompt fragment every
node-creating flow already uses) now documents both fields, so it can
declare them deliberately — e.g. an actual production tier can now mean
"bigger instances", not just "more replicas". `NodeDetailCard`'s existing
generic field-rendering and editable-field-dropdown mechanism (built once,
already reused for `scaling_mode`/`role`) picks both up with a few lines,
no new UI — though `storage_gb` exposed a real pre-existing gap: it's the
first *numeric* editable field this card has ever had, and the save path
only ever sent raw strings (every prior editable field was a string/enum,
so this never mattered before). Fixed properly rather than routing around
it: editable-field descriptors gained a `numeric` flag, the save path
converts to a real number (or null) before sending, and the input renders
as `type="number"`.

Also fixed in the same pass: `AnalyzerPanel`'s cost breakdown was already
receiving a real per-line `basis` string from the backend (capacity.py/
cost.py have always returned one) and never actually rendering it — only
a generic "see README" disclaimer. Now shows the real basis per line,
which is exactly where the new size/storage numbers actually explain
themselves.

New `backend/tests/test_sizing.py` covers: default-small nodes produce
byte-identical numbers to before this existed (explicit regression
check), size scaling capacity/cost by the declared multiplier, sub-linear
cost vs. capacity, storage_gb as an independent line (present and absent),
infra_node/external_dependency nodes (no `size` field at all) unaffected,
and size + real load scaling composing correctly together. Full backend
suite (51 tests) and `tsc`/`eslint`/`next build` all clean.

## Per-visitor project isolation, without a login screen

Asked directly, ahead of deploying this publicly: "Person A's project
must be visible only by Person A, not Person B — is that true today?" It
wasn't. Every project was visible to every visitor by default (the
guest-mode design was real, but "no login" had quietly also meant "no
privacy between visitors", which turned out to be a different question
once asked out loud). The rate limiter's per-IP counters don't help here
either — they're in-memory, request-throttling only, never written to
the database, with zero connection to which project belongs to whom.

The constraint that shaped the fix: still no login screen, no signup,
nothing to type — the whole point of guest mode. The answer is a `projects.
owner_token` column: an opaque, random id the frontend generates once per
browser (`crypto.randomUUID()`, `localStorage`, a new
`lib/guestToken.ts`) and sends as `X-Guest-Token` on every request. No
identity to create, no password to remember — but Person A's browser and
Person B's browser get different tokens, so they genuinely see different,
separate project lists, not just a UI-level filter over the same shared
data.

The real, honest limitation, stated plainly rather than glossed over: a
token isn't an account. It lives in one browser's `localStorage` — clear
site data, switch browsers, or use a different device, and that identity
(and every project tied to it) is gone for good, with nothing to log back
into. That's the deliberate tradeoff for skipping a signup screen
entirely, not an oversight.

**Enforced at the data layer, not just the list endpoint.** The tempting
shortcut would have been "just filter `list_projects()` by token" and
call it done — but that only hides a project from *browsing*, it doesn't
actually stop someone who already has (or guesses) a project's id from
opening, editing, or deleting it directly. Real isolation meant pushing
the check into every read/write repository.py function that touches a
project or version (`get_project`, `list_projects`, `rename_project`,
`delete_project`, `get_latest_version`, `get_version`, `list_versions`),
each filtering `owner_token IS NULL OR owner_token = $token` — the `IS
NULL` half is the deliberate grandfather clause: every project created
before this column existed (this repo's own real "Stock Hinge" project
among them) stays reachable by anyone who already has its id, exactly
its behavior before this feature, never retroactively locked away from
whoever was actually using it. A mismatched token and a genuinely
nonexistent id both resolve to the identical 404 — a stranger can never
use the response to tell "doesn't exist" apart from "exists but isn't
yours".

Threading that through meant updating every service-layer entry point
that resolves a project without going through a route-level check first
— `handle_chat_turn`, `direct_update_node`, `direct_apply_commands`
(services/interview.py), `compare_versions`, `generate_migration_
blueprint` — plus a project-ownership check at the very top of the three
interview.py functions specifically, independent of whichever
base_version_id branch runs below it: the trickiest case found while
building this was `direct_apply_commands`'s `base_version_id=None` path
("start a brand-new project from empty_state()") — without an explicit
check there, that branch would have let anyone attach a new version to
*any* existing project_id they could guess, owned or not, since
`get_latest_version` returning `None` for "not yours" was
indistinguishable from `None` meaning "no versions yet".

4 new tests (`test_project_isolation.py`) confirm all three of those
entry points reject a request the moment ownership fails, via a
FakeRepo whose `get_project` simulates "real project, wrong owner" and
asserts nothing else gets called afterward. The actual SQL-level
filtering needs a real database to test meaningfully (same reasoning as
every other DB-touching function in this codebase) — verified live
instead: two disposable guest tokens standing in for two real visitors,
confirming Person A's project appears in Person A's list and nowhere in
Person B's, a direct-by-id request from Person B (and from no token at
all) 404s, the real owner's own reads/writes/deletes still work exactly
as before, a cross-owner write attempt is rejected with a clean error
(not a crash), and the real, pre-existing "Stock Hinge" project stays
reachable regardless of which token — or no token — asks for it. Full
backend suite: 181 passed (was 177). `tsc`/`eslint`/`next build` all
clean. Disposable test projects cleaned up after verification.
