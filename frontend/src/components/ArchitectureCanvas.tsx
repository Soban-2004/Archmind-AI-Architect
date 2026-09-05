"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutState } from "@/lib/layout";
import type { ArchitectureState } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard };

export function ArchitectureCanvas({ state }: { state: ArchitectureState | null }) {
  const { nodes, edges } = useMemo(() => (state ? layoutState(state) : { nodes: [], edges: [] }), [state]);

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
