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
      role="status"
      className={`animate-fade-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 ${
        fullscreen ? "" : "bg-white/70 backdrop-blur-[2px] dark:bg-slate-950/60"
      }`}
    >
      <div aria-hidden="true" className="relative flex h-20 w-32 items-center justify-center overflow-hidden rounded-xl border border-brand-200 bg-surface">
        <div className="absolute left-4 right-4 top-5 h-px bg-brand-200" />
        <div className="absolute left-4 right-4 bottom-5 h-px bg-brand-200" />
        <div className="absolute inset-y-5 left-8 w-px bg-brand-200" />
        <div className="absolute inset-y-5 right-8 w-px bg-brand-200" />
        <div className="studio-scan absolute inset-0 bg-gradient-to-r from-transparent via-brand-400/20 to-transparent" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"><Sparkles size={17} /></div>
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
