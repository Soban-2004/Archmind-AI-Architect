import type { Edge, Node } from "@xyflow/react";
import type { LayoutMap } from "./layout";
import type { ArchEdge, ArchitectureState, ArchNode, DiffStatus, VersionDiff } from "./types";

/**
 * Build a displayable state that still shows removed nodes/edges as ghosts,
 * so a diff communicates what disappeared, not just what remains. Ghosts
 * are reconstructed straight from the diff's own `before` snapshots (every
 * diff entry already carries full before/after objects) — no need to fetch
 * the parent version separately just to render them.
 */
export function buildDiffDisplayState(state: ArchitectureState, diff: VersionDiff | null): ArchitectureState {
  if (!diff) return state;

  const ghostNodes = diff.nodes
    .filter((d) => d.status === "removed" && d.before)
    .map((d) => d.before as ArchNode);
  const ghostEdges = diff.edges
    .filter((d) => d.status === "removed" && d.before)
    .map((d) => d.before as ArchEdge);

  if (ghostNodes.length === 0 && ghostEdges.length === 0) return state;

  return {
    ...state,
    nodes: [...state.nodes, ...ghostNodes],
    edges: [...state.edges, ...ghostEdges],
  };
}

export function mergeLayouts(beforeLayout: LayoutMap, afterLayout: LayoutMap): LayoutMap {
  return { ...beforeLayout, ...afterLayout };
}

export function toFlowElements(
  state: ArchitectureState,
  layout: LayoutMap,
  diff?: VersionDiff | null
): { nodes: Node[]; edges: Edge[] } {
  const nodeStatusById = new Map<string, DiffStatus>((diff?.nodes ?? []).map((d) => [d.id, d.status]));
  const edgeStatusByKey = new Map<string, DiffStatus>((diff?.edges ?? []).map((d) => [d.key, d.status]));

  const nodes: Node[] = state.nodes.map((n) => ({
    id: n.id,
    type: "archNode",
    position: layout[n.id] ?? { x: 0, y: 0 },
    data: { archNode: n, diffStatus: nodeStatusById.get(n.id) },
    // ghost (removed) nodes shouldn't be draggable/selectable as if they were real
    draggable: nodeStatusById.get(n.id) !== "removed",
  }));

  const edges: Edge[] = state.edges.map((e) => {
    const status = edgeStatusByKey.get(`${e.from_id}->${e.to_id}`);
    return {
      id: e.id,
      source: e.from_id,
      target: e.to_id,
      label: e.protocol,
      animated: e.sync_async === "async_" && status !== "removed",
      style: edgeStyle(status),
      labelStyle: { fontSize: 11 },
    };
  });

  return { nodes, edges };
}

function edgeStyle(status?: DiffStatus) {
  switch (status) {
    case "added":
      return { stroke: "#16a34a", strokeWidth: 2 };
    case "removed":
      return { stroke: "#dc2626", strokeWidth: 1.5, strokeDasharray: "4 3", opacity: 0.6 };
    case "changed":
      return { stroke: "#d97706", strokeWidth: 2 };
    default:
      return { stroke: "#94a3b8", strokeWidth: 1.5 };
  }
}
