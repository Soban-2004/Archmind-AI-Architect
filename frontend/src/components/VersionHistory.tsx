"use client";

import { useEffect, useState } from "react";
import { GitBranch, GitCompare, History, Pencil, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { VersionSummary } from "@/lib/types";
import { Button } from "./ui";

interface Props {
  projectId: string;
  activeVersionId: string | null;
  refreshKey: number;
  onSelect: (versionId: string) => void;
  onCompare: (versionAId: string, versionBId: string) => void;
}

const KIND_META: Record<string, { label: string; icon: typeof Sparkles; dot: string }> = {
  initial: { label: "Initial", icon: Sparkles, dot: "bg-brand-500" },
  edit: { label: "Edit", icon: Pencil, dot: "bg-slate-400 dark:bg-slate-500" },
  tier: { label: "Tier", icon: GitBranch, dot: "bg-purple-500" },
  reconstruction: { label: "Reconstructed", icon: History, dot: "bg-orange-500" },
};

export function VersionHistory({ projectId, activeVersionId, refreshKey, onSelect, onCompare }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listVersions(projectId)
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  function toggleCompareMode() {
    setCompareMode((v) => !v);
    setSelected([]);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">History</h2>
        <Button size="sm" variant={compareMode ? "primary" : "secondary"} onClick={toggleCompareMode}>
          <GitCompare size={12} /> Compare
        </Button>
      </div>

      {compareMode && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
          Pick two versions to compare.
          {selected.length === 2 && (
            <Button size="sm" className="mt-2 w-full" onClick={() => onCompare(selected[0], selected[1])}>
              Compare selected
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {versions.length === 0 && <p className="px-1 py-3 text-xs text-slate-400 dark:text-slate-500">No versions yet.</p>}
        <div className="relative">
          {versions.length > 1 && <div className="absolute top-2 bottom-2 left-[15px] w-px bg-slate-200 dark:bg-slate-700" />}
          {versions.map((v, i) => {
            const meta = KIND_META[v.kind] ?? KIND_META.edit;
            const Icon = meta.icon;
            const isSelected = compareMode ? selected.includes(v.id) : v.id === activeVersionId;
            return (
              <button
                key={v.id}
                onClick={() => (compareMode ? toggleSelected(v.id) : onSelect(v.id))}
                className={`relative mb-0.5 flex w-full items-start gap-2.5 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                  isSelected ? "bg-brand-50 dark:bg-indigo-500/10" : ""
                }`}
              >
                <div
                  className={`z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-white ${
                    isSelected ? meta.dot : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <Icon size={13} />
                </div>
                <div className="min-w-0 pt-1">
                  <div className={`truncate text-xs font-medium ${isSelected ? "text-brand-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-300"}`}>
                    v{i + 1} · {meta.label}
                    {v.label ? ` · ${v.label}` : ""}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">{new Date(v.created_at).toLocaleTimeString()}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
