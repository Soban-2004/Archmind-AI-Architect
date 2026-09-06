"use client";

import { useState } from "react";
import { Activity, Skull, Wrench, X, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { ArchitectureState, LoadStatus, SimulationResult } from "@/lib/types";
import { Button, IconButton, Spinner } from "./ui";

interface Props {
  projectId: string;
  versionId: string;
  state: ArchitectureState;
  result: SimulationResult | null;
  onResult: (result: SimulationResult | null) => void;
  onExit: () => void;
  /** Hands a short, structured summary of the current overload findings to
   * the chat's architect agent and switches to it — the agent (not this
   * panel, and not advice typed outside the app) is what should actually
   * propose and apply a fix. Kept deliberately compact (node/rps/capacity
   * only, not the full finding prose) so this alone can't be what pushes a
   * long-running project over the LLM provider's per-request token limit. */
  onFixInChat: (message: string) => void;
}

/** Builds the message sent to chat from real numbers already in `result` —
 * never hand-authored per click — so the architect agent reasons from the
 * same facts shown on screen. */
function buildFixRequest(result: SimulationResult): string {
  const overloaded = result.loads.filter((l) => l.status === "overloaded" || l.status === "warning");
  const lines = overloaded.map((l) => `- ${l.node_name}: ${l.incoming_rps}/${l.capacity_rps} rps (${l.utilization_pct.toFixed(0)}%, ${l.status})`);
  return `Simulation at ${result.scenario} shows these components under strain:\n${lines.join("\n")}\n\nPropose an edit to address this within the project's existing constraints.`;
}

const MULTIPLIER_PRESETS = [1, 10, 50, 100];

export function SimulationPanel({ projectId, versionId, state, result, onResult, onExit, onFixInChat }: Props) {
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
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600 dark:text-indigo-300">
            <Activity size={15} />
          </div>
          <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Simulate Traffic</h1>
        </div>
        <IconButton onClick={onExit}>
          <X size={16} />
        </IconButton>
      </div>
      <p className="px-4 pt-2.5 text-[11px] leading-snug text-slate-400 italic dark:text-slate-500">
        Heuristic capacity model based on declared per-component assumptions — not a real load test.
      </p>

      <div className="space-y-3.5 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Zap size={12} /> Traffic multiplier
          </p>
          <div className="flex gap-1.5">
            {MULTIPLIER_PRESETS.map((m) => (
              <button
                key={m}
                onClick={() => setMultiplier(m)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  multiplier === m
                    ? "bg-brand-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {m}×
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Skull size={12} /> Kill a component
          </p>
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800/50">
            {state.nodes.map((n) => (
              <label key={n.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={killIds.includes(n.id)}
                  onChange={() => toggleKill(n.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
                />
                {n.name}
              </label>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={handleRun} disabled={running}>
          {running ? (
            <>
              <Spinner className="h-3.5 w-3.5" /> Simulating…
            </>
          ) : (
            "Run Simulation"
          )}
        </Button>
        {error && <p className="text-xs text-red-600 dark:text-red-400">⚠️ {error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!result && <p className="text-xs text-slate-400 dark:text-slate-500">Run a scenario to see projected load per component.</p>}
        {result && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs italic text-slate-500 dark:text-slate-400">Scenario: {result.scenario}</p>
              <button onClick={() => onResult(null)} className="text-[10px] text-slate-400 underline dark:text-slate-500">
                clear
              </button>
            </div>
            {result.findings.length === 0 ? (
              <p className="mt-2 text-xs font-medium text-green-600 dark:text-green-400">No bottlenecks under this scenario.</p>
            ) : (
              <>
                <div className="mt-2 space-y-1.5">
                  {result.findings.map((f) => (
                    <div key={`${f.order}-${f.node_id}`} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 dark:border-red-500/20 dark:bg-red-500/10">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                        #{f.order} {f.node_name}
                      </p>
                      <p className="text-[11px] leading-snug text-red-600 dark:text-red-400/80">{f.message}</p>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => onFixInChat(buildFixRequest(result))}>
                  <Wrench size={13} /> Ask the architect to fix this
                </Button>
              </>
            )}
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              {result.loads.map((l) => (
                <div key={l.node_id} className="text-xs">
                  <div className="mb-1 flex justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{l.node_name}</span>
                    <span className={statusColor(l.status)}>{l.status === "killed" ? "killed" : `${l.utilization_pct.toFixed(0)}%`}</span>
                  </div>
                  {l.status !== "killed" && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={`h-full rounded-full transition-all ${barColor(l.status)}`} style={{ width: `${Math.min(100, l.utilization_pct)}%` }} />
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
  if (status === "overloaded") return "font-semibold text-red-600 dark:text-red-400";
  if (status === "warning") return "font-semibold text-amber-600 dark:text-amber-400";
  if (status === "killed") return "text-slate-400 dark:text-slate-500";
  return "text-green-600 dark:text-green-400";
}

function barColor(status: LoadStatus): string {
  if (status === "overloaded") return "bg-red-600";
  if (status === "warning") return "bg-amber-500";
  return "bg-green-500";
}
