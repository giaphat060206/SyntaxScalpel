import { useCallback } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  useNodeId,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import type { GraphNode } from "../../shared/types";

export interface SpecialBlock {
  title: string;
  lines: string[];
}

export interface CodeNodeData extends Record<string, unknown> {
  node?: GraphNode;
  special?: SpecialBlock;
  highlighted: boolean;
  dimmed: boolean;
  pinned?: boolean;
}

const borderFor = (highlighted: boolean) =>
  highlighted
    ? "border-mint shadow-[0_0_12px_rgba(61,240,168,0.5)]"
    : "border-accent/40";

export function CodeNode({ data, selected }: NodeProps) {
  const { node, special, highlighted, dimmed } = data as CodeNodeData;
  const opacity = dimmed ? "opacity-30" : "opacity-100";
  const id = useNodeId();
  const { setNodes } = useReactFlow();

  // Height is content-driven: after a resize, drop the explicit height so the
  // block shrinks/grows to fit however the text now wraps at the new width.
  const clearHeight = useCallback(() => {
    if (!id) {
      return;
    }
    setNodes((nodes) =>
      nodes.map((current) =>
        current.id === id
          ? {
              ...current,
              height: undefined,
              style: { ...(current.style ?? {}), height: undefined },
            }
          : current
      )
    );
  }, [id, setNodes]);

  if (special) {
    return (
      <div
        className={`h-full w-full min-w-[160px] overflow-hidden rounded border-2 bg-panel px-3 py-2 transition-opacity ${borderFor(
          highlighted
        )} ${opacity}`}
      >
        <div className="mb-1 border-b border-white/10 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-accent">
            {special.title}
          </span>
        </div>
        <div className="font-mono text-[11px] text-white/80">
          {special.lines.length === 0 ? (
            <div className="text-dimmed">none</div>
          ) : (
            special.lines.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap break-words">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (!node) {
    return null;
  }

  const callable = node.kind === "function" || node.kind === "method";
  const container = node.kind === "class";

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={container ? 240 : 160}
        minHeight={container ? 120 : 40}
        lineClassName="!border-accent"
        handleClassName="!h-2 !w-2 !border-panel !bg-accent"
        onResizeEnd={clearHeight}
      />
      <div
        className={`h-full w-full min-w-[160px] overflow-hidden rounded border-2 bg-panel px-3 py-2 transition-opacity ${borderFor(
          highlighted
        )} ${opacity}`}
      >
        {(container || callable) && (
          <Handle type="target" position={Position.Top} className="!bg-accent" />
        )}
        <div className="mb-1 border-b border-white/10 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-dimmed">
            {node.kind}
          </span>
          <div className="break-words font-mono text-sm text-accent">{node.name}</div>
        </div>
        {node.params.length > 0 && (
          <div className="font-mono text-[11px] text-white/80">
            {(node.params ?? []).map((p) => (
              <div key={p} className="whitespace-pre-wrap break-words">
                in: {p}
              </div>
            ))}
          </div>
        )}
        {node.returns.length > 0 && (
          <div className="font-mono text-[11px] text-mint/90">
            {node.returns.map((r) => (
              <div key={r} className="whitespace-pre-wrap break-words">
                out: {r}
              </div>
            ))}
          </div>
        )}
        {node.value !== undefined && (
          <div className="font-mono text-[11px] text-white/70">
            <div className="whitespace-pre-wrap break-words">= {node.value}</div>
          </div>
        )}
        {callable && (
          <Handle type="source" position={Position.Bottom} className="!bg-accent" />
        )}
      </div>
    </>
  );
}
