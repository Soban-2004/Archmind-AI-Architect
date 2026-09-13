import { useState } from "react";
import { AlertTriangle, Check, Cloud, Database, Globe, Heart, Layers, Pencil, Server, Skull, Trash2, X } from "lucide-react";
import { getComponentInfo } from "@/lib/componentInfo";
import type { ArchNode, NodeKind, NodeLoad, SimulationFinding } from "@/lib/types";
import { IconButton, ProgressBar, Spinner } from "./ui";

const KIND_META: Record<NodeKind, { label: string; Icon: typeof Server; accent: string }> = {
  service: { label: "Service", Icon: Server, accent: "text-blue-500" },
  database: { label: "Database", Icon: Database, accent: "text-emerald-500" },
  queue: { label: "Queue", Icon: Layers, accent: "text-purple-500" },
  external_dependency: { label: "External dependency", Icon: Globe, accent: "text-orange-500" },
  infra_node: { label: "Infrastructure", Icon: Cloud, accent: "text-slate-500" },
};

const FIELD_LABEL: Record<string, string> = {
  language: "Language",
  engine: "Engine",
  role: "Role",
  scaling_mode: "Scaling",
  responsibilities: "Responsibilities",
  criticality: "Criticality",
  size: "Size",
  storage_gb: "Storage",
  rationale: "Why this exists here",
};

const SIZE_OPTIONS = ["small", "medium", "large", "xlarge"];

// Which of the fields above make sense to expose for direct editing on
// each node kind, and how — a free-text input, one of a fixed set of
// values, or (`numeric`) a number input whose value gets sent as an
// actual number, not a string (matches the enums/types the backend schema
// actually accepts; an invalid value would just be rejected by the same
// validation a chat edit goes through, but there's no reason to let the
// UI offer one). `size` was the first field every kind here shares, so
// it's listed once and spread in rather than repeated per kind. `rationale`
// (`multiline`, a <textarea>) is the last field on every kind — see
// state.py's Service.rationale for what it holds.
const SIZE_FIELD = { key: "size", select: SIZE_OPTIONS };
const RATIONALE_FIELD = { key: "rationale", multiline: true };
const EDITABLE_FIELDS: Partial<Record<NodeKind, { key: string; select?: string[]; numeric?: boolean; multiline?: boolean }[]>> = {
  service: [{ key: "language" }, { key: "responsibilities" }, { key: "scaling_mode", select: ["stateless", "stateful"] }, SIZE_FIELD, RATIONALE_FIELD],
  database: [
    { key: "engine" },
    { key: "role", select: ["primary", "replica", "cache"] },
    SIZE_FIELD,
    { key: "storage_gb", numeric: true },
    RATIONALE_FIELD,
  ],
  queue: [{ key: "engine" }, SIZE_FIELD, RATIONALE_FIELD],
  external_dependency: [{ key: "criticality", select: ["hard", "soft"] }, RATIONALE_FIELD],
  infra_node: [RATIONALE_FIELD],
};

const STATUS_COLOR: Record<string, string> = {
  ok: "text-green-600 dark:text-green-400",
  warning: "text-amber-600 dark:text-amber-400",
  overloaded: "text-red-600 dark:text-red-400",
  killed: "text-slate-400 dark:text-slate-500",
};

interface Props {
  node: ArchNode;
  load?: NodeLoad;
  finding?: SimulationFinding;
  onClose: () => void;
  /** Omit to render read-only (e.g. the compare view's snapshot, which
   * has no single active version to edit onto). */
  onSave?: (nodeId: string, attributes: Record<string, unknown>) => Promise<void>;
  /** Removes this node manually — a real remove_node command through the
   * exact same validated path a chat "remove the queue" already uses
   * (see ArchitectureCanvas's onApplyCommands). Omit alongside onSave for
   * a read-only canvas. */
  onDelete?: (nodeId: string) => Promise<void>;
  /** Present exactly when the simulation dock is active — renders a Kill/
   * Revive toggle so failure scenarios can be built by clicking nodes
   * directly instead of hunting through a checkbox list. */
  killed?: boolean;
  onToggleKill?: () => void;
}

