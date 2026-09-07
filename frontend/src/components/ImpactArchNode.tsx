"use client";

import { useEffect, useRef } from "react";
import type { NodeProps } from "@xyflow/react";
import { ArchNodeCard } from "./ArchNodeCard";

// The exact same ok/warning/overloaded palette lib/simView.ts's own
// simEdgeStyle() uses for the edge itself — reused, not reinvented, so a
// node's impact flash always matches the color of the edge that just fed
// it, not a separately-chosen accent.
const STATUS_COLOR: Record<string, string> = {
  ok: "#16a34a",
  warning: "#d97706",
  overloaded: "#dc2626",
};

const PUNCH_KEYFRAMES: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.03)", offset: 0.5 }, { transform: "scale(1)" }];
const PUNCH_DURATION_MS = 150;

const FLASH_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(-50%) scale(0.3)" },
  { opacity: 0.9, transform: "translateY(-50%) scale(1)", offset: 0.35 },
  { opacity: 0, transform: "translateY(-50%) scale(1.6)" },
];
const FLASH_DURATION_MS = 130;

// Only overloaded nodes get this, layered on top of the same punch —
// small enough that it never reads as the node changing position, just
// visibly unsteady the instant a request lands.
const SHAKE_KEYFRAMES: Keyframe[] = [
  { transform: "translate(0px, 0px)" },
  { transform: "translate(-2px, 1px)" },
  { transform: "translate(2px, -1px)" },
  { transform: "translate(-1.5px, -1px)" },
  { transform: "translate(1.5px, 1px)" },
  { transform: "translate(-1px, 0px)" },
  { transform: "translate(0px, 0px)" },
];
const SHAKE_DURATION_MS = 350;

/**
 * Wraps the real ArchNodeCard — rendered exactly as-is, nothing about it
 * changed — with a discrete, event-driven "impact" reaction fired once
 * per real particle arrival, not a looping/ambient pulse. This replaces
 * the earlier CSS-keyframe-loop approach entirely: a CSS `animation` can
 * only repeat at one fixed rhythm, it can't fire N independent one-shot
 * reactions for N particles that happen to land close together. The Web
 * Animations API (`el.animate(...)`) does exactly that — every call
 * starts its own independent, self-cleaning Animation instance, so
 * overlapping arrivals (a busy edge with several particles in flight)
 * each get their own distinct flash instead of competing for one shared
 * animation slot.
 *
 * Timing comes from `data.arrivalSpeed`/`arrivalCount` (see
 * withArrivalData in MiniArchitecturePreview.tsx), the exact same
 * speed/count FlowEdge.tsx's own <animateMotion> uses for the incoming
 * edge's particles — a new particle actually reaches its target every
 * `speed / count` seconds (count particles evenly spaced across one
 * `speed`-second lap), so that's the real interval fired on here, not an
 * approximation.
 *
 * The punch/shake animate a wrapper div THIS component renders around
 * ArchNodeCard — never ArchNodeCard's own root, and never box-shadow.
 * React Flow positions the next ancestor up (`.react-flow__node`) with
 * its own inline `transform: translate(...)`; animating `transform` on
 * this wrapper, one level below that, never touches or fights it. The
 * flash is a separate small absolutely-positioned dot at the node's
 * left-center — an approximation of "the incoming connection point" (the
 * real per-edge floating intersection point lives in floatingEdge.ts,
 * computed per-edge at render time; every diagram here flows strictly
 * left-to-right, so left-center is that point for every real arrival).
 */
export function ImpactArchNode(props: NodeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const data = props.data as { arrivalSpeed?: number; arrivalCount?: number; simStatus?: string } | undefined;
  const speed = data?.arrivalSpeed;
  const count = data?.arrivalCount ?? 1;
  const status = data?.simStatus;
  const color = status ? STATUS_COLOR[status] : undefined;

  useEffect(() => {
    if (!speed || !color) return;

    function fire() {
      wrapperRef.current?.animate(PUNCH_KEYFRAMES, { duration: PUNCH_DURATION_MS, easing: "ease-out" });
      flashRef.current?.animate(FLASH_KEYFRAMES, { duration: FLASH_DURATION_MS, easing: "ease-out" });
      if (status === "overloaded") {
        wrapperRef.current?.animate(SHAKE_KEYFRAMES, { duration: SHAKE_DURATION_MS, easing: "ease-in-out" });
      }
    }

    const periodMs = Math.max(60, (speed / count) * 1000);
    const id = window.setInterval(fire, periodMs);
    return () => window.clearInterval(id);
  }, [speed, count, status, color]);

  return (
    <div ref={wrapperRef} className="relative">
      <ArchNodeCard {...props} />
      {color && (
        <div
          ref={flashRef}
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{ left: -6, top: "50%", width: 16, height: 16, marginTop: -8, background: color, opacity: 0 }}
        />
      )}
    </div>
  );
}
