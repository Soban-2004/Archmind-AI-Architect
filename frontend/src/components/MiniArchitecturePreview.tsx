"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type Edge, type EdgeTypes, type Node, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toFlowElements } from "@/lib/diffView";
import { applySimulation, TRAFFIC_SOURCE_ID } from "@/lib/simView";
import type { ArchitectureState, SimulationResult } from "@/lib/types";
import { NODE_HEIGHT, NODE_WIDTH, TRAFFIC_SOURCE_HEIGHT, TRAFFIC_SOURCE_WIDTH, type LayoutMap } from "@/lib/layout";
import { FlowEdge } from "./FlowEdge";
import { ImpactArchNode } from "./ImpactArchNode";
import { TrafficSourceNode } from "./TrafficSourceNode";

const nodeTypes: NodeTypes = { archNode: ImpactArchNode, trafficSource: TrafficSourceNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

const PADDING = 24; // px of breathing room around the diagram on every side
const DEFAULT_MAX_ZOOM = 1; // never render a node bigger than its real on-canvas size, by default
const MIN_ZOOM = 0.32;
const REVEAL_ROW_STEP_MS = 140; // gap between one row's reveal and the next
const REVEAL_EDGE_EXTRA_MS = 90; // an edge reveals slightly after its later endpoint, not simultaneously

function nodeSize(n: Node): { width: number; height: number } {
  return n.type === "trafficSource" ? { width: TRAFFIC_SOURCE_WIDTH, height: TRAFFIC_SOURCE_HEIGHT } : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

// Two independent style layers (arrival glow, stagger reveal) can both
// want to animate the same node — CSS supports that natively via a
// comma-separated `animation` list, each entry animating its own
// property (filter vs. opacity here) with its own timing, so they never
// actually fight each other. This just appends rather than overwriting.
function combineAnimation(existing: unknown, addition: string): string {
  return typeof existing === "string" && existing.length > 0 ? `${existing}, ${addition}` : addition;
}

/**
 * Annotates each node with how often traffic actually arrives at it —
 * `arrivalSpeed`/`arrivalCount`, straight from its fastest incoming
 * flowing edge's own real FlowEdge.tsx particle config (see simView.ts's
 * intensityFor) — so ImpactArchNode can fire its own discrete, one-shot
 * "impact" reaction (a real per-arrival event via the Web Animations API,
 * not a looping CSS animation — see that component for why) on the exact
 * same cadence particles really arrive: a new one reaches its target
 * every `arrivalSpeed / arrivalCount` seconds, count particles evenly
 * spaced across one `arrivalSpeed`-second lap. Pure data, no style
 * mutation — ImpactArchNode owns the actual animation, not this pipeline.
 */
function withArrivalData(nodes: Node[], edges: Edge[]) {
  const incoming = new Map<string, { speed: number; count: number }>();
  for (const e of edges) {
    const data = e.data as { flowing?: boolean; flowSpeed?: number; flowCount?: number } | undefined;
    if (!data?.flowing) continue;
    const speed = data.flowSpeed ?? 1.2;
    const count = data.flowCount ?? 1;
    const current = incoming.get(e.target);
    if (current === undefined || speed < current.speed) incoming.set(e.target, { speed, count });
  }

  return nodes.map((n) => {
    const arrival = incoming.get(n.id);
    if (!arrival) return n;
    return { ...n, data: { ...n.data, arrivalSpeed: arrival.speed, arrivalCount: arrival.count } };
  });
}

/**
 * Fades nodes in row by row (grouped by their real Y position — rows in
 * every current fixture share an exact Y, so no fuzzy-matching needed),
 * each edge following just after whichever of its two endpoints reveals
 * later. Opacity only — see globals.css's node-in keyframe comment for
 * why it can't also animate `transform` without fighting React Flow's own
 * positioning transform on the same element. Applied via inline
 * `style`/`animationDelay`, the same mechanism `edgeStyle`/`simEdgeStyle`
 * already use to set stroke color inline — nothing here needs a CSS class.
 */
function withStaggerReveal(nodes: Node[], edges: Edge[]) {
  const rowYs = Array.from(new Set(nodes.map((n) => Math.round(n.position.y)))).sort((a, b) => a - b);
  const rowIndex = new Map(rowYs.map((y, i) => [y, i]));
  const delayForY = (y: number) => (rowIndex.get(Math.round(y)) ?? 0) * REVEAL_ROW_STEP_MS;

  const revealedNodes = nodes.map((n) => ({
    ...n,
    style: {
      ...n.style,
      opacity: 0,
      animation: combineAnimation(n.style?.animation, "node-in 0.5s ease-out both"),
      animationDelay: `${delayForY(n.position.y)}ms`,
    },
  }));

  const delayByNodeId = new Map(nodes.map((n) => [n.id, delayForY(n.position.y)]));
  const revealedEdges = edges.map((e) => {
    const delay = Math.max(delayByNodeId.get(e.source) ?? 0, delayByNodeId.get(e.target) ?? 0) + REVEAL_EDGE_EXTRA_MS;
    return {
      ...e,
      style: { ...e.style, opacity: 0, animation: combineAnimation(e.style?.animation, "node-in 0.4s ease-out both"), animationDelay: `${delay}ms` },
    };
  });

  return { nodes: revealedNodes, edges: revealedEdges };
}

/**
 * Bounds computed from KNOWN, constant per-node-type sizes — the same
 * NODE_WIDTH/NODE_HEIGHT lib/layout.ts's own dagre layout already assumes
 * — not React Flow's async per-node DOM measurement. That measurement
 * only resolves after each custom node's first render, and gets thrown
 * away by ANY re-render that hands React Flow a fresh (non-reference-
 * equal) `nodes` array — which sank the two previous attempts at this: a
 * bad first paint had nothing to self-correct it, because "self-correct"
 * itself depended on the same measurement that kept getting reset. A
 * locked preview (no pan/zoom for a visitor to fix it by hand) can't
 * afford that dependency at all — the very first paint has to already be
 * right, deterministically, every time.
 */
function computeBounds(nodes: Node[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { width, height } = nodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + width);
    maxY = Math.max(maxY, n.position.y + height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface Props {
  state: ArchitectureState;
  layout: LayoutMap;
  simulation?: SimulationResult | null;
  /** Raise past 1 to let a diagram with a lot of room to spare (the hero,
   * unframed and given most of a wide column) render larger than the
   * product's own real 1:1 node size — everything here is vector/CSS, not
   * a raster screenshot, so it stays perfectly crisp scaled up. */
  maxZoom?: number;
  /** Reveals rows one after another instead of the whole diagram fading
   * in as a single block — see withStaggerReveal above. Opt-in (default
   * off) since the boxed scenario diagrams further down the page read
   * fine appearing all at once; it's the hero's entrance that benefits
   * from a real sequence. */
  staggerReveal?: boolean;
  /** Overrides where the synthetic "Users" node lands. simView.ts's own
   * applySimulation always places it to the LEFT of the entry nodes'
   * average position (sourceX = min(entryX) - 190) — correct for the
   * real app's left-to-right canvases, but wrong for a top-down branching
   * layout: left of two side-by-side entry nodes routes its edge to the
   * *further* one straight across the *nearer* one, which is genuinely
   * what was producing the crossing lines reported here, not the edge
   * routing itself. Left undefined, the default (left-of-entry) applies. */
  trafficSourcePosition?: { x: number; y: number };
}

/**
 * The landing page's diagrams are not a separate illustration of the
 * product — they ARE the product's own canvas. Same edgeTypes (FlowEdge),
 * same toFlowElements/applySimulation pipeline ArchitectureCanvas.tsx uses
 * on real projects, just fed fixed fixture data (lib/landingScenarios.ts)
 * instead of a live version, and locked down so a visitor can't pan/zoom/
 * drag it. Nodes render through ImpactArchNode, a thin landing-only
 * wrapper that renders the real ArchNodeCard unchanged and adds the
 * per-arrival impact reaction around it — see that component.
 *
 * Deliberately does NOT use React Flow's own `fitView` — every attempt to
 * squeeze these into a small fixed-height box and auto-fit into it kept
 * losing a node off the edge (see computeBounds' comment for why). Instead
 * this computes its own {x, y, zoom} directly from the diagram's real
 * content size and renders it as a *controlled* viewport, so the frame's
 * own height is whatever the content actually needs at a real, legible
 * scale (capped at its true 1:1 size, never blown up) — the diagram shows
 * at its natural size instead of being cropped into an arbitrary box.
 */
export function MiniArchitecturePreview({
  state,
  layout,
  simulation,
  maxZoom = DEFAULT_MAX_ZOOM,
  staggerReveal = false,
  trafficSourcePosition,
}: Props) {
  const { nodes, edges } = useMemo(() => {
    const base = toFlowElements(state, layout);
    const withSim = simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
    const positioned = trafficSourcePosition
      ? {
          ...withSim,
          nodes: withSim.nodes.map((n) => (n.id === TRAFFIC_SOURCE_ID ? { ...n, position: trafficSourcePosition } : n)),
        }
      : withSim;
    // Arrival data applies whenever there's a real simulation to react to
    // (not opt-in like staggerReveal) — "traffic landing on a node" is
    // part of what "live traffic simulation" already means on every one
    // of these diagrams, not a hero-only flourish.
    const withArrivals = simulation ? { ...positioned, nodes: withArrivalData(positioned.nodes, positioned.edges) } : positioned;
    return staggerReveal ? withStaggerReveal(withArrivals.nodes, withArrivals.edges) : withArrivals;
  }, [state, layout, simulation, staggerReveal, trafficSourcePosition]);

  const bounds = useMemo(() => computeBounds(nodes), [nodes]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Before the very first ResizeObserver callback, width is still 0 —
  // fall back to a plausible guess (the diagram's own content width, so
  // zoom starts at 1) rather than a divide-by-zero or a collapsed box.
  const effectiveWidth = width || bounds.width + PADDING * 2;
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, (effectiveWidth - PADDING * 2) / bounds.width));
  const height = Math.round(bounds.height * zoom + PADDING * 2);
  const viewport = { x: PADDING - bounds.x * zoom, y: PADDING - bounds.y * zoom, zoom };

  return (
    <ReactFlowProvider>
      <div ref={wrapperRef} style={{ height }} className="relative w-full min-w-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          viewport={viewport}
          onViewportChange={() => {}}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--rf-dot-color)" />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
