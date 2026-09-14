// Mirrors backend/app/models/state.py. Kept intentionally narrow — the
// frontend only ever renders this, never constructs or edits it directly.

export type NodeKind = "service" | "database" | "queue" | "external_dependency" | "infra_node";

export interface ArchNode {
  id: string;
  node_kind: NodeKind;
  name: string;
  type: string;
  // Project-specific "why this node exists here" — see
  // backend/app/models/state.py's Service.rationale for the full
  // explanation. Set by the LLM on add_node/update_node; absent for a
  // manually-added node unless the person who added it wrote one.
  rationale?: string | null;
  // the rest of the fields vary by node_kind (language, engine, role, criticality, ...)
  [key: string]: unknown;
}

export interface ArchEdge {
  id: string;
  from_id: string;
  to_id: string;
  protocol: "http" | "grpc" | "queue" | "sql" | "cache";
  sync_async: "sync" | "async_";
  notes?: string | null;
}

// Mirrors backend/app/models/commands.py — only the shapes the frontend
// itself constructs directly (manual canvas edits: the palette, drag-to-
// connect, delete). The LLM emits the full command vocabulary server-side
// through the exact same discriminated union; this is the client's own
// subset of the identical wire format, not a separate command language.
export interface AddNodeCommand {
  op: "add_node";
  ref: string;
  node_type: NodeKind;
  name: string;
  attributes: Record<string, unknown>;
}

export interface RemoveNodeCommand {
  op: "remove_node";
  id: string;
}

export interface AddEdgeCommand {
  op: "add_edge";
  from_id: string;
  to_id: string;
  protocol: ArchEdge["protocol"];
  sync_async: ArchEdge["sync_async"];
  notes?: string | null;
}

export interface RemoveEdgeCommand {
  op: "remove_edge";
  id: string;
}

export type MutationCommand = AddNodeCommand | RemoveNodeCommand | AddEdgeCommand | RemoveEdgeCommand;

export interface Constraint {
  type: string;
  value: string;
}

export interface ADR {
  id: string;
  decision: string;
  rationale: string;
  triggered_by: string;
  superseded_by?: string | null;
}

export interface ArchitectureState {
  nodes: ArchNode[];
  edges: ArchEdge[];
  constraints: Constraint[];
  adrs: ADR[];
}

// Persisted alongside the version (backend/app/db/schema.sql's `evidence`
// column) — populated only for kind="reconstruction" (a real ingested
// repo); every chat/manual edit was never grounded in real repo evidence
// to begin with, so it has nothing here. IMPORTANT: the column's real
// Postgres default is a bare `{}`, NOT `{evidence: [], citations: {}}` —
// found live, a real crash clicking any node on a chat/manual-edit
// version (evidence.citations[node.id] throws on a `{}` with no
// `citations` key at all). A plain `version.evidence ?? fallback` does
// NOT catch this: `{}` is truthy, so the fallback never runs. Every call
// site that reads a VersionRow's `evidence` off the wire MUST go through
// normalizeVersionEvidence below instead of trusting this type directly —
// the type below describes the shape every OTHER part of the app is
// safe to assume once normalized, not what the API literally returns.
export interface VersionEvidence {
  evidence: Evidence[];
  citations: Record<string, string[]>; // node_id -> evidence id(s)
}

export function normalizeVersionEvidence(raw: Partial<VersionEvidence> | null | undefined): VersionEvidence {
  return { evidence: raw?.evidence ?? [], citations: raw?.citations ?? {} };
}

export interface VersionRow {
  id: string;
  project_id: string;
  parent_version_id: string | null;
  label: string | null;
  kind: string;
  state: ArchitectureState;
  layout: Record<string, { x: number; y: number }>;
  evidence: VersionEvidence;
  created_at: string;
}

export type VersionSummary = Pick<
  VersionRow,
  "id" | "project_id" | "parent_version_id" | "label" | "kind" | "created_at"
>;

// Mirrors backend/app/models/evidence.py's Evidence — one discrete,
// source-attributed fact extracted from an ingested repo.
export interface Evidence {
  id: string;
  fact: string;
  detail: string;
  source: string;
}

// Mirrors POST /ingest's real response shape (backend/app/api/routes/ingestion.py).
export interface IngestResponse {
  ok: boolean;
  error?: string;
  unsupported_notes: string[];
  project?: { id: string; name: string; created_at: string };
  version?: VersionRow;
  summary?: string;
  citations?: Record<string, string[]>;
  evidence?: Evidence[];
  dropped_uncited_refs?: string[];
}

// Mirrors backend/app/models/diff.py
export type DiffStatus = "added" | "removed" | "changed";

export interface NodeDiffEntry {
  id: string;
  status: DiffStatus;
  before: ArchNode | null;
  after: ArchNode | null;
  changed_fields: string[];
}

export interface EdgeDiffEntry {
  key: string;
  status: DiffStatus;
  before: ArchEdge | null;
  after: ArchEdge | null;
  changed_fields: string[];
}

