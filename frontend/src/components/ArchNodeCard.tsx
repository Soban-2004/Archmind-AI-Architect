import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ArchNode, DiffStatus, NodeKind } from "@/lib/types";

const KIND_STYLE: Record<NodeKind, { bg: string; border: string; label: string }> = {
  service: { bg: "bg-blue-50", border: "border-blue-400", label: "SERVICE" },
  database: { bg: "bg-emerald-50", border: "border-emerald-400", label: "DATABASE" },
  queue: { bg: "bg-purple-50", border: "border-purple-400", label: "QUEUE" },
  external_dependency: { bg: "bg-orange-50", border: "border-orange-400", label: "EXTERNAL" },
  infra_node: { bg: "bg-slate-100", border: "border-slate-400", label: "INFRA" },
};

const DIFF_RING: Record<DiffStatus, string> = {
  added: "ring-2 ring-green-500 ring-offset-1",
  removed: "opacity-50 border-dashed border-red-500",
  changed: "ring-2 ring-amber-500 ring-offset-1",
};

const DIFF_BADGE: Record<DiffStatus, { text: string; className: string }> = {
  added: { text: "ADDED", className: "bg-green-600 text-white" },
  removed: { text: "REMOVED", className: "bg-red-600 text-white" },
  changed: { text: "CHANGED", className: "bg-amber-600 text-white" },
};

export function ArchNodeCard({ data }: NodeProps) {
  const node = data.archNode as ArchNode;
  const diffStatus = data.diffStatus as DiffStatus | undefined;
  const style = KIND_STYLE[node.node_kind];
  const badge = diffStatus ? DIFF_BADGE[diffStatus] : null;

  return (
    <div
      className={`relative rounded-lg border-2 ${style.border} ${style.bg} px-3 py-2 shadow-sm w-[190px] ${
        diffStatus ? DIFF_RING[diffStatus] : ""
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-2 -right-2 rounded px-1.5 py-0.5 text-[9px] font-bold ${badge.className}`}
        >
          {badge.text}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <div className="text-[10px] font-semibold tracking-wide text-slate-500">{style.label}</div>
      <div className="text-sm font-semibold text-slate-800 truncate">{node.name}</div>
      <div className="text-xs text-slate-500 truncate">
        {String(node.type)}
        {node.engine ? ` · ${node.engine}` : ""}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
    </div>
  );
}
