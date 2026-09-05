"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import { applySimulation } from "@/lib/simView";
import type { ArchitectureState, SimulationResult, VersionDiff } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard };

interface Props {
  state: ArchitectureState | null;
  layout: LayoutMap;
  diff?: VersionDiff | null;
  simulation?: SimulationResult | null;
}

export function ArchitectureCanvas({ state, layout, diff, simulation }: Props) {
  const { nodes, edges } = useMemo(() => {
    if (!state) return { nodes: [], edges: [] };
    const base = toFlowElements(state, layout, diff);
    return simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
  }, [state, layout, diff, simulation]);

  if (!state || state.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        No architecture yet — answer a few questions in the chat to generate one.
      </div>
    );
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
      <Background />
      <Controls />
    </ReactFlow>
  );
}
