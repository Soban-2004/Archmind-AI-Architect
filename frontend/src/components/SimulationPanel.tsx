"use client";

import { Activity, Skull, Wrench, X } from "lucide-react";
import type { ArchitectureState, LoadStatus, SimulationResult } from "@/lib/types";
import { Button, IconButton, ProgressBar } from "./ui";

interface Props {
  state: ArchitectureState;
  result: SimulationResult | null;
  killIds: string[];
  onToggleKill: (nodeId: string) => void;
  error: string | null;
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

/**
 * The results/report side of simulation — playback controls (traffic
 * multiplier, play/pause, killing a component) live on the canvas itself
 * now (SimulationDock + click-a-node in NodeDetailCard), right next to
 * what they're animating, rather than duplicated here. This panel is
 * purely "read the report": what's under strain, and a currently-killed
 * list you can revive from without leaving the sidebar.
 */
export function SimulationPanel({ state, result, killIds, onToggleKill, error, onExit, onFixInChat }: Props) {
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
        Heuristic capacity model based on declared per-component assumptions — not a real load test. Press ▶
        on the canvas below to run a scenario.
      </p>

      {killIds.length > 0 && (
        <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <Skull size={10} /> Killed
          </p>
          <div className="flex flex-wrap gap-1.5">
            {killIds.map((id) => {
              const node = state.nodes.find((n) => n.id === id);
              return (
                <button
                  key={id}
                  onClick={() => onToggleKill(id)}
                  title="Revive"
                  className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-600 transition hover:bg-red-100 active:scale-95 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                >
                  {node?.name ?? id} ✕
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="px-4 pt-2 text-xs text-red-600 dark:text-red-400">⚠️ {error}</p>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!result && <p className="text-xs text-slate-400 dark:text-slate-500">Run a scenario to see projected load per component.</p>}
        {result && (
          <>
            <p className="text-xs italic text-slate-500 dark:text-slate-400">Scenario: {result.scenario}</p>
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
                  {l.status !== "killed" && <ProgressBar pct={l.utilization_pct} colorClassName={barColor(l.status)} />}
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
