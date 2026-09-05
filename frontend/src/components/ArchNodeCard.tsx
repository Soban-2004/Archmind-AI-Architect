import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ArchNode, NodeKind } from "@/lib/types";

const KIND_STYLE: Record<NodeKind, { bg: string; border: string; label: string }> = {
  service: { bg: "bg-blue-50", border: "border-blue-400", label: "SERVICE" },
  database: { bg: "bg-emerald-50", border: "border-emerald-400", label: "DATABASE" },
  queue: { bg: "bg-purple-50", border: "border-purple-400", label: "QUEUE" },
  external_dependency: { bg: "bg-orange-50", border: "border-orange-400", label: "EXTERNAL" },
  infra_node: { bg: "bg-slate-100", border: "border-slate-400", label: "INFRA" },
};

export function ArchNodeCard({ data }: NodeProps) {
  const node = data.archNode as ArchNode;
  const style = KIND_STYLE[node.node_kind];

  return (
    <div className={`rounded-lg border-2 ${style.border} ${style.bg} px-3 py-2 shadow-sm w-[190px]`}>
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
