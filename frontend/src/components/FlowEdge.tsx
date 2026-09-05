import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import { getEdgeParams } from "@/lib/floatingEdge";

/**
 * A "floating" bezier edge: rather than always leaving/entering a node from
 * one fixed handle side, it computes the actual closest points between the
 * two node boxes every render (see lib/floatingEdge.ts) so the line always
 * meets each box on whichever of its four sides genuinely faces the other
 * node — the way a real diagramming tool (draw.io, Lucidchart, Excalidraw)
 * routes connectors. On top of that it renders small particles animated
 * along the path via SVG `<animateMotion>` — a lightweight "data flowing
 * through the pipe" effect (the same technique service-mesh visualizations
 * like Kiali/Istio use) rather than just a dashed line. Falls back to a
 * plain edge when the caller doesn't mark it as flowing (e.g. a
 * removed/ghost edge).
 */
export function FlowEdge({ id, source, target, style, markerEnd, data, label, labelStyle }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);
  const [edgePath] = getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: sourcePos, targetX: tx, targetY: ty, targetPosition: targetPos });

  const flowing = Boolean((data as { flowing?: boolean } | undefined)?.flowing);
  const speed = (data as { flowSpeed?: number } | undefined)?.flowSpeed ?? 1.2;
  const count = (data as { flowCount?: number } | undefined)?.flowCount ?? 1;
  const color = (style as { stroke?: string } | undefined)?.stroke ?? "#94a3b8";

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} label={label} labelStyle={labelStyle} labelBgBorderRadius={4} />
      {flowing &&
        Array.from({ length: count }).map((_, i) => (
          <circle key={i} r={3} fill={color}>
            <animateMotion dur={`${speed}s`} repeatCount="indefinite" path={edgePath} begin={`${(i * speed) / count}s`} />
          </circle>
        ))}
    </>
  );
}