export interface ConstraintDiffEntry {
  type: string;
  status: DiffStatus;
  before: string | null;
  after: string | null;
}

export interface VersionDiff {
  nodes: NodeDiffEntry[];
  edges: EdgeDiffEntry[];
  constraints: ConstraintDiffEntry[];
  summary: Record<string, number>;
}

// Real usage from the LLM call that produced a turn (see
// GroqProvider.last_usage) — absent for a turn the deterministic Tier-1
// fast path handled with no LLM call at all.
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// One real SSE frame from POST /projects/{id}/chat/stream — "stage" fires
// exactly when the backend pipeline actually starts that real step
// (services/interview.py's OnStage), never a client-side guess; "result"
// carries the same payload shape the plain POST /chat returns.
export type ChatStreamEvent = { type: "stage"; stage: string } | { type: "result"; payload: ChatResponse };

// Mirrors backend/app/models/advisory.py's WebSource — a real search
// result services/web_search.py actually fetched and fed to the prompt
// for a time-sensitive advisory question ("current pricing", "is X still
// maintained", see intent_router.py's needs_web_grounding), never
// something the LLM itself claims to have found.
export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

export type ChatResponse =
  | { kind: "question"; question: string; quick_replies: string[]; usage: TokenUsage | null; reasoning?: string[] }
  | { kind: "architecture"; summary: string; version: VersionRow; diff: VersionDiff | null; usage: TokenUsage | null; reasoning?: string[] }
  // A non-mutating chat reply — a question/recommendation answer, a
  // what-if analysis narration, or the empty-commands safety net (see
  // backend/app/services/intent_router.py). Nothing on the canvas
  // changed: no version, no diff. `sources` is only ever non-empty for a
  // web-grounded advisory answer.
  | { kind: "answer"; answer: string; usage: TokenUsage | null; sources?: WebSource[] }
  | { kind: "error"; error: string };

// Mirrors backend/app/models/compare.py
export interface DiffExplanationEntry {
  ref: string;
  explanation: string;
}

export interface CompareExplanation {
  entries: DiffExplanationEntry[];
  overall_summary: string;
}

export interface CompareResult {
  diff: VersionDiff;
  explanation: CompareExplanation;
}

// Mirrors backend/app/models/analysis.py
export type Category =
  | "scalability"
  | "reliability"
  | "security"
  | "cost"
  | "observability"
  | "performance"
  | "maintainability";

export type Severity = "minor" | "moderate" | "major";

export interface Finding {
  rule_id: string;
  category: Category;
  severity: Severity;
  points: number;
  message: string;
  evidence_node_ids: string[];
  evidence_edge_ids: string[];
}

export interface CategoryScore {
  category: Category;
  score: number;
  findings: Finding[];
}

export interface CostLineItem {
  node_id: string;
  node_name: string;
  monthly_cost_usd: number;
  basis: string;
}

export interface Scorecard {
  rules_version: string;
  overall_score: number;
  categories: CategoryScore[];
  estimated_monthly_cost_usd: number | null;
  budget_monthly_usd: number | null;
  cost_breakdown: CostLineItem[];
}

export interface ScorecardAnswer {
  answer: string;
  cited_rule_ids: string[];
}

// Mirrors backend/app/models/simulation.py
export type LoadStatus = "ok" | "warning" | "overloaded" | "killed";

export interface NodeLoad {
  node_id: string;
  node_name: string;
  incoming_rps: number;
  capacity_rps: number;
  utilization_pct: number;
  status: LoadStatus;
  basis: string;
}

export interface EdgeLoad {
  edge_id: string;
  from_id: string;
  to_id: string;
  rps: number;
}

export interface SimulationFinding {
  order: number;
  node_id: string;
  node_name: string;
  message: string;
}

export interface SimulationResult {
  scenario: string;
  multiplier: number;
  killed_node_ids: string[];
  loads: NodeLoad[];
  edge_loads: EdgeLoad[];
  findings: SimulationFinding[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  quickReplies?: string[];
  /** Only true for the message just added this session — drives the
   * typewriter reveal; history loaded from the server renders instantly. */
  animate?: boolean;
  /** ISO timestamp, set client-side when the message is appended — shown
   * on hover, not the backend's own created_at (this app doesn't reload
   * conversation history into the UI yet, see README). */
  createdAt?: string;
  /** Real sources a web-grounded advisory answer actually cited (see
   * ChatResponse's "answer" variant) — undefined/empty for every other
   * message, which is most of them. */
  sources?: WebSource[];
  /** The model's own 1-3 bullets naming the real constraint(s)/tradeoff
   * behind this question or these edit choices (see ChatResponse's
   * "question"/"architecture" variants and backend/app/llm/prompts.py) —
   * distinct from `content` (the question/summary itself): this is the
   * "why", shown as its own small block, not folded into the same prose.
   * Undefined/empty whenever the model judged there was nothing genuine
   * worth surfacing, which is expected for a simple question or an edit
   * with one obvious cause. */
  reasoning?: string[];
}
