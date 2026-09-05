"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ArchitectureState, LoadStatus, SimulationResult } from "@/lib/types";

interface Props {
  projectId: string;
  versionId: string;
  state: ArchitectureState;
  result: SimulationResult | null;
  onResult: (result: SimulationResult | null) => void;
  onExit: () => void;
}

const MULTIPLIER_PRESETS = [1, 10, 50, 100];

export function SimulationPanel({ projectId, versionId, state, result, onResult, onExit }: Props) {
  const [multiplier, setMultiplier] = useState(1);
  const [killIds, setKillIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleKill(id: string) {
    setKillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const r = await api.simulate(projectId, versionId, multiplier, killIds);
      onResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-sm font-semibold text-slate-800">Simulate Traffic</h1>
        <button onClick={onExit} className="text-xs text-blue-600 underline">
          Close
        </button>
      </div>
      <p className="px-4 pt-2 text-[11px] text-slate-400 italic">
        Heuristic capacity model based on declared per-component assumptions — not a real load test.
      </p>

      <div className="px-4 py-3 border-b border-slate-100 space-y-3">
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Traffic multiplier</p>
          <div className="flex gap-1.5">
            {MULTIPLIER_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMultiplier(m)}
                className={`text-xs rounded px-2 py-1 font-medium ${
                  multiplier === m ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {m}x
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">Kill a component (failure scenario)</p>
          <div className="max-h-28 overflow-y-auto space-y-1">
            {state.nodes.map((n) => (
              <label key={n.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={killIds.includes(n.id)} onChange={() => toggleKill(n.id)} />
                {n.name}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={handleRun}
          disabled={running}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {running ? "Simulating…" : "Run Simulation"}
        </button>
        {error && <p className="text-xs text-red-600">⚠️ {error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {!result && <p className="text-xs text-slate-400">Run a scenario to see projected load per component.</p>}
        {result && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 italic">Scenario: {result.scenario}</p>
              <button onClick={() => onResult(null)} className="text-[10px] text-slate-400 underline">
                clear
              </button>
            </div>
            {result.findings.length === 0 ? (
              <p className="text-xs text-green-600 font-medium">No bottlenecks under this scenario.</p>
            ) : (
              <div className="space-y-1.5">
                {result.findings.map((f) => (
                  <div key={`${f.order}-${f.node_id}`} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
                    <p className="text-xs font-semibold text-red-700">
                      #{f.order} {f.node_name}
                    </p>
                    <p className="text-xs text-red-600">{f.message}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 border-t border-slate-100 mt-2 space-y-1.5">
              {result.loads.map((l) => (
                <div key={l.node_id} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">{l.node_name}</span>
                    <span className={statusColor(l.status)}>
                      {l.status === "killed" ? "killed" : `${l.utilization_pct.toFixed(0)}%`}
                    </span>
                  </div>
                  {l.status !== "killed" && (
                    <div className="h-1.5 w-full rounded bg-slate-100 overflow-hidden">
                      <div className={`h-full ${barColor(l.status)}`} style={{ width: `${Math.min(100, l.utilization_pct)}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function statusColor(status: LoadStatus): string {
  if (status === "overloaded") return "text-red-600 font-semibold";
  if (status === "warning") return "text-amber-600 font-semibold";
  if (status === "killed") return "text-slate-400";
  return "text-green-600";
}

function barColor(status: LoadStatus): string {
  if (status === "overloaded") return "bg-red-600";
  if (status === "warning") return "bg-amber-500";
  return "bg-green-500";
}
