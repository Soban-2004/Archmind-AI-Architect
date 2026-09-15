import { Sparkles } from "lucide-react";
import { useThinkingStatus } from "@/lib/useThinkingStatus";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

interface Props {
  active: boolean;
  /** Full-panel centered mode for "no architecture on screen yet" (first
   * generation) vs. the default dimmed overlay atop an existing diagram
   * (an edit / tier / question turn). */
  fullscreen?: boolean;
}

/**
 * Fills the "2 minutes with nothing happening" gap on a long chat turn
 * (a bigger request — redundancy, replicas, observability — genuinely can
 * take that long; see useThinkingStatus) with a rotating status line, an
 * elapsed timer, and a reassurance note once it's been a while, so the
 * canvas itself stays visibly alive instead of just sitting frozen.
 */
export function CanvasLoadingOverlay({ active, fullscreen = false }: Props) {
  const { phrase, elapsedMs } = useThinkingStatus(active);
  if (!active) return null;

  return (
    <div
      className={`animate-fade-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 ${
        fullscreen ? "" : "bg-white/70 backdrop-blur-[2px] dark:bg-slate-950/60"
      }`}
    >
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="animate-spin-slow absolute inset-0 rounded-full border-2 border-dashed border-brand-300 dark:border-brand-500/40" />
        <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30">
          <Sparkles size={18} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5 px-6 text-center">
        <p key={phrase} className="animate-fade-in text-sm font-medium text-slate-700 dark:text-slate-200">
          {phrase}
        </p>
        {elapsedMs > 4000 && <p className="text-[11px] text-slate-400 dark:text-slate-500">{formatElapsed(elapsedMs)} elapsed</p>}
        {elapsedMs > 20000 && (
          <p className="max-w-[220px] text-[11px] text-slate-400 dark:text-slate-500">
            Detailed requests — redundancy, replicas, observability — can take a minute or two. Still working.
          </p>
        )}
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="animate-sweep h-full w-1/3 rounded-full bg-brand-500 dark:bg-brand-400" />
      </div>
    </div>
  );
}
