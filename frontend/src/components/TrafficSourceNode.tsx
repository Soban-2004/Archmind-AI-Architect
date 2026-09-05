import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Users } from "lucide-react";

/**
 * The visual "where does traffic actually start" marker for a simulation
 * run. The simulator's own model (backend/app/services/simulator.py rule
 * 1) injects load at every node with no incoming edge — but until now
 * that was invisible: the entry node (usually the frontend) just lit up
 * with load from nowhere, with no line leading into it. This is a
 * synthetic node/edge pair added client-side only for the simulation
 * overlay (see lib/simView.ts) — it is never part of the real
 * architecture state, never sent to the backend, and never counted by
 * the analyzer or diff.
 */
export function TrafficSourceNode({ data }: NodeProps) {
  const rps = (data as { rps?: number } | undefined)?.rps;
  return (
    <div className="flex w-[150px] flex-col items-center gap-1.5 rounded-full border border-slate-300 bg-white/90 px-4 py-2.5 text-center shadow-sm backdrop-blur-sm dark:border-slate-600 dark:bg-slate-800/90">
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
        <Users size={15} strokeWidth={2.25} />
      </div>
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Users</div>
      {rps !== undefined && <div className="text-[10px] text-slate-400 dark:text-slate-500">{Math.round(rps)} req/s in</div>}
    </div>
  );
}
