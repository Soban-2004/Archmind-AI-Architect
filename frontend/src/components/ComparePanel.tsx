"use client";

import { GitCompare, Minus, Pencil, Plus, X } from "lucide-react";
import type { CompareResult, DiffStatus } from "@/lib/types";
import { EmptyState, IconButton } from "./ui";

interface Props {
  result: CompareResult;
  onExit: () => void;
}

const STATUS_STYLE: Record<DiffStatus, string> = {
  added: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  removed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  changed: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

// A colored left border + icon per row, like a git diff, so the eye can
// scan added/removed/changed at a glance instead of reading every badge.
const STATUS_BORDER: Record<DiffStatus, string> = {
  added: "border-l-green-500",
  removed: "border-l-red-400",
  changed: "border-l-amber-500",
};

const STATUS_ICON: Record<DiffStatus, typeof Plus> = {
  added: Plus,
  removed: Minus,
  changed: Pencil,
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
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:text-brand-300">
            <GitCompare size={15} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Compare</h1>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {rows.length} structural difference{rows.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <IconButton onClick={onExit}>
          <X size={16} />
        </IconButton>
      </div>

      {explanation.overall_summary && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
          {explanation.overall_summary}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {rows.length === 0 && <EmptyState icon={<GitCompare size={22} />} title="No structural differences" description="These two versions produce the same architecture." />}
        {rows.map((row) => {
          const StatusIcon = STATUS_ICON[row.status];
          return (
            <div
              key={row.ref}
              className={`rounded-xl border-l-4 bg-surface px-3.5 py-2.5 shadow-soft transition-shadow hover:shadow-raised dark:bg-slate-800/50 ${STATUS_BORDER[row.status]}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[row.status]}`}>
                  <StatusIcon size={9} strokeWidth={3} />
                  {row.status}
                </span>
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{row.label}</span>
              </div>
              {explanationByRef.has(row.ref) && (
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{explanationByRef.get(row.ref)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