export function NodeDetailCard({ node, load, finding, onClose, onSave, onDelete, killed, onToggleKill }: Props) {
  const meta = KIND_META[node.node_kind];
  const Icon = meta.Icon;
  const info = getComponentInfo(node);
  const editableFields = EDITABLE_FIELDS[node.node_kind] ?? [];

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(node.id);
      // No setDeleting(false)/onClose() on success — the node this card is
      // showing no longer exists once the parent's state updates, so the
      // parent unmounts this card itself (matches how a successful save
      // doesn't need to manage its own dismissal beyond editing=false).
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  // `rationale` gets its own prominent, non-truncated block below (project-
  // specific prose, not a short tag/value pair) rather than sitting in this
  // truncated key/value grid alongside "Size" and "Engine".
  const fields = Object.entries(FIELD_LABEL)
    .filter(([key]) => key !== "rationale")
    .filter(([key]) => node[key] !== undefined && node[key] !== null && node[key] !== "")
    .map(([key, label]) => ({ key, label, value: key === "storage_gb" ? `${node[key]} GB` : String(node[key]).replace(/_/g, " ") }));

  const rationale = typeof node.rationale === "string" && node.rationale.trim() ? node.rationale : null;

  // A field can be a string (language, engine, ...) or a number
  // (storage_gb) on the real node — both need to round-trip through the
  // draft's plain string inputs the same way.
  function displayValue(raw: unknown): string {
    return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  }

  function startEditing() {
    const initial: Record<string, string> = { name: node.name };
    for (const f of editableFields) initial[f.key] = displayValue(node[f.key]);
    setDraft(initial);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      // Only send fields that actually changed, plus name if it changed —
      // a partial update, matching what UpdateNodeCommand expects server-side.
      const attributes: Record<string, unknown> = {};
      if (draft.name !== node.name && draft.name.trim()) attributes.name = draft.name.trim();
      for (const f of editableFields) {
        const next = draft[f.key] ?? "";
        const prev = displayValue(node[f.key]);
        if (next === prev) continue;
        if (f.numeric) {
          if (next.trim() !== "" && Number.isNaN(Number(next))) {
            throw new Error(`${FIELD_LABEL[f.key] ?? f.key} must be a number`);
          }
          attributes[f.key] = next.trim() === "" ? null : Number(next);
        } else {
          attributes[f.key] = next || null;
        }
      }
      if (Object.keys(attributes).length > 0) await onSave(node.id, attributes);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    // Top-left, not bottom-left: React Flow's own zoom Controls default to
    // bottom-left, and this card was sitting directly on top of them
    // (and, once added, the simulation dock's bottom-center bar too) —
    // top-left is the one corner nothing else on the canvas claims.
    <div className="animate-fade-in absolute left-4 top-4 z-10 w-72 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 ${meta.accent}`}>
            <Icon size={17} />
          </div>
          <div className="min-w-0">
            {editing ? (
              <input
                autoFocus
                value={draft.name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm font-semibold dark:border-indigo-500/50 dark:bg-slate-800 dark:text-slate-100"
              />
            ) : (
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{node.name}</p>
            )}
            <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
              {meta.label} · {String(node.type).replace(/_/g, " ")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onSave && !editing && !confirmingDelete && (
            <IconButton onClick={startEditing} className="h-6 w-6" title="Edit">
              <Pencil size={12} />
            </IconButton>
          )}
          {onDelete && !editing && !confirmingDelete && (
            <IconButton onClick={() => setConfirmingDelete(true)} className="h-6 w-6" title="Delete">
              <Trash2 size={12} />
            </IconButton>
          )}
          <IconButton onClick={onClose} className="h-6 w-6">
            <X size={13} />
          </IconButton>
        </div>
      </div>

      {confirmingDelete && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 dark:border-red-500/20 dark:bg-red-500/10">
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-red-700 dark:text-red-400">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            Remove &ldquo;{node.name}&rdquo; and every connection to it? This creates a new version — the current one stays in history.
          </p>
          {error && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">⚠️ {error}</p>}
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? <Spinner className="h-3 w-3" /> : <Trash2 size={12} />} Remove
            </button>
            <button
              onClick={() => {
                setConfirmingDelete(false);
                setError(null);
              }}
              disabled={deleting}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {onToggleKill && !editing && !confirmingDelete && (
        <button
          onClick={onToggleKill}
          className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition active:scale-[0.98] ${
            killed
              ? "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
              : "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
          }`}
        >
          {killed ? (
            <>
              <Heart size={12} /> Revive
            </>
          ) : (
            <>
              <Skull size={12} /> Kill this node
            </>
          )}
        </button>
      )}

      {rationale && !editing && (
        // Project-specific — why THIS node, in THIS architecture (see
        // state.py's Service.rationale) — shown ahead of the generic
        // componentInfo.ts reference text below, and never truncated: it's
        // usually one or two sentences, short enough to just show in full.
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
          <p className="text-[10px] font-medium uppercase tracking-wide text-brand-600 dark:text-indigo-300">Why this is here</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200">{rationale}</p>
        </div>
      )}

      {info && !editing && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{info.description}</p>
          {info.examples && info.examples.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {info.examples.map((ex) => (
                <span
                  key={ex}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                >
                  {ex}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {editableFields.map((f) => (
            <div key={f.key}>
              <label className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{FIELD_LABEL[f.key]}</label>
              {f.select ? (
                <select
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">—</option>
                  {f.select.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : f.multiline ? (
                <textarea
                  rows={3}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              ) : (
                <input
                  type={f.numeric ? "number" : "text"}
                  min={f.numeric ? 0 : undefined}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              )}
            </div>
          ))}
          {error && <p className="text-[11px] text-red-600 dark:text-red-400">⚠️ {error}</p>}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? <Spinner className="h-3 w-3" /> : <Check size={12} />} Save
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        fields.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
            {fields.map((f) => (
              <div key={f.key}>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{f.label}</dt>
                <dd className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{f.value}</dd>
              </div>
            ))}
          </dl>
        )
      )}

      {load && !editing && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Simulated load</span>
            <span className={`font-semibold ${STATUS_COLOR[load.status]}`}>
              {load.status === "killed" ? "killed" : `${load.utilization_pct.toFixed(0)}%`}
            </span>
          </div>
          {load.status !== "killed" && (
            <>
              <div className="mt-1.5">
                <ProgressBar
                  pct={load.utilization_pct}
                  colorClassName={load.status === "overloaded" ? "bg-red-600" : load.status === "warning" ? "bg-amber-500" : "bg-green-500"}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                {load.incoming_rps} / {load.capacity_rps} req/s · {load.basis}
              </p>
            </>
          )}
          {finding && (
            <div className="mt-2 flex gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-700 dark:bg-red-500/10 dark:text-red-400">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {finding.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
