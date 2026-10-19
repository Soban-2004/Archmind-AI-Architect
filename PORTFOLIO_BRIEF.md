# AI Architect — Portfolio Brief

Content prepared for adding this project to a portfolio site. Not a README —
written for someone skimming a projects list, not someone trying to run the
code. Hand this whole file to Claude Code (or whoever's updating the
portfolio) as the source material; trim/adapt to whatever the site's project
schema actually needs (fields, length limits, etc.).

---

## Title options

- **AI Architect**
- **AI Architect — AI-Native System Design**

## One-liner (for a card/list view)

Describe a system in plain language and get back a real, validated system
architecture — the AI never draws the diagram directly, it only emits
structured commands checked against real structural rules before anything
reaches the canvas.

## Short description (2–3 sentences, for a project card)

An AI-native system-design tool: describe what you're building and a
requirements interview produces a real architecture diagram — services,
databases, queues, infrastructure — versioned, cost-estimated, and
load-tested. The core idea: the LLM never touches the diagram directly, it
only emits a small set of validated mutation commands, so a chat edit, a
manual drag-and-drop, and an imported GitHub repo all go through the exact
same structural checks (connectivity rules, schema validation, no duplicate
nodes).

## The technical hook (lead with this — it's the actual differentiator)

Most "AI diagram" tools have the model directly generate a picture or a
blob of JSON that gets rendered as-is — so the AI can propose something
structurally broken (two data flows into the same entry point, a load
balancer in front of something with one instance, a dangling edge) and the
tool just draws it anyway. This doesn't: the LLM only ever emits one of a
handful of typed mutation commands (add a node, connect two nodes, change
a field), and every single one is validated against real rules — a
connectivity registry, schema checks, duplicate-node detection — before
it's allowed to touch the architecture state. The diagram is always
rendered deterministically *from* that validated state, never *by* the
model. And that pipeline is the ONLY path in: a chat message, a manual
edit on the canvas, and a reconstructed diagram from an imported real
GitHub repo all produce the exact same validated commands — there's no
separate, less-trusted path for any of them.

## Key features (pick 4–6 for a portfolio card; all real and shipped)

- **Requirements interview → real architecture.** A short back-and-forth
  (scale, budget, availability, consistency needs) produces a grounded
  first design — never a single LLM call guessing at a diagram.
- **A real cost & capacity model**, not a flat guess — ~30 component types
  across services, databases, queues, and infrastructure, each with
  versioned capacity/cost assumptions that scale with compute size,
  storage, and the actual database/queue engine named (CockroachDB and
  Postgres are priced differently; so are DynamoDB and Redis).
- **Load & failure simulation** — pick a traffic multiplier or kill a
  component and watch a deterministic capacity-propagation model show what
  breaks, in what order, and why, animated live on the canvas.
- **A deterministic Analyzer** scoring any design across 7 categories
  (scalability, reliability, security, cost, observability, performance,
  maintainability), citing the exact facts behind every finding — with a
  one-click "Fix it" that hands a specific finding straight back to the
  architect agent to resolve.
- **Import a real, existing repo** (zip upload or a GitHub URL) — a
  deterministic discovery pipeline extracts real, source-attributed facts
  (routes, ORM models, SQL migrations, auth usage, real third-party API
  calls) across Python and JS/TS codebases, hands only those facts to the
  LLM, and checks every proposed component against real citations before
  accepting it. Click a node to see the exact file and line that justified
  it.
- **Export a real starter kit** — architecture docs, a build plan ordered
  by dependency, and a runnable `docker-compose.yml` for every component
  with an honest local equivalent — a validated design becomes an actual
  starting point, not just a picture of one.
- **Guest mode with real per-visitor privacy** — no login, but projects are
  genuinely only visible to the browser that created them, via a private
  per-visitor identity, not just client-side hiding.

## Tech stack

**Backend:** FastAPI, Pydantic v2, PostgreSQL (Supabase) via asyncpg, Groq
(primary LLM) + Gemini (structural review pass)
**Frontend:** Next.js, React, TypeScript, React Flow (canvas), Tailwind
**Deployment:** Render (backend), Vercel (frontend), Supabase (database) —
real, live infrastructure, not a local-only demo
**Testing:** 190+ backend tests (pytest) covering the mutation engine,
capacity/cost model, ingestion pipeline, and per-visitor isolation

## Links

- Live app: https://archmind-ai-architect.vercel.app
- Repo: https://github.com/Soban-2004/Archmind-AI-Architect

## Suggested tags / categories

`AI` `LLM` `System Design` `Full-Stack` `FastAPI` `Next.js` `TypeScript`
`Developer Tools`

## Notes for whoever writes the final copy

- Lead with the "LLM never draws the diagram directly" idea — it's the one
  sentence that actually explains why this is a harder/more interesting
  problem than "AI generates a diagram," and it's true, not marketing.
- Don't lead with the feature list — lead with the technical hook above,
  then support it with 2–4 of the features.
- If the portfolio format wants a single hero screenshot/gif: the canvas
  view mid-simulation (particles animating along edges, a component
  flagged overloaded in red) is the most visually distinctive screen —
  more interesting than the plain chat/interview screen.
