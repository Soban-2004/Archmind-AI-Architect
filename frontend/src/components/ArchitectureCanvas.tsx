"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import type { ArchitectureState, VersionDiff } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard };

interface Props {
  state: ArchitectureState | null;
  layout: LayoutMap;
  diff?: VersionDiff | null;
}

export function ArchitectureCanvas({ state, layout, diff }: Props) {
  const { nodes, edges } = useMemo(
    () => (state ? toFlowElements(state, layout, diff) : { nodes: [], edges: [] }),
    [state, layout, diff]
  );

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
