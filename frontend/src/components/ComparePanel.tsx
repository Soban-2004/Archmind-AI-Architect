"use client";

import type { CompareResult, DiffStatus } from "@/lib/types";

interface Props {
  result: CompareResult;
  onExit: () => void;
}

const STATUS_STYLE: Record<DiffStatus, string> = {
  added: "bg-green-100 text-green-700",
  removed: "bg-red-100 text-red-700",
  changed: "bg-amber-100 text-amber-700",
};

export function ComparePanel({ result, onExit }: Props) {
  const { diff, explanation } = result;
  const explanationByRef = new Map(explanation.entries.map((e) => [e.ref, e.explanation]));

  const rows: { ref: string; status: DiffStatus; label: string }[] = [
    ...diff.nodes.map((d) => ({ ref: d.id, status: d.status, label: (d.after ?? d.before)?.name ?? d.id })),
    ...diff.edges.map((d) => ({ ref: `edge:${d.key}`, status: d.status, label: `connection ${d.key}` })),
    ...diff.constraints.map((d) => ({
      ref: `constraint:${d.type}`,
      status: d.status,
      label: `${d.type}: ${d.before ?? "—"} → ${d.after ?? "—"}`,
    })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-800">Compare</h1>
          <p className="text-xs text-slate-400">
            {rows.length} structural difference{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <button onClick={onExit} className="text-xs text-blue-600 underline">
          Exit compare
        </button>
      </div>

      {explanation.overall_summary && (
        <div className="px-4 py-3 text-xs text-slate-600 border-b border-slate-100 bg-slate-50">
          {explanation.overall_summary}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {rows.length === 0 && <p className="text-xs text-slate-400">No structural differences.</p>}
        {rows.map((row) => (
          <div key={row.ref} className="rounded-md border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${STATUS_STYLE[row.status]}`}>
                {row.status.toUpperCase()}
              </span>
              <span className="text-sm font-medium text-slate-700">{row.label}</span>
            </div>
            {explanationByRef.has(row.ref) && (
              <p className="mt-1 text-xs text-slate-500">{explanationByRef.get(row.ref)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
