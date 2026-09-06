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

## What's next (not yet built)

Phase 5 — existing-project ingestion (repo/ZIP → static analysis →
evidence graph → LLM reasoning over evidence → Architecture State via the
same validated mutation commands used everywhere else).
