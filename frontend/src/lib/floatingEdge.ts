import { Position, type InternalNode, type Node } from "@xyflow/react";

// "Floating" edge geometry: instead of pinning every edge to one fixed
// handle (e.g. always left-in/right-out), compute where the straight line
// between the two node *centers* actually crosses each node's rectangle,
// and route the edge from/to that point. Two boxes side by side connect
// left-right as before; two boxes stacked vertically connect top-bottom;
// anything in between picks whichever side is genuinely closest — so the
// line always leaves/enters from the nearest free side instead of looping
// around to a side fixed at the component level.
//
// This is the standard technique from React Flow's own "floating edges"
// example (https://reactflow.dev/examples/edges/floating-edges), adapted
// for our node type. It only needs each node's absolute position + measured
// size, both of which `useInternalNode` already tracks for us.

function getNodeIntersection(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const { width: iw, height: ih } = intersectionNode.measured ?? {};
  const intersectionPos = intersectionNode.internals.positionAbsolute;
  const targetPos = targetNode.internals.positionAbsolute;

  const w = (iw ?? 0) / 2;
  const h = (ih ?? 0) / 2;

  const x2 = intersectionPos.x + w;
  const y2 = intersectionPos.y + h;
  const x1 = targetPos.x + (targetNode.measured?.width ?? 0) / 2;
  const y1 = targetPos.y + (targetNode.measured?.height ?? 0) / 2;

  // Elliptical-boundary approximation of the rectangle intersection — cheap,
  // stable at any angle, and visually indistinguishable from an exact
  // rectangle intersection for card-shaped nodes like ours.
  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

function getEdgePosition(node: InternalNode<Node>, intersectionPoint: { x: number; y: number }): Position {
  const pos = node.internals.positionAbsolute;
  const nx = Math.round(pos.x);
  const ny = Math.round(pos.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + width - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + height - 1) return Position.Bottom;
  return Position.Top;
}

export function getEdgeParams(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sourceIntersection = getNodeIntersection(source, target);
  const targetIntersection = getNodeIntersection(target, source);

  return {
    sx: sourceIntersection.x,
    sy: sourceIntersection.y,
    tx: targetIntersection.x,
    ty: targetIntersection.y,
    sourcePos: getEdgePosition(source, sourceIntersection),
    targetPos: getEdgePosition(target, targetIntersection),
  };
}
