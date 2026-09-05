import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, Database, Globe, Layers, Server } from "lucide-react";
import type { ArchNode, DiffStatus, LoadStatus, NodeKind } from "@/lib/types";

const KIND_STYLE: Record<NodeKind, { bg: string; border: string; icon: string; label: string; Icon: typeof Server }> = {
  service: {
    bg: "bg-blue-50 dark:bg-blue-500/10",
    border: "border-blue-300 dark:border-blue-500/40",
    icon: "text-blue-500 dark:text-blue-400",
    label: "Service",
    Icon: Server,
  },
  database: {
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-300 dark:border-emerald-500/40",
    icon: "text-emerald-500 dark:text-emerald-400",
    label: "Database",
    Icon: Database,
  },
  queue: {
    bg: "bg-purple-50 dark:bg-purple-500/10",
    border: "border-purple-300 dark:border-purple-500/40",
    icon: "text-purple-500 dark:text-purple-400",
    label: "Queue",
    Icon: Layers,
  },
  external_dependency: {
    bg: "bg-orange-50 dark:bg-orange-500/10",
    border: "border-orange-300 dark:border-orange-500/40",
    icon: "text-orange-500 dark:text-orange-400",
    label: "External",
    Icon: Globe,
  },
  infra_node: {
    bg: "bg-slate-100 dark:bg-slate-500/10",
    border: "border-slate-300 dark:border-slate-500/40",
    icon: "text-slate-500 dark:text-slate-400",
    label: "Infra",
    Icon: Cloud,
  },
};

const DIFF_RING: Record<DiffStatus, string> = {
  added: "ring-2 ring-green-500 ring-offset-2 dark:ring-offset-slate-950",
  removed: "opacity-40 border-dashed border-red-400",
  changed: "ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-slate-950",
};

const DIFF_BADGE: Record<DiffStatus, { text: string; className: string }> = {
  added: { text: "Added", className: "bg-green-600 text-white" },
  removed: { text: "Removed", className: "bg-red-500 text-white" },
  changed: { text: "Changed", className: "bg-amber-500 text-white" },
};

const SIM_RING: Record<LoadStatus, string> = {
  ok: "ring-2 ring-green-400 ring-offset-2 dark:ring-offset-slate-950",
  warning: "ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-slate-950",
  overloaded: "ring-4 ring-red-500 ring-offset-2 animate-pulse dark:ring-offset-slate-950",
  killed: "opacity-30 border-dashed border-slate-400 grayscale",
};

const SIM_BADGE: Record<LoadStatus, { text: string; className: string } | null> = {
  ok: null,
  warning: { text: "Warning", className: "bg-amber-500 text-white" },
  overloaded: { text: "Overloaded", className: "bg-red-600 text-white" },
  killed: { text: "Killed", className: "bg-slate-500 text-white" },
};

export function ArchNodeCard({ data, selected }: NodeProps) {
  const node = data.archNode as ArchNode;
  const diffStatus = data.diffStatus as DiffStatus | undefined;
  const simStatus = data.simStatus as LoadStatus | undefined;
  const style = KIND_STYLE[node.node_kind];
  const Icon = style.Icon;

  const ring = simStatus ? SIM_RING[simStatus] : diffStatus ? DIFF_RING[diffStatus] : "";
  const badge = simStatus ? SIM_BADGE[simStatus] : diffStatus ? DIFF_BADGE[diffStatus] : null;

  return (
    <div
      className={`relative w-[200px] cursor-grab rounded-xl border ${style.border} ${style.bg} px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)] ${ring} ${
        selected ? "shadow-md" : ""
      }`}
    >
      {badge && (
        <span className={`absolute -top-2.5 -right-2 rounded-full px-2 py-0.5 text-[9px] font-bold shadow-sm ${badge.className}`}>{badge.text}</span>
      )}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-white !bg-slate-400 dark:!border-slate-900 dark:!bg-slate-500" />
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/70 dark:bg-black/20 ${style.icon}`}>
          <Icon size={15} strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{node.name}</div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {style.label}
            {node.engine ? ` · ${String(node.engine)}` : node.type ? ` · ${String(node.type).replace(/_/g, " ")}` : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-white !bg-slate-400 dark:!border-slate-900 dark:!bg-slate-500" />
    </div>
  );
}
