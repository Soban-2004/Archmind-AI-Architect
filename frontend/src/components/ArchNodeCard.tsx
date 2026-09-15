import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, Database, Globe, Layers, Server } from "lucide-react";
import type { ArchNode, DiffStatus, LoadStatus, NodeKind } from "@/lib/types";

// Exported for the component palette (ComponentPalette.tsx) and the
// right-click add-here menu — reused as-is so a palette tile's icon/color
// is a real preview of the node it becomes, not a second visual language.
// Only the icon chip carries the kind color now (a neutral card body reads
// as one coherent instrument panel; five different full-card tints reads
// as five different products). Each hue is still deliberately distinct so
// a chip is a real at-a-glance kind indicator, not decoration.
export const KIND_STYLE: Record<NodeKind, { bg: string; border: string; icon: string; label: string; Icon: typeof Server }> = {
  service: {
    bg: "bg-blue-50 dark:bg-blue-500/15",
    border: "border-blue-200 dark:border-blue-500/30",
    icon: "text-blue-600 dark:text-blue-300",
    label: "Service",
    Icon: Server,
  },
  database: {
    // Yellow, not purple — purple/violet is the brand action color now
    // (see globals.css), and reusing it here would make every database
    // node look "selected" even when it isn't.
    bg: "bg-yellow-50 dark:bg-yellow-500/15",
    border: "border-yellow-200 dark:border-yellow-500/30",
    icon: "text-yellow-600 dark:text-yellow-300",
    label: "Database",
    Icon: Database,
  },
  queue: {
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    border: "border-emerald-200 dark:border-emerald-500/30",
    icon: "text-emerald-600 dark:text-emerald-300",
    label: "Queue",
    Icon: Layers,
  },
  external_dependency: {
    bg: "bg-info-400/10 dark:bg-info-500/15",
    border: "border-info-400/30 dark:border-info-500/30",
    icon: "text-info-600 dark:text-info-400",
    label: "External",
    Icon: Globe,
  },
  infra_node: {
    bg: "bg-slate-100 dark:bg-slate-500/15",
    border: "border-slate-300 dark:border-slate-500/30",
    icon: "text-slate-500 dark:text-slate-400",
    label: "Infra",
    Icon: Cloud,
  },
};

const DIFF_RING: Record<DiffStatus, string> = {
  added: "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-background",
  removed: "opacity-40 border-dashed border-red-400",
  changed: "ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-background",
};

const DIFF_BADGE: Record<DiffStatus, { text: string; className: string }> = {
  added: { text: "Added", className: "bg-emerald-600 text-white" },
  removed: { text: "Removed", className: "bg-red-500 text-white" },
  changed: { text: "Changed", className: "bg-brand-500 text-white" },
};

const SIM_RING: Record<LoadStatus, string> = {
  ok: "ring-2 ring-emerald-400 ring-offset-2 dark:ring-offset-background",
  warning: "ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-background",
  overloaded: "ring-4 ring-red-500 ring-offset-2 animate-pulse dark:ring-offset-background",
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
      className={`relative w-[224px] cursor-grab rounded-xl border bg-surface-2 px-3.5 py-3 shadow-soft backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-raised active:cursor-grabbing ${
        // A flat, solid-colored border for the selected node — no glow.
        // Two full px wider than the default 1px border so it still reads
        // as "the one thing you're looking at" without a colored halo.
        selected ? "border-2 border-brand-400" : "border-slate-200 dark:border-slate-800"
      } ${ring}`}
    >
      {badge && (
        <span className={`absolute -top-2.5 -right-2 rounded-md px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide shadow-soft ${badge.className}`}>
          {badge.text}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-surface !bg-slate-400 dark:!bg-slate-600" />
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${style.border} ${style.bg} ${style.icon}`}>
          <Icon size={15} strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{node.name}</div>
          <div className="truncate font-mono text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {style.label}
            {node.engine ? ` · ${String(node.engine)}` : node.type ? ` · ${String(node.type).replace(/_/g, " ")}` : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-surface !bg-slate-400 dark:!bg-slate-600" />
    </div>
  );
}
