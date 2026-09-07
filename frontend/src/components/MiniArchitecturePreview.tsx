"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type EdgeTypes, type NodeTypes } from "@xyflow/react";
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
 */
export function MiniArchitecturePreview({ state, layout, simulation, height = 260 }: Props) {
  const base = toFlowElements(state, layout);
  const { nodes, edges } = simulation ? applySimulation(base.nodes, base.edges, simulation) : base;

  return (
    <ReactFlowProvider>
      <div style={{ height }} className="relative w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
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
