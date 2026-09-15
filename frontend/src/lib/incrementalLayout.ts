import type { ArchEdge, ArchitectureState } from "./types";
import { NODE_HEIGHT, NODE_WIDTH, type LayoutMap } from "./layout";

// The concrete fix for "previous nodes keep their layout position where
// possible" (spec §6 Phase 2 acceptance criteria): carry forward every
// unchanged node's position unmodified, and place only the genuinely new
// nodes — aligned with an existing "sibling" where one exists, else near
// the centroid of their already-positioned neighbors, nudged to avoid
// overlap — instead of re-running dagre over the whole graph.

/** Two nodes are "siblings" from edge `e`'s perspective if some OTHER node
 * has the exact same relationship to the exact same neighbor — e.g. a
 * second backend instance fed by the same load balancer as the first, or
 * a second read replica the same primary already replicates to. Verified
 * empirically (not just assumed) that this, not dagre's own config, is
 * what was producing the scattered/staggered placement complained about:
 * dagre's default already centers a fan-out's source exactly on its
 * children when laid out fresh in one pass (a load balancer feeding 3
 * backends lands precisely on their vertical midpoint) — the problem was
 * only ever incremental placement, where 3 backends added across 3
 * separate edits each get positioned from their own local centroid with
 * no idea the other two exist, one at a time, instead of as one group. */
function findPositionedSibling(n: { id: string }, edge: ArchEdge, state: ArchitectureState, layout: LayoutMap): string | null {
  const isOutgoing = edge.from_id === n.id;
  const neighborId = isOutgoing ? edge.to_id : edge.from_id;
  const sibling = state.edges.find(
    (e2) =>
      e2.id !== edge.id &&
      (isOutgoing ? e2.to_id === neighborId && e2.from_id !== n.id : e2.from_id === neighborId && e2.to_id !== n.id) &&
      layout[isOutgoing ? e2.from_id : e2.to_id]
  );
  return sibling ? (isOutgoing ? sibling.from_id : sibling.to_id) : null;
}

// Beyond this many nodes stacked straight down one column, a real group
// (e.g. 3 backends behind a load balancer) starts reading as "everything
// just piles up vertically" instead of an intentional cluster — found
// live: a chat conversation with several edits in a row, each adding one
// more sibling, produced one long single-file column of boxes regardless
// of how many accumulated, because the old version of this function only
// ever searched for a free slot by moving further down the same column.
const MAX_COLUMN_SIBLINGS = 4;

/** Finds an unoccupied spot near (x, startY), preferring straight down
 * from it (so a small group still reads as one aligned column) but
 * wrapping into a fresh column — offset right by one node-width — once a
 * column already holds MAX_COLUMN_SIBLINGS nodes, instead of letting a
 * single column grow without limit. This is the only thing that changed
 * about incremental placement; sibling-detection and centroid placement
 * above are untouched — a large group now actually fills 2D space instead
 * of a single straight line, without needing dagre (or anything, LLM
 * included) to re-lay out nodes that already have a placed position. */
function firstFreeSlot(x: number, startY: number, layout: LayoutMap): { x: number; y: number } {
  let col = 0;
  let stacked = 0;
  let y = startY;
  let guard = 0;
  while (guard < 40) {
    const cx = x + col * (NODE_WIDTH + 60);
    const collision = Object.values(layout).some((p) => Math.abs(p.x - cx) < NODE_WIDTH && Math.abs(p.y - y) < NODE_HEIGHT);
    if (!collision) return { x: cx, y };
    stacked++;
    if (stacked >= MAX_COLUMN_SIBLINGS) {
      col++;
      stacked = 0;
      y = startY;
    } else {
      y += NODE_HEIGHT + 20;
    }
    guard++;
  }
  return { x, y };
}

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
    const nodeEdges = nextState.edges.filter((e) => e.from_id === n.id || e.to_id === n.id);

    // Prefer aligning with a positioned sibling (same x, stacked directly
    // below it) over a generic centroid placement — this is what actually
    // makes "3 backends behind one load balancer" or "3 replicas off one
    // primary" read as one aligned group instead of a scattered one.
    let sibling: string | null = null;
    for (const e of nodeEdges) {
      sibling = findPositionedSibling(n, e, nextState, layout);
      if (sibling) break;
    }
    if (sibling) {
      layout[n.id] = firstFreeSlot(layout[sibling].x, layout[sibling].y, layout);
      continue;
    }

    const neighborIds = nodeEdges.map((e) => (e.from_id === n.id ? e.to_id : e.from_id)).filter((id) => layout[id]);

    if (neighborIds.length > 0) {
      const cx = neighborIds.reduce((sum, id) => sum + layout[id].x, 0) / neighborIds.length;
      const cy = neighborIds.reduce((sum, id) => sum + layout[id].y, 0) / neighborIds.length;
      layout[n.id] = firstFreeSlot(cx + NODE_WIDTH + 60, cy, layout);
    } else {
      // isolated new node with no positioned neighbor: drop it in a fresh row
      const maxY = Object.values(layout).reduce((m, p) => Math.max(m, p.y), -NODE_HEIGHT - 40);
      layout[n.id] = { x: 40, y: maxY + NODE_HEIGHT + 40 };
    }
  }

  return layout;
}
