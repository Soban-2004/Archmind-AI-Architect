import { useState } from "react";
import { AlertTriangle, Check, Cloud, Database, Globe, Layers, Pencil, Server, X } from "lucide-react";
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
};

// Which of the fields above make sense to expose for direct editing on
// each node kind, and how — a free-text input, or one of a fixed set of
// values (matches the enums the backend schema actually accepts; an
// invalid value would just be rejected by the same validation a chat
// edit goes through, but there's no reason to let the UI offer one).
const EDITABLE_FIELDS: Partial<Record<NodeKind, { key: string; select?: string[] }[]>> = {
  service: [{ key: "language" }, { key: "responsibilities" }, { key: "scaling_mode", select: ["stateless", "stateful"] }],
  database: [{ key: "engine" }, { key: "role", select: ["primary", "replica", "cache"] }],
  queue: [{ key: "engine" }],
  external_dependency: [{ key: "criticality", select: ["hard", "soft"] }],
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
}

export function NodeDetailCard({ node, load, finding, onClose, onSave }: Props) {
  const meta = KIND_META[node.node_kind];
  const Icon = meta.Icon;
  const info = getComponentInfo(node);
  const editableFields = EDITABLE_FIELDS[node.node_kind] ?? [];

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const fields = Object.entries(FIELD_LABEL)
    .filter(([key]) => node[key] !== undefined && node[key] !== null && node[key] !== "")
    .map(([key, label]) => ({ key, label, value: String(node[key]).replace(/_/g, " ") }));

  function startEditing() {
    const initial: Record<string, string> = { name: node.name };
    for (const f of editableFields) initial[f.key] = typeof node[f.key] === "string" ? (node[f.key] as string) : "";
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
        const prev = typeof node[f.key] === "string" ? (node[f.key] as string) : "";
        if (next !== prev) attributes[f.key] = next || null;
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
    <div className="animate-fade-in absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
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
          {onSave && !editing && (
            <IconButton onClick={startEditing} className="h-6 w-6" title="Edit">
              <Pencil size={12} />
            </IconButton>
          )}
          <IconButton onClick={onClose} className="h-6 w-6">
            <X size={13} />
          </IconButton>
        </div>
      </div>

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
              ) : (
                <input
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
