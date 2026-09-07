"use client";

import { useEffect, useRef } from "react";
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
 * The real bug behind nodes getting cut off on the right: each custom
 * node (ArchNodeCard etc.) only reports its real measured width/height to
 * React Flow's store *after* its own first render — `fitView` called from
 * `onInit` can fire before every node has finished that measurement pass,
 * so it silently fits to whichever nodes happened to be measured yet
 * (usually not the last one or two in the array) and the rest render
 * outside the fitted viewport, clipped by the wrapper's overflow-hidden.
 * `useNodesInitialized()` flips true only once every node has reported a
 * real size — re-fitting then (not just on container resize) is what
 * actually guarantees every node is visible.
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
 * Two independent timing races can make a plain `fitView` prop land wrong,
 * and unlike the real interactive canvas there's no pan/zoom here for a
 * visitor to correct it by hand — so both are covered explicitly:
 *  - the wrapper's own size isn't settled yet (a small CSS grid card
 *    whose track width depends on webfont metrics / grid layout still
 *    resolving) — a ResizeObserver re-fits whenever that size changes;
 *  - the nodes themselves haven't finished their first measurement pass
 *    yet (see FitWhenReady above) — the actual cause of nodes getting
 *    silently clipped off the edge in testing.
 */
export function MiniArchitecturePreview({ state, layout, simulation, height = 240 }: Props) {
  const base = toFlowElements(state, layout);
  const { nodes, edges } = simulation ? applySimulation(base.nodes, base.edges, simulation) : base;

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
