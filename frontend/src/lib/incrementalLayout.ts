import type { ArchitectureState } from "./types";
import { NODE_HEIGHT, NODE_WIDTH, type LayoutMap } from "./layout";

// The concrete fix for "previous nodes keep their layout position where
// possible" (spec §6 Phase 2 acceptance criteria): carry forward every
// unchanged node's position unmodified, and place only the genuinely new
// nodes — near the centroid of their already-positioned neighbors, nudged
// to avoid overlap — instead of re-running dagre over the whole graph.
export function computeIncrementalLayout(
  prevState: ArchitectureState | null,
  prevLayout: LayoutMap,
  nextState: ArchitectureState
): LayoutMap {
  const prevIds = new Set((prevState?.nodes ?? []).map((n) => n.id));
  const layout: LayoutMap = {};

  for (const n of nextState.nodes) {
    if (prevIds.has(n.id) && prevLayout[n.id]) {
      layout[n.id] = prevLayout[n.id];
    }
  }

  const newNodes = nextState.nodes.filter((n) => !layout[n.id]);
  for (const n of newNodes) {
    const neighborIds = nextState.edges
      .filter((e) => e.from_id === n.id || e.to_id === n.id)
      .map((e) => (e.from_id === n.id ? e.to_id : e.from_id))
      .filter((id) => layout[id]);

    if (neighborIds.length > 0) {
      const cx = neighborIds.reduce((sum, id) => sum + layout[id].x, 0) / neighborIds.length;
      const cy = neighborIds.reduce((sum, id) => sum + layout[id].y, 0) / neighborIds.length;
      const x = cx + NODE_WIDTH + 60;
      let y = cy;
      let guard = 0;
      while (
        Object.values(layout).some((p) => Math.abs(p.x - x) < NODE_WIDTH && Math.abs(p.y - y) < NODE_HEIGHT) &&
        guard < 20
      ) {
        y += NODE_HEIGHT + 20;
        guard++;
      }
      layout[n.id] = { x, y };
    } else {
      // isolated new node with no positioned neighbor: drop it in a fresh row
      const maxY = Object.values(layout).reduce((m, p) => Math.max(m, p.y), -NODE_HEIGHT - 40);
      layout[n.id] = { x: 40, y: maxY + NODE_HEIGHT + 40 };
    }
  }

  return layout;
}
