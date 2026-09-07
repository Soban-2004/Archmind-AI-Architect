"use client";

import { useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
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
 * The landing page's diagrams are not a separate illustration of the
 * product — they ARE the product's own canvas. Same nodeTypes/edgeTypes
 * (ArchNodeCard, FlowEdge, TrafficSourceNode), same toFlowElements /
 * applySimulation pipeline ArchitectureCanvas.tsx uses on real projects,
 * just fed fixed fixture data (lib/landingScenarios.ts) instead of a live
 * version, and locked down so a visitor can't pan/zoom/drag it — a static
 * figure that happens to be rendered by the real, live component tree, SVG
 * <animateMotion> traffic particles included.
 *
 * A plain `fitView` prop only fits once, at the instant React Flow first
 * measures its container. Inside a small CSS grid card whose track width
 * isn't settled until the grid/webfont layout finishes, that first
 * measurement can land on the wrong (sometimes near-zero) size and the
 * diagram renders badly scaled — and unlike the real interactive canvas,
 * there's no pan/zoom here for a visitor to correct it by hand, so a bad
 * first fit just stays broken. A ResizeObserver on the wrapper re-runs
 * fitView every time the container's real size changes, so the diagram
 * always ends up correctly framed and fully visible regardless of when
 * that settling happens.
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
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
