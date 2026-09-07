"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toFlowElements } from "@/lib/diffView";
import { applySimulation } from "@/lib/simView";
import type { ArchitectureState, SimulationResult } from "@/lib/types";
import type { LayoutMap } from "@/lib/layout";
import { ArchNodeCard } from "./ArchNodeCard";
import { FlowEdge } from "./FlowEdge";
import { TrafficSourceNode } from "./TrafficSourceNode";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard, trafficSource: TrafficSourceNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
const FIT_PADDING = 0.12;

interface Props {
  state: ArchitectureState;
  layout: LayoutMap;
  simulation?: SimulationResult | null;
  height?: number;
}

/**
 * Each custom node (ArchNodeCard etc.) only reports its real measured
 * width/height to React Flow's store after its own first render —
 * `fitView` called from `onInit` can in principle fire before every node
 * has finished that pass. `useNodesInitialized()` flips true only once
 * every node has reported a real size; re-fitting then closes that gap.
 * (With the `useMemo` below keeping node/edge identity stable, this now
 * mostly just runs once right after mount — see the memoization comment
 * further down for what was actually causing nodes to go missing.)
 */
function FitWhenReady({ padding }: { padding: number }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    if (nodesInitialized) fitView({ padding, duration: 0 });
  }, [nodesInitialized, fitView, padding]);
  return null;
}

/**
 * The landing page's diagrams are not a separate illustration of the
 * product — they ARE the product's own canvas. Same nodeTypes/edgeTypes
 * (ArchNodeCard, FlowEdge, TrafficSourceNode), same toFlowElements /
 * applySimulation pipeline ArchitectureCanvas.tsx uses on real projects,
 * just fed fixed fixture data (lib/landingScenarios.ts) instead of a live
 * version, and locked down so a visitor can't pan/zoom/drag it — a static
 * figure that happens to be rendered by the real, live component tree, SVG
 * <animateMotion> traffic particles included.
 *
 * The actual, confirmed cause of nodes getting clipped: `nodes`/`edges`
 * were being rebuilt with `toFlowElements`/`applySimulation` directly in
 * the render body, with no memoization — every render produced brand-new
 * node objects, even when `state`/`layout`/`simulation` hadn't changed.
 * React Flow only keeps a node's already-measured size across a `nodes`
 * prop update when the incoming object is the SAME reference as before
 * (see `adoptUserNodes` in @xyflow/system); a fresh object every render
 * fails that check, so React Flow throws away every node's measured
 * dimensions and starts re-measuring from scratch. On the landing page,
 * the background project-preload effect in page.tsx fires several state
 * updates right after mount — each one re-renders Landing, which was
 * enough to keep resetting mid-measurement and leave some nodes
 * permanently stuck "not yet measured", i.e. invisible. `useMemo` below
 * (the same pattern ArchitectureCanvas.tsx already uses for this exact
 * derivation) keeps the same node/edge objects across re-renders whenever
 * the real inputs haven't changed, so React Flow's measurements survive.
 * FitWhenReady and the ResizeObserver below stay as a second layer of
 * defense for the timing races described above, now that they're no
 * longer fighting a losing battle against constant resets.
 */
export function MiniArchitecturePreview({ state, layout, simulation, height = 240 }: Props) {
  const { nodes, edges } = useMemo(() => {
    const base = toFlowElements(state, layout);
    return simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
  }, [state, layout, simulation]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      instanceRef.current?.fitView({ padding: FIT_PADDING, duration: 0 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <ReactFlowProvider>
      <div ref={wrapperRef} style={{ height }} className="relative w-full min-w-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            instanceRef.current = instance;
            instance.fitView({ padding: FIT_PADDING, duration: 0 });
          }}
          fitView
          fitViewOptions={{ padding: FIT_PADDING }}
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
          <FitWhenReady padding={FIT_PADDING} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
