import { AlertTriangle, Cloud, Database, Globe, Layers, Server, X } from "lucide-react";
import { getComponentInfo } from "@/lib/componentInfo";
import type { ArchNode, NodeKind, NodeLoad, SimulationFinding } from "@/lib/types";
import { IconButton } from "./ui";

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
}

export function NodeDetailCard({ node, load, finding, onClose }: Props) {
  const meta = KIND_META[node.node_kind];
  const Icon = meta.Icon;
  const fields = Object.entries(FIELD_LABEL)
    .filter(([key]) => node[key] !== undefined && node[key] !== null && node[key] !== "")
    .map(([key, label]) => ({ label, value: String(node[key]).replace(/_/g, " ") }));
  const info = getComponentInfo(node);

  return (
    <div className="animate-fade-in absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 ${meta.accent}`}>
            <Icon size={17} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{node.name}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {meta.label} · {String(node.type).replace(/_/g, " ")}
            </p>
          </div>
        </div>
        <IconButton onClick={onClose} className="h-6 w-6">
          <X size={13} />
        </IconButton>
      </div>

      {info && (
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

      {fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{f.label}</dt>
              <dd className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {load && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Simulated load</span>
            <span className={`font-semibold ${STATUS_COLOR[load.status]}`}>
              {load.status === "killed" ? "killed" : `${load.utilization_pct.toFixed(0)}%`}
            </span>
          </div>
          {load.status !== "killed" && (
            <>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full ${load.status === "overloaded" ? "bg-red-600" : load.status === "warning" ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(100, load.utilization_pct)}%` }}
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
