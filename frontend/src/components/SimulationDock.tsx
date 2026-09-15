import { Pause, Play, Skull, Square, Zap } from "lucide-react";
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

  return (
    // `inset-x-0` spans the full canvas width so the bar can be centered —
    // but that means the wrapper's empty left/right edges sat directly on
    // top of React Flow's own zoom Controls (bottom-left) and MiniMap
    // (bottom-right), silently eating their clicks even though nothing was
    // visibly there. pointer-events-none on the (invisible) full-width
    // wrapper + pointer-events-auto on just the actual visible bar is the
    // fix — same trick any full-width absolutely-positioned overlay with
    // centered content needs.
    <div className="animate-fade-in pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-surface/95 px-3 py-2 shadow-raised backdrop-blur dark:bg-slate-900/95">
        <div className="flex items-center gap-1 pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <Zap size={11} />
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {MULTIPLIER_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => onMultiplierChange(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                multiplier === m
                  ? "bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {m}×
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          onClick={onPlayPause}
          disabled={running}
          title={result ? (playing ? "Pause" : "Play") : "Run simulation"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm shadow-brand-600/30 transition duration-150 hover:bg-brand-700 active:scale-95 disabled:opacity-60 disabled:active:scale-100"
        >
          {running ? <Spinner className="h-4 w-4" /> : playing && result ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>

        {result && (
          <>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />
            <div className="flex items-center gap-1.5">
              {overloadedCount > 0 && <Badge tone="red">{overloadedCount} overloaded</Badge>}
              {killIds.length > 0 && (
                <Badge tone="slate" className="flex items-center gap-1">
                  <Skull size={9} /> {killIds.length} killed
                </Badge>
              )}
              {overloadedCount === 0 && killIds.length === 0 && <Badge tone="green">healthy</Badge>}
            </div>
            <button
              onClick={onStop}
              title="Stop simulation"
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:scale-90 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <Square size={12} fill="currentColor" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
