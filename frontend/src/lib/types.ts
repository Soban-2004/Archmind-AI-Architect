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

export type ChatResponse =
  | { kind: "question"; question: string }
  | { kind: "architecture"; summary: string; version: VersionRow; diff: VersionDiff | null }
  | { kind: "error"; error: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
