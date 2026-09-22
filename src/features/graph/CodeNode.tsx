import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GraphNode } from "../../shared/types";

export interface CodeNodeData extends Record<string, unknown> {
  node: GraphNode;
  highlighted: boolean;
  dimmed: boolean;
}

export function CodeNode({ data }: NodeProps) {
  const { node, highlighted, dimmed } = data as CodeNodeData;

  const borderClass = highlighted
    ? "border-mint shadow-[0_0_12px_rgba(61,240,168,0.5)]"
    : "border-accent/40";
  const opacity = dimmed ? "opacity-30" : "opacity-100";

  return (
    <div
      className={`rounded border-2 bg-panel px-3 py-2 transition-opacity ${borderClass} ${opacity}`}
      style={node.kind === "class" ? { width: "100%", height: "100%" } : { width: 200 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent" />
      <div className="border-b border-white/10 pb-1 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-dimmed">
          {node.kind}
        </span>
        <div className="font-mono text-sm text-accent truncate">{node.name}</div>
      </div>
      {node.params.length > 0 && (
        <div className="font-mono text-[11px] text-white/80">
          {(node.params ?? []).map((p) => (
            <div key={p} className="truncate">
              in: {p}
            </div>
          ))}
        </div>
      )}
      {node.returns.length > 0 && (
        <div className="font-mono text-[11px] text-mint/90">
          {node.returns.map((r) => (
            <div key={r} className="truncate">
              out: {r}
            </div>
          ))}
        </div>
      )}
      {node.kind !== "class" && (
        <Handle type="source" position={Position.Bottom} className="!bg-accent" />
      )}
    </div>
  );
}
