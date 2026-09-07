import dagre from "dagre";
import type { ArchitectureState } from "./types";

// Deterministic layout: positions are always a pure function of the graph
// structure, computed by dagre — never chosen by the LLM (spec §0/§5).
// This is the FULL re-layout, used only when there's no persisted layout to
// build on (a version's very first render). Incremental edits use
// incrementalLayout.ts instead, so existing nodes don't jump around.

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 68;

// Real, constant size of the synthetic "Users" traffic-source marker
// (TrafficSourceNode.tsx) — the same kind of fact as NODE_WIDTH/HEIGHT
// above (a real component's actual rendered size), kept here so anything
// doing layout math ahead of a render (hand-placed landing fixtures,
// MiniArchitecturePreview's deterministic bounds calculation) has one
// shared source for it instead of a magic number copied in two places.
export const TRAFFIC_SOURCE_WIDTH = 150;
export const TRAFFIC_SOURCE_HEIGHT = 92;

export type LayoutMap = Record<string, { x: number; y: number }>;

export function computeDagreLayout(state: ArchitectureState): LayoutMap {
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

  const layout: LayoutMap = {};
  for (const n of state.nodes) {
    const pos = g.node(n.id);
    if (pos) layout[n.id] = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  }
  return layout;
}
