import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

/**
 * A bezier edge with small particles animated along its path via SVG
 * `<animateMotion>` — a lightweight "data flowing through the pipe" effect
 * (the same technique service-mesh visualizations like Kiali/Istio use)
 * rather than just a dashed line. Falls back to a plain edge when the
 * caller doesn't mark it as flowing (e.g. a removed/ghost edge).
 */
export function FlowEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, style, markerEnd, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const flowing = Boolean((data as { flowing?: boolean } | undefined)?.flowing);
  const speed = (data as { flowSpeed?: number } | undefined)?.flowSpeed ?? 1.2;
  const count = (data as { flowCount?: number } | undefined)?.flowCount ?? 1;
  const color = (style as { stroke?: string } | undefined)?.stroke ?? "#94a3b8";

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {flowing &&
        Array.from({ length: count }).map((_, i) => (
          <circle key={i} r={3} fill={color}>
            <animateMotion dur={`${speed}s`} repeatCount="indefinite" path={edgePath} begin={`${(i * speed) / count}s`} />
          </circle>
        ))}
    </>
  );
}
