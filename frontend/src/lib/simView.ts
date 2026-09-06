import type { Edge, Node } from "@xyflow/react";
import type { LoadStatus, SimulationResult } from "./types";

export const TRAFFIC_SOURCE_ID = "__traffic_source__";

/**
 * Overlays a SimulationResult onto already-positioned flow nodes/edges
 * (spec §6 Phase 7). Node color = capacity status; edge = animated,
 * colored by its target node's status, and labeled with its own
 * projected rps so the canvas reads as "traffic visibly flowing and
 * pooling up wherever it's about to break" rather than a static diagram.
 *
 * The simulator's own model injects load at every node with no incoming
 * edge (backend/app/services/simulator.py rule 1) — but that was
 * previously invisible on the canvas: the entry node just lit up with no
 * line leading into it, so there was no visible "this is where traffic
 * starts". We synthesize a client-side-only "Users" node and a flowing
 * edge into every such entry node, purely for this overlay — it's never
 * part of the real architecture state.
 */
export function applySimulation(nodes: Node[], edges: Edge[], sim: SimulationResult | null): { nodes: Node[]; edges: Edge[] } {
  if (!sim) return { nodes, edges };

  const statusByNode = new Map(sim.loads.map((l) => [l.node_id, l.status]));
  const rpsByNode = new Map(sim.loads.map((l) => [l.node_id, l.incoming_rps]));
  const rpsByEdge = new Map(sim.edge_loads.map((e) => [e.edge_id, e.rps]));

  const simNodes = nodes.map((n) => ({
    ...n,
    data: { ...n.data, simStatus: statusByNode.get(n.id) },
  }));

  const simEdges = edges.map((e) => {
    // A ghost/removed edge (ArchitectureCanvas is showing a diff overlay —
    // see buildDiffDisplayState) has a target the backend never simulated
    // at all, since it's not part of the current real state — its status
    // is genuinely absent, not "healthy". Treating "no data" the same as
    // "ok" here was the actual bug: it silently overwrote the edge's
    // correct dashed/removed styling with a healthy green one and lit up
    // traffic particles flowing into a node that no longer exists. Leave
    // any edge with no real sim data completely untouched instead.
    if (!statusByNode.has(e.target)) return e;

    const targetStatus = statusByNode.get(e.target);
    const rps = rpsByEdge.get(e.id);
    const flowing = targetStatus !== "killed";
    const intensity = intensityFor(rps ?? 0);
    return {
      ...e,
      animated: flowing,
      label: rps !== undefined ? `${Math.round(rps)} rps` : e.label,
      style: simEdgeStyle(targetStatus),
      labelStyle: { fontSize: 11, fontWeight: 600 },
      data: { ...e.data, flowing, flowSpeed: intensity.speed, flowCount: intensity.count },
    };
  });

  // Entry points = nodes the simulator injected load into directly, i.e.
  // anything with no real incoming edge among the currently-active edges
  // (mirrors the simulator's own "traffic enters at nodes with no
  // incoming edges" rule exactly, using the same edge list already on
  // screen rather than recomputing it differently).
  const hasIncoming = new Set(edges.map((e) => e.target));
  const entryNodes = simNodes.filter((n) => !hasIncoming.has(n.id) && statusByNode.has(n.id));

  if (entryNodes.length === 0) return { nodes: simNodes, edges: simEdges };

  const sourceX = Math.min(...entryNodes.map((n) => n.position.x)) - 190;
  const sourceY = entryNodes.reduce((sum, n) => sum + n.position.y, 0) / entryNodes.length;
  const totalRps = entryNodes.reduce((sum, n) => sum + (rpsByNode.get(n.id) ?? 0), 0);

  const trafficSourceNode: Node = {
    id: TRAFFIC_SOURCE_ID,
    type: "trafficSource",
    position: { x: sourceX, y: sourceY },
    data: { rps: totalRps },
    draggable: false,
    selectable: false,
  };

  const entryEdges: Edge[] = entryNodes.map((n) => {
    const status = statusByNode.get(n.id);
    const flowing = status !== "killed";
    const rps = rpsByNode.get(n.id) ?? 0;
    const intensity = intensityFor(rps);
    return {
      id: `${TRAFFIC_SOURCE_ID}->${n.id}`,
      type: "flow",
      source: TRAFFIC_SOURCE_ID,
      target: n.id,
      label: `${Math.round(rps)} rps`,
      animated: flowing,
      selectable: false,
      style: simEdgeStyle(status),
      labelStyle: { fontSize: 11, fontWeight: 600 },
      data: { flowing, flowSpeed: intensity.speed, flowCount: intensity.count },
    };
  });

  return { nodes: [trafficSourceNode, ...simNodes], edges: [...entryEdges, ...simEdges] };
}

/**
 * How busy an edge *looks* — speed (seconds per lap) and particle count —
 * scaled off its actual projected req/s, not just the 3-value
 * ok/warning/overloaded status. Two edges both sitting comfortably under
 * capacity used to render identically whether they carried 5 rps or 95
 * rps; now volume of traffic reads directly off the animation itself,
 * while color/stroke-width (see simEdgeStyle) stays the separate signal
 * for "how close to breaking" this edge's target is.
 *
 * Scaled by log10, not linearly: real traffic differences that matter here
 * are "10x more" (1 vs 10 vs 100 rps), and a linear map either crowds
 * those together near zero or saturates by ~100 rps with nothing left to
 * show at 500+. Log-scaling gives each order of magnitude its own clearly
 * distinct step. Capped at 6 particles / 0.4s-per-lap rather than pushed
 * further, so individual particles stay trackable as points moving rather
 * than blurring into a solid line at high load — the ask was "make it
 * clearly readable that this is fast", not literally one particle per
 * request per second (which would be unreadable past a handful of rps).
 */
function intensityFor(rps: number): { speed: number; count: number } {
  const log = Math.log10(Math.max(0, rps) + 1); // 0 at 0 rps, 1 at 9, 2 at 99, 3 at 999
  const count = Math.min(6, Math.max(1, Math.round(1 + log * 1.7)));
  const speed = Math.max(0.4, 1.7 - log * 0.45);
  return { speed, count };
}

function simEdgeStyle(status?: LoadStatus) {
  switch (status) {
    case "overloaded":
      return { stroke: "#dc2626", strokeWidth: 3 };
    case "warning":
      return { stroke: "#d97706", strokeWidth: 2.5 };
    case "killed":
      return { stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "2 4", opacity: 0.3 };
    default:
      return { stroke: "#16a34a", strokeWidth: 1.5 };
  }
}
