// Mirrors backend/app/models/state.py. Kept intentionally narrow — the
// frontend only ever renders this, never constructs or edits it directly.

export type NodeKind = "service" | "database" | "queue" | "external_dependency" | "infra_node";

export interface ArchNode {
  id: string;
  node_kind: NodeKind;
  name: string;
  type: string;
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

export interface VersionRow {
  id: string;
  project_id: string;
  parent_version_id: string | null;
  label: string | null;
  kind: string;
  state: ArchitectureState;
  layout: Record<string, { x: number; y: number }>;
  created_at: string;
}

export type VersionSummary = Pick<
  VersionRow,
  "id" | "project_id" | "parent_version_id" | "label" | "kind" | "created_at"
>;

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

export type ChatResponse =
  | { kind: "question"; question: string; quick_replies: string[]; usage: TokenUsage | null }
  | { kind: "architecture"; summary: string; version: VersionRow; diff: VersionDiff | null; usage: TokenUsage | null }
  // A non-mutating chat reply — a question/recommendation answer, a
  // what-if analysis narration, or the empty-commands safety net (see
  // backend/app/services/intent_router.py). Nothing on the canvas
  // changed: no version, no diff.
  | { kind: "answer"; answer: string; usage: TokenUsage | null }
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
}
