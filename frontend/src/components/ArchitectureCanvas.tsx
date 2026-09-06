"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Map, Network } from "lucide-react";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import { applySimulation } from "@/lib/simView";
import type { ArchitectureState, ArchNode, SimulationResult, VersionDiff } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";
import { CanvasLoadingOverlay } from "./CanvasLoadingOverlay";
import { FlowEdge } from "./FlowEdge";
import { NodeDetailCard } from "./NodeDetailCard";
import { TrafficSourceNode } from "./TrafficSourceNode";
import { EmptyState, IconButton } from "./ui";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard, trafficSource: TrafficSourceNode };
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
  /** Called once per drag (on release) with just the node(s) that moved,
   * so the caller can persist positions back onto the active version's
   * layout — letting future incremental edits carry a user's manual
   * arrangement forward instead of resetting it. Omit for a read-only
   * canvas (e.g. the compare view). */
  onNodePositionsChange?: (updates: LayoutMap) => void;
  /** True while a chat turn is in flight — surfaces a loading overlay so a
   * long-running request (production-tier redesigns with redundancy,
   * replicas, and observability can genuinely take a minute or two) never
   * reads as the canvas being frozen or broken. */
  busy?: boolean;
  /** Enables direct editing from the NodeDetailCard (click a node -> edit
   * a field -> save, no chat round-trip). Omit for a read-only canvas
   * (the compare view has no single active version to edit onto). */
  onNodeSave?: (nodeId: string, attributes: Record<string, unknown>) => Promise<void>;
}

export function ArchitectureCanvas({ state, layout, diff, simulation, onNodePositionsChange, busy = false, onNodeSave }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [minimapVisible, setMinimapVisible] = useState(true);
  // A drag needs to move a node the instant the pointer moves, well before
  // any position update could round-trip up to the parent's `layout` state
  // and back down as a prop. So dragged positions live here as a small
  // overlay on top of the prop-derived layout, applied live by
  // onNodesChange (a real event handler, not an effect) and left in place
  // even after the drag is persisted upward — by then the parent's layout
  // carries the same coordinates anyway, so the overlay is just a no-op.
  const [dragOverrides, setDragOverrides] = useState<LayoutMap>({});

  const { nodes: baseNodes, edges } = useMemo(() => {
    if (!state) return { nodes: [] as Node[], edges: [] as Edge[] };
    const base = toFlowElements(state, layout, diff);
    return simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
  }, [state, layout, diff, simulation]);

  const nodes = useMemo(
    () => baseNodes.map((n) => (dragOverrides[n.id] ? { ...n, position: dragOverrides[n.id] } : n)),
    [baseNodes, dragOverrides]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moved: LayoutMap = {};
      const released: LayoutMap = {};
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          moved[c.id] = c.position;
          // `dragging: false` fires once on release — only persist then,
          // not on every intermediate pointer-move frame of the drag.
          if (c.dragging === false) released[c.id] = c.position;
        }
      }
      if (Object.keys(moved).length > 0) setDragOverrides((prev) => ({ ...prev, ...moved }));
      if (Object.keys(released).length > 0) onNodePositionsChange?.(released);
    },
    [onNodePositionsChange]
  );

  const selectedNode = selectedNodeId ? (state?.nodes.find((n) => n.id === selectedNodeId) ?? null) : null;
  const selectedLoad = selectedNodeId ? simulation?.loads.find((l) => l.node_id === selectedNodeId) : undefined;
  const selectedFinding = selectedNodeId ? simulation?.findings.find((f) => f.node_id === selectedNodeId) : undefined;

  if (!state || state.nodes.length === 0) {
    if (busy) {
      return (
        <div className="relative h-full w-full">
          <CanvasLoadingOverlay active fullscreen />
        </div>
      );
    }
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
        onNodesChange={onNodesChange}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--rf-dot-color)" />
        <Controls showInteractive={false} />
        {nodes.length > 5 && minimapVisible && (
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
      {nodes.length > 5 && (
        // Top-right: Controls defaults to bottom-left and MiniMap to
        // bottom-right, so this is the one corner nothing else claims.
        <IconButton
          onClick={() => setMinimapVisible((v) => !v)}
          className="absolute right-3.5 top-3.5 z-10 border border-slate-200 bg-white/90 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90"
          title={minimapVisible ? "Hide minimap" : "Show minimap"}
        >
          <Map size={14} className={minimapVisible ? "text-brand-600 dark:text-indigo-400" : ""} />
        </IconButton>
      )}
      {selectedNode && (
        <NodeDetailCard
          node={selectedNode}
          load={selectedLoad}
          finding={selectedFinding}
          onClose={() => setSelectedNodeId(null)}
          onSave={onNodeSave}
        />
      )}
      <CanvasLoadingOverlay active={busy} />
    </div>
  );
}
