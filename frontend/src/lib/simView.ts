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
    const targetStatus = statusByNode.get(e.target);
    const rps = rpsByEdge.get(e.id);
    const flowing = targetStatus !== "killed";
    return {
      ...e,
      animated: flowing,
      label: rps !== undefined ? `${Math.round(rps)} rps` : e.label,
      style: simEdgeStyle(targetStatus),
      labelStyle: { fontSize: 11, fontWeight: 600 },
      data: { ...e.data, flowing, flowSpeed: flowSpeedFor(targetStatus), flowCount: targetStatus === "overloaded" ? 3 : targetStatus === "warning" ? 2 : 1 },
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
    return {
      id: `${TRAFFIC_SOURCE_ID}->${n.id}`,
      type: "flow",
      source: TRAFFIC_SOURCE_ID,
      target: n.id,
      label: `${Math.round(rpsByNode.get(n.id) ?? 0)} rps`,
      animated: flowing,
      selectable: false,
      style: simEdgeStyle(status),
      labelStyle: { fontSize: 11, fontWeight: 600 },
      data: { flowing, flowSpeed: flowSpeedFor(status), flowCount: status === "overloaded" ? 3 : status === "warning" ? 2 : 1 },
    };
  });

  return { nodes: [trafficSourceNode, ...simNodes], edges: [...entryEdges, ...simEdges] };
}

function flowSpeedFor(status?: LoadStatus): number {
  // seconds per lap — faster particles read as "more traffic pressure"
  if (status === "overloaded") return 0.5;
  if (status === "warning") return 0.85;
  return 1.4;
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
