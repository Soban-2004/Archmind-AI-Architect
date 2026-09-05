"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { VersionSummary } from "@/lib/types";

interface Props {
  projectId: string;
  activeVersionId: string | null;
  refreshKey: number;
  onSelect: (versionId: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  initial: "Initial",
  edit: "Edit",
  tier: "Tier",
  reconstruction: "Reconstructed",
};

export function VersionHistory({ projectId, activeVersionId, refreshKey, onSelect }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);

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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-3 py-3">
        <h2 className="text-xs font-semibold text-slate-500 tracking-wide">VERSION HISTORY</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">No versions yet.</p>}
        {versions.map((v, i) => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`block w-full text-left px-3 py-2 text-xs border-b border-slate-100 hover:bg-slate-50 ${
              v.id === activeVersionId ? "bg-blue-50 border-l-2 border-l-blue-500 pl-[10px]" : ""
            }`}
          >
            <div className="font-medium text-slate-700">
              v{i + 1} · {KIND_LABEL[v.kind] ?? v.kind}
            </div>
            <div className="text-slate-400">{new Date(v.created_at).toLocaleTimeString()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
