import { AlertTriangle, Pause, Play, Skull, Square, Zap } from "lucide-react";
import type { SimulationResult } from "@/lib/types";
import { Badge, Spinner } from "./ui";

const MULTIPLIER_PRESETS = [1, 10, 50, 100];

export interface SimDockProps {
  multiplier: number;
  onMultiplierChange: (m: number) => void;
  playing: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  running: boolean;
  killIds: string[];
  onToggleKill: (nodeId: string) => void;
}

interface Props extends SimDockProps {
  result: SimulationResult | null;
}

/**
 * Playback controls for a simulation, living on the canvas itself instead
 * of buried in the sidebar — the traffic multiplier and play/pause belong
 * next to the thing they're animating. Killing a specific component stays
 * a canvas-click interaction (click a node -> Kill/Revive, see
 * NodeDetailCard) rather than a checkbox list here; this dock only shows
 * a live count of what's currently killed, with a one-click way to
 * revive everything via Stop.
 */
export function SimulationDock({ multiplier, onMultiplierChange, playing, onPlayPause, onStop, running, killIds, result }: Props) {
  const overloadedCount = result?.loads.filter((l) => l.status === "overloaded").length ?? 0;
  const warningCount = result?.loads.filter((l) => l.status === "warning").length ?? 0;
  const overloadedIds = new Set(result?.loads.filter((load) => load.status === "overloaded").map((load) => load.node_id) ?? []);
  const firstBottleneck = result?.findings.find((finding) => overloadedIds.has(finding.node_id))?.node_name;

  return (
    // `inset-x-0` spans the full canvas width so the bar can be centered —
    // but that means the wrapper's empty left/right edges sat directly on
    // top of React Flow's own zoom Controls (bottom-left) and MiniMap
    // (bottom-right), silently eating their clicks even though nothing was
    // visibly there. pointer-events-none on the (invisible) full-width
    // wrapper + pointer-events-auto on just the actual visible bar is the
    // fix — same trick any full-width absolutely-positioned overlay with
    // centered content needs.
    <div className="animate-fade-in pointer-events-none absolute inset-x-3 bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl bg-surface px-3 py-2.5 shadow-raised">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          <Zap size={14} className="text-brand-500 dark:text-brand-400" /> Traffic
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-surface-2">
          {MULTIPLIER_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => onMultiplierChange(m)}
              aria-pressed={multiplier === m}
              aria-label={`${m} times baseline traffic`}
              className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                multiplier === m
                  ? "bg-white text-brand-700 shadow-sm dark:bg-surface-3 dark:text-brand-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {m}×
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />

        <button
          onClick={onPlayPause}
          disabled={running}
          title={result ? (playing ? "Pause" : "Play") : "Run simulation"}
          aria-label={result ? (playing ? "Pause traffic animation" : "Play traffic animation") : "Run simulation"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white shadow-soft transition duration-150 hover:brightness-105 active:scale-95 disabled:opacity-60 disabled:active:scale-100 dark:text-white"
        >
          {running ? <Spinner className="h-4 w-4" /> : playing && result ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>

        {result && (
          <>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
            <div className="flex items-center gap-1.5">
              {overloadedCount > 0 && <Badge tone="red">{overloadedCount} overloaded</Badge>}
              {overloadedCount === 0 && warningCount > 0 && <Badge tone="amber">{warningCount} warning</Badge>}
              {firstBottleneck && overloadedCount > 0 && (
                <span className="hidden max-w-44 items-center gap-1 truncate text-xs font-medium text-red-600 lg:flex dark:text-red-400" title={`First bottleneck: ${firstBottleneck}`}>
                  <AlertTriangle size={12} aria-hidden="true" /> First: {firstBottleneck}
                </span>
              )}
              {killIds.length > 0 && (
                <Badge tone="slate" className="flex items-center gap-1">
                  <Skull size={9} /> {killIds.length} killed
                </Badge>
              )}
              {overloadedCount === 0 && warningCount === 0 && killIds.length === 0 && <Badge tone="green">healthy</Badge>}
            </div>
            <button
              onClick={onStop}
              title="Stop simulation"
              aria-label="Reset simulation"
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:scale-90 dark:hover:bg-surface-3 dark:hover:text-slate-300"
            >
              <Square size={12} fill="currentColor" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
