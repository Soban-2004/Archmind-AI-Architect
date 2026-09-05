import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import type { ArchitectureState } from "./types";

// Deterministic layout: the graph's positions are always a pure function of
// the ArchitectureState, computed by dagre — never chosen by the LLM (spec
// §0 / §5). Phase 1 recomputes the full layout on every render; incremental
// position-preservation across edits is a Phase 2 concern (see
// AI_ARCHITECT_IMPLEMENTATION.md critique — layout will move to persisted
// per-version `layout` metadata then).

const NODE_WIDTH = 190;
const NODE_HEIGHT = 64;

export function layoutState(state: ArchitectureState): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of state.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of state.edges) {
    if (state.nodes.some((n) => n.id === e.from_id) && state.nodes.some((n) => n.id === e.to_id)) {
      g.setEdge(e.from_id, e.to_id);
    }
  }

  dagre.layout(g);

  const nodes: Node[] = state.nodes.map((n) => {
    const pos = g.node(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "archNode",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { archNode: n },
    };
  });

  const edges: Edge[] = state.edges.map((e) => ({
    id: e.id,
    source: e.from_id,
    target: e.to_id,
    label: e.protocol,
    animated: e.sync_async === "async_",
    style: { strokeWidth: 1.5 },
    labelStyle: { fontSize: 11 },
  }));

  return { nodes, edges };
}
