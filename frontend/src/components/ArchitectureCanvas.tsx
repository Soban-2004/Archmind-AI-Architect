"use client";

import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import { applySimulation } from "@/lib/simView";
import type { ArchitectureState, SimulationResult, VersionDiff } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";
import { EmptyState } from "./ui";

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
      <EmptyState
        icon={<Network size={22} />}
        title="No architecture yet"
        description="Answer a few questions in the chat to generate one."
      />
    );
  }

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cbd5e1" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
