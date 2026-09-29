import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { sectionToPath } from "./path";
import type { ElkPoint } from "./result";

export function ElkEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const points = (data as { points?: ElkPoint[] } | undefined)?.points;
  if (points && points.length >= 2) {
    return (
      <BaseEdge
        id={id}
        path={sectionToPath(points)}
        style={style}
        markerEnd={markerEnd}
      />
    );
  }
  const [fallbackPath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return <BaseEdge id={id} path={fallbackPath} style={style} markerEnd={markerEnd} />;
}
