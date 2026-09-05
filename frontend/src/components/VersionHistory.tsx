"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { VersionSummary } from "@/lib/types";

interface Props {
  projectId: string;
  activeVersionId: string | null;
  refreshKey: number;
  onSelect: (versionId: string) => void;
  onCompare: (versionAId: string, versionBId: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  initial: "Initial",
  edit: "Edit",
  tier: "Tier",
  reconstruction: "Reconstructed",
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
      if (prev.length >= 2) return [prev[1], id]; // keep the most recent two picks
      return [...prev, id];
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-3 py-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-500 tracking-wide">VERSION HISTORY</h2>
        <button
          onClick={toggleCompareMode}
          className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${
            compareMode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          COMPARE
        </button>
      </div>

      {compareMode && (
        <div className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-500">
          Pick two versions to compare.
          {selected.length === 2 && (
            <button
              className="mt-1 block w-full rounded bg-blue-600 text-white text-xs font-medium py-1"
              onClick={() => onCompare(selected[0], selected[1])}
            >
              Compare selected
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No versions yet.</p>}
        {versions.map((v, i) => {
          const isSelected = selected.includes(v.id);
          return (
            <button
              key={v.id}
              onClick={() => (compareMode ? toggleSelected(v.id) : onSelect(v.id))}
              className={`block w-full text-left px-3 py-2 text-xs border-b border-slate-100 hover:bg-slate-50 ${
                !compareMode && v.id === activeVersionId ? "bg-blue-50 border-l-2 border-l-blue-500 pl-[10px]" : ""
              } ${compareMode && isSelected ? "bg-blue-50 border-l-2 border-l-blue-500 pl-[10px]" : ""}`}
            >
              <div className="font-medium text-slate-700">
                {compareMode && <input type="checkbox" checked={isSelected} readOnly className="mr-1.5 align-middle" />}
                v{i + 1} · {KIND_LABEL[v.kind] ?? v.kind}
                {v.label ? ` · ${v.label}` : ""}
              </div>
              <div className="text-slate-400">{new Date(v.created_at).toLocaleTimeString()}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
