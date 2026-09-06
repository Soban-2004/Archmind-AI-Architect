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

3. **Conversation history isn't scoped to the branch being edited.**
   Requesting "add a read replica" against the student-tier version (after
   an earlier production-tier request in the same project) produced a
   confused clarifying question — the model saw the flat per-project
   message log, including the unrelated production-tier request, and
   couldn't tell which architecture was actually being discussed. Worked
   around live by making the request self-contained ("modify the CURRENT
   architecture I'm viewing right now"); the real fix — scoping
   conversation history to the active branch, or having the system prompt
   explicitly disambiguate which version is in play — is a documented gap,
   not yet implemented. Worth fixing before Phase 3 branching sees heavy
   use.
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

## What's next (not yet built)

Phase 5 — existing-project ingestion (repo/ZIP → static analysis →
evidence graph → LLM reasoning over evidence → Architecture State via the
same validated mutation commands used everywhere else).
