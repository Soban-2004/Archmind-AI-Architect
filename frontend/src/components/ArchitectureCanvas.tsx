"use client";

import { useMemo, useState } from "react";
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, type EdgeTypes, type Node, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import { applySimulation } from "@/lib/simView";
import type { ArchitectureState, ArchNode, SimulationResult, VersionDiff } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";
import { FlowEdge } from "./FlowEdge";
import { NodeDetailCard } from "./NodeDetailCard";
import { EmptyState } from "./ui";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

const MINIMAP_KIND_COLOR: Record<string, string> = {
  service: "#3b82f6",
  database: "#10b981",
  queue: "#a855f7",
  external_dependency: "#f97316",
  infra_node: "#64748b",
};

interface Props {
  state: ArchitectureState | null;
  layout: LayoutMap;
  diff?: VersionDiff | null;
  simulation?: SimulationResult | null;
}

export function ArchitectureCanvas({ state, layout, diff, simulation }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!state) return { nodes: [], edges: [] };
    const base = toFlowElements(state, layout, diff);
    return simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
  }, [state, layout, diff, simulation]);

  const selectedNode = selectedNodeId ? (state?.nodes.find((n) => n.id === selectedNodeId) ?? null) : null;
  const selectedLoad = selectedNodeId ? simulation?.loads.find((l) => l.node_id === selectedNodeId) : undefined;
  const selectedFinding = selectedNodeId ? simulation?.findings.find((f) => f.node_id === selectedNodeId) : undefined;

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
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--rf-dot-color)" />
        <Controls showInteractive={false} />
        {nodes.length > 5 && (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            bgColor="transparent"
            maskColor="rgba(100,116,139,0.08)"
            nodeColor={(n: Node) => {
              const archNode = (n.data as { archNode?: ArchNode })?.archNode;
              return (archNode && MINIMAP_KIND_COLOR[archNode.node_kind]) || "#94a3b8";
            }}
          />
        )}
      </ReactFlow>
      {selectedNode && (
        <NodeDetailCard node={selectedNode} load={selectedLoad} finding={selectedFinding} onClose={() => setSelectedNodeId(null)} />
      )}
    </div>
  );
}
