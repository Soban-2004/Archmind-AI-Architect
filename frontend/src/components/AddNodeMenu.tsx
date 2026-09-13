"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { AddNodeCommand, NodeKind } from "@/lib/types";
import { IconButton } from "./ui";

// Mirrors backend/app/models/state.py's ServiceType/DatabaseType/QueueType/
// ExternalDependencyType/InfraType enums exactly — this is a client-side
// convenience list for the picker, not a separate source of truth; an
// out-of-sync value here would just get rejected by the same Pydantic
// validation add_node always goes through server-side, same as every
// other manually- or chat-constructed command.
const NODE_TYPE_OPTIONS: Record<NodeKind, string[]> = {
  service: ["gateway", "service", "worker", "frontend", "edge_cdn", "scheduler", "ml_inference", "realtime"],
  database: ["relational", "document", "keyvalue", "search", "graph", "time_series", "columnar", "vector"],
  queue: ["queue", "pubsub", "stream"],
  external_dependency: ["third_party_api", "payment", "market_data", "auth_provider", "storage", "notification_provider", "analytics", "feature_flags"],
  infra_node: [
    "cdn",
    "load_balancer",
    "api_gateway",
    "object_storage",
    "container_runtime",
    "observability",
    "dns",
    "firewall_waf",
    "secrets_manager",
    "service_mesh",
  ],
};

const KIND_LABEL: Record<NodeKind, string> = {
  service: "Service",
  database: "Database",
  queue: "Queue",
  external_dependency: "External dependency",
  infra_node: "Infrastructure",
};

// database/queue require `engine` server-side (Database.engine / Queue.engine
// are required str fields, no default) — every other kind has no required
// attribute beyond `type`, which the form always sends.
const REQUIRES_ENGINE: Partial<Record<NodeKind, true>> = { database: true, queue: true };

interface Props {
  onAdd: (command: AddNodeCommand) => Promise<void>;
  disabled?: boolean;
}

/**
 * The manual half of "add a component" — the same AddNodeCommand shape
 * and the same server-side validation a chat-proposed add_node already
 * goes through (see services/mutation_engine.py), just filled in by hand
 * instead of an LLM. `ref` only has to be unique within this one command
 * batch (a single add_node here, never combined with an add_edge the way
 * a chat batch can be — connecting the new node is a separate drag-to-
 * connect afterward, see ArchitectureCanvas's onConnect), so a fixed
 * string is fine.
 */
export function AddNodeMenu({ onAdd, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NodeKind>("service");
  const [type, setType] = useState(NODE_TYPE_OPTIONS.service[0]);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState("");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeKind(next: NodeKind) {
    setKind(next);
    setType(NODE_TYPE_OPTIONS[next][0]);
    setError(null);
  }

  function reset() {
    setKind("service");
    setType(NODE_TYPE_OPTIONS.service[0]);
    setName("");
    setEngine("");
    setRationale("");
    setError(null);
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (REQUIRES_ENGINE[kind] && !engine.trim()) {
      setError(`${KIND_LABEL[kind]} needs an engine (e.g. "postgres", "redis", "kafka").`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const attributes: Record<string, unknown> = { type };
      if (REQUIRES_ENGINE[kind]) attributes.engine = engine.trim();
      if (rationale.trim()) attributes.rationale = rationale.trim();
      await onAdd({ op: "add_node", ref: "new_node", node_type: kind, name: trimmedName, attributes });
      reset();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <IconButton
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="border border-slate-200 bg-white/90 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90"
        title="Add a component manually"
      >
        <Plus size={14} className={open ? "text-brand-600 dark:text-indigo-400" : ""} />
      </IconButton>

      {open && (
        <div className="animate-fade-in absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Add a component</p>

          <label className="mt-2.5 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Kind</label>
          <select
            value={kind}
            onChange={(e) => changeKind(e.target.value as NodeKind)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>

          <label className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {NODE_TYPE_OPTIONS[kind].map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <label className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Notifications Queue"
            className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />

          {REQUIRES_ENGINE[kind] && (
            <>
              <label className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Engine</label>
              <input
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                placeholder='e.g. "postgres", "redis"'
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </>
          )}

          <label className="mt-2 block text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Why (optional)</label>
          <textarea
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why this project needs it — left blank if you'd rather not say"
            className="mt-0.5 w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />

          {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">⚠️ {error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add to canvas
          </button>
        </div>
      )}
    </div>
  );
}
