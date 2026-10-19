import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cloud, Database, Globe, Layers, Server, TriangleAlert } from "lucide-react";
import type { ArchNode, DiffStatus, LoadStatus, NodeKind, NodeLoad } from "@/lib/types";

// Exported for the component palette (ComponentPalette.tsx) and the
// right-click add-here menu — reused as-is so a palette tile's icon/color
// is a real preview of the node it becomes, not a second visual language.
// Only the icon chip carries the kind color now (a neutral card body reads
// as one coherent instrument panel; five different full-card tints reads
// as five different products). Each hue is still deliberately distinct so
// a chip is a real at-a-glance kind indicator, not decoration.
export const KIND_STYLE: Record<NodeKind, { bg: string; border: string; icon: string; label: string; Icon: typeof Server }> = {
  service: {
    bg: "bg-brand-50 dark:bg-brand-500/15",
    border: "border-brand-200 dark:border-brand-500/30",
    icon: "text-brand-700 dark:text-brand-300",
    label: "Service",
    Icon: Server,
  },
  database: {
    bg: "bg-info-400/10 dark:bg-info-500/15",
    border: "border-info-400/30 dark:border-info-500/30",
    icon: "text-info-600 dark:text-info-400",
    label: "Database",
    Icon: Database,
  },
  queue: {
    bg: "bg-amber-50 dark:bg-amber-500/15",
    border: "border-amber-200 dark:border-amber-500/30",
    icon: "text-amber-700 dark:text-amber-300",
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
    icon: "text-slate-700 dark:text-slate-300",
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
  ok: "",
  warning: "is-warning",
  overloaded: "is-overloaded",
  killed: "border-dashed border-slate-500 grayscale",
};

const SIM_BADGE: Record<LoadStatus, { text: string; className: string } | null> = {
  ok: null,
  warning: { text: "Warning", className: "bg-amber-500 text-slate-950" },
  overloaded: { text: "Overloaded", className: "bg-red-600 text-white" },
  killed: { text: "Killed", className: "bg-slate-700 text-white dark:bg-slate-600" },
};

export function ArchNodeCard({ data, selected }: NodeProps) {
  const node = data.archNode as ArchNode;
  const diffStatus = data.diffStatus as DiffStatus | undefined;
  const simStatus = data.simStatus as LoadStatus | undefined;
  const simLoad = data.simLoad as NodeLoad | undefined;
  const style = KIND_STYLE[node.node_kind];
  const Icon = style.Icon;
  const revealDelay = typeof data.revealDelay === "number" ? data.revealDelay : 0;
  const previousStatus = useRef<LoadStatus | undefined>(undefined);
  const [overloadImpact, setOverloadImpact] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (simStatus === "overloaded" && previousStatus.current !== "overloaded") {
      setOverloadImpact(true);
      timeout = setTimeout(() => setOverloadImpact(false), 320);
    }
    previousStatus.current = simStatus;
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [simStatus]);

  const ring = simStatus ? SIM_RING[simStatus] : diffStatus ? DIFF_RING[diffStatus] : "";
  const badge = simStatus ? SIM_BADGE[simStatus] : diffStatus ? DIFF_BADGE[diffStatus] : null;
  const utilization = simLoad ? Math.max(0, simLoad.utilization_pct) : null;
  const capacityWidth = utilization === null ? 0 : Math.min(100, utilization);
  const overflowWidth = utilization !== null && utilization > 100 ? Math.min(42, ((utilization - 100) / utilization) * 100) : 0;
  const statusClass = simStatus === "overloaded" ? "bg-red-600" : simStatus === "warning" ? "bg-amber-500" : "bg-emerald-600";
  const badgeText = simStatus === "overloaded" && utilization !== null
    ? `${Math.round(utilization)}% load`
    : simStatus === "warning" && utilization !== null
      ? `${Math.round(utilization)}% warning`
      : badge?.text;
  const revealAnimation = `node-in 420ms var(--motion-out) ${revealDelay}ms both`;
  const nodeAnimation = overloadImpact
    ? `overload-impact 280ms var(--motion-out), ${revealAnimation}`
    : revealAnimation;

  return (
    <div
      style={diffStatus === "changed" || diffStatus === "removed" ? undefined : { animation: nodeAnimation }}
      className={`architecture-node relative w-[224px] cursor-grab rounded-xl border bg-surface px-3.5 py-3 shadow-soft active:cursor-grabbing ${selected ? "is-selected" : ""} ${diffStatus === "changed" ? "is-changed" : ""} ${
        // A flat, solid-colored border for the selected node — no glow.
        // Two full px wider than the default 1px border so it still reads
        // as "the one thing you're looking at" without a colored halo.
        selected ? "border-brand-400 ring-1 ring-brand-400" : "border-slate-200 dark:border-slate-700"
      } ${ring}`}
    >
      {badge && (
        <span className={`absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tabular-nums shadow-soft ${badge.className}`}>
          {(simStatus === "warning" || simStatus === "overloaded") && <TriangleAlert size={10} strokeWidth={2.5} aria-hidden="true" />}
          {badgeText}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-surface !bg-slate-400 dark:!bg-slate-600" />
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${style.border} ${style.bg} ${style.icon}`}>
          <Icon size={15} strokeWidth={2.25} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{node.name}</div>
          <div className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {style.label}
            {node.engine ? ` · ${String(node.engine)}` : node.type && node.type !== node.node_kind ? ` · ${String(node.type).replace(/_/g, " ")}` : ""}
          </div>
        </div>
      </div>
      {simStatus && simStatus !== "killed" && utilization !== null && simLoad && (
        <div
          className="capacity-rail absolute inset-x-2 bottom-0.5 h-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/80"
          role="meter"
          aria-label={`${node.name} capacity utilization`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(utilization))}
          aria-valuetext={`${Math.round(utilization)} percent; ${simLoad.incoming_rps} of ${simLoad.capacity_rps} requests per second`}
        >
          <span className={`absolute inset-y-0 left-0 rounded-full ${statusClass}`} style={{ width: `${capacityWidth}%` }} />
          {overflowWidth > 0 && <span className="capacity-overflow absolute inset-y-0 right-0" style={{ width: `${overflowWidth}%` }} />}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-surface !bg-slate-400 dark:!bg-slate-600" />
    </div>
  );
}
