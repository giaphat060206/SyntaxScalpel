import type { ElkPoint } from "./result";

/** SVG path for an orthogonal polyline produced by ELK. */
export function sectionToPath(points: ElkPoint[]): string {
  if (points.length < 2) {
    return "";
  }
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest
    .map((point) => ` L ${point.x} ${point.y}`)
    .join("")}`;
}
