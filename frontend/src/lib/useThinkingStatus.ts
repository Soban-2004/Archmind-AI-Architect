import { useEffect, useRef, useState } from "react";

const PHRASES = [
  "Reading through your requirements…",
  "Weighing which components this actually needs…",
  "Checking scale, budget, and availability thresholds…",
  "Drafting the architecture…",
  "Double-checking edge directions…",
  "Putting the finishing touches on it…",
];

export interface ThinkingStatus {
  phrase: string;
  elapsedMs: number;
}

/**
 * Cosmetic "what's happening" status for a chat turn that can genuinely
 * take anywhere from a couple seconds to a couple minutes — a single Groq
 * structured-output call, sometimes two back to back if the first response
 * fails schema validation and gets retried (see groq_provider.py's
 * RETRY_SUFFIX path), and larger for a request with more constraints to
 * reason about (redundancy, replicas, observability, etc). There's no real
 * backend progress channel to report here — the LLM call is one blocking
 * request, not a token stream (see README) — so this is honestly-generic
 * client-side perceived progress: a rotating status line plus an
 * elapsed-time-based reassurance note for longer waits, rather than
 * fabricating specific steps we can't actually confirm are happening.
 */
export function useThinkingStatus(active: boolean): ThinkingStatus {
  const [index, setIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!active) return; // nothing to animate; any stale values just sit unused until reactivated
    startRef.current = Date.now();
    const phraseTimer = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), 2600);
    const clock = setInterval(() => setElapsedMs(Date.now() - startRef.current), 500);
    // Both intervals' first tick only fires after their own delay — kick
    // index/elapsedMs back to a fresh 0 right away too (still deferred via
    // a timer callback, not the effect body itself) so a new busy period
    // never flashes the previous one's stale phrase/elapsed for a moment.
    const kick = setTimeout(() => {
      setIndex(0);
      setElapsedMs(0);
    }, 0);
    return () => {
      clearInterval(phraseTimer);
      clearInterval(clock);
      clearTimeout(kick);
    };
  }, [active]);

  return { phrase: PHRASES[index], elapsedMs };
}
