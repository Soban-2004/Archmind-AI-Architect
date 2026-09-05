import type { Edge, Node } from "@xyflow/react";
import type { LoadStatus, SimulationResult } from "./types";

/**
 * Overlays a SimulationResult onto already-positioned flow nodes/edges
 * (spec §6 Phase 7). Node color = capacity status; edge = animated,
 * colored by its target node's status, and labeled with its own
 * projected rps so the canvas reads as "traffic visibly flowing and
 * pooling up wherever it's about to break" rather than a static diagram.
 */
export function applySimulation(nodes: Node[], edges: Edge[], sim: SimulationResult | null): { nodes: Node[]; edges: Edge[] } {
  if (!sim) return { nodes, edges };

  const statusByNode = new Map(sim.loads.map((l) => [l.node_id, l.status]));
  const rpsByEdge = new Map(sim.edge_loads.map((e) => [e.edge_id, e.rps]));

  const simNodes = nodes.map((n) => ({
    ...n,
    data: { ...n.data, simStatus: statusByNode.get(n.id) },
  }));

  const simEdges = edges.map((e) => {
    const targetStatus = statusByNode.get(e.target);
    const rps = rpsByEdge.get(e.id);
    return {
      ...e,
      animated: targetStatus !== "killed",
      label: rps !== undefined ? `${Math.round(rps)} rps` : e.label,
      style: simEdgeStyle(targetStatus),
      labelStyle: { fontSize: 11, fontWeight: 600 },
    };
  });

  return { nodes: simNodes, edges: simEdges };
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
