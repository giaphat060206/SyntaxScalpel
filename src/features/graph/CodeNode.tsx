import { useCallback } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  useNodeId,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import type { FileImport, GraphNode } from "../../shared/types";

export interface SpecialBlock {
  title: string;
  lines: string[];
}

export interface ProjectBlock {
  kind: "folder" | "file";
  name: string;
  collapsed?: boolean;
  imports?: FileImport[];
  fileKind?: "code" | "doc";
  entry?: boolean;
  transparent?: boolean;
}

export interface CodeNodeData extends Record<string, unknown> {
  node?: GraphNode;
  special?: SpecialBlock;
  project?: ProjectBlock;
  onToggleCollapse?: (id: string) => void;
  color?: string;
  /** Container whose edges must stay visible through it. */
  transparent?: boolean;
  highlighted: boolean;
  dimmed: boolean;
  pinned?: boolean;
}

const handleClass =
  "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

export function CodeNode({ data, selected }: NodeProps) {
  const { node, special, project, highlighted, dimmed, onToggleCollapse } =
    data as CodeNodeData;
  const color = (data as CodeNodeData).color ?? "#00F0FF";
  const opacity = dimmed ? "opacity-30" : "opacity-100";
  const id = useNodeId();
  const { setNodes } = useReactFlow();

  const borderColor = highlighted ? "#3DF0A8" : color;
  const boxShadow = highlighted
    ? "0 0 12px rgba(61,240,168,0.5)"
    : undefined;

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

  const edgeHandles = (
    <>
      <Handle
        id="t-in"
        type="target"
        position={Position.Top}
        style={{ left: "40%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="l-in"
        type="target"
        position={Position.Left}
        style={{ top: "40%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="b-in"
        type="target"
        position={Position.Bottom}
        style={{ left: "40%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="r-in"
        type="target"
        position={Position.Right}
        style={{ top: "40%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="t-out"
        type="source"
        position={Position.Top}
        style={{ left: "60%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="l-out"
        type="source"
        position={Position.Left}
        style={{ top: "60%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="b-out"
        type="source"
        position={Position.Bottom}
        style={{ left: "60%" }}
        className={handleClass}
        isConnectable={false}
      />
      <Handle
        id="r-out"
        type="source"
        position={Position.Right}
        style={{ top: "60%" }}
        className={handleClass}
        isConnectable={false}
      />
    </>
  );

  if (special) {
    return (
      <div
        className={`h-full w-full min-w-[160px] overflow-hidden rounded border-2 bg-panel px-3 py-2 transition-opacity ${opacity}`}
        style={{ borderColor, boxShadow }}
      >
        <div className="mb-1 border-b border-white/10 pb-1">
          <span
            className="text-[10px] uppercase tracking-wider"
            style={{ color }}
          >
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

  if (project) {
    const isFolder = project.kind === "folder";
    // A folder that holds an edge's endpoint stays transparent so its lines
    // show; folders merely passed by stay opaque and hide lines underneath.
    const background =
      isFolder && project.transparent ? "bg-transparent" : "bg-panel";
    return (
      <div
        className={`h-full w-full min-w-[140px] overflow-hidden rounded border-2 px-3 py-2 transition-opacity ${background} ${opacity}`}
        style={{ borderColor, boxShadow }}
      >
        {!isFolder && edgeHandles}
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate font-mono text-sm"
            style={{ color }}
            title={project.name}
          >
            {isFolder ? "📁 " : project.fileKind === "doc" ? "📄 " : ""}
            {project.name}
          </span>
          {project.entry && (
            <span className="rounded bg-mint/20 px-1 text-[9px] uppercase tracking-wider text-mint">
              start
            </span>
          )}
          {isFolder && (
            <button
              type="button"
              className="rounded px-1 text-xs text-dimmed hover:bg-white/10"
              onClick={(event) => {
                event.stopPropagation();
                if (id) onToggleCollapse?.(id);
              }}
            >
              {project.collapsed ? "▸" : "▾"}
            </button>
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
        className={`h-full w-full min-w-[160px] overflow-hidden rounded border-2 px-3 py-2 transition-opacity ${
          container && (data as CodeNodeData).transparent
            ? "bg-transparent"
            : "bg-panel"
        } ${opacity}`}
        style={{ borderColor, boxShadow }}
      >
        {callable && edgeHandles}
        {container && (
          <>
            <Handle
              id="t-in"
              type="target"
              position={Position.Top}
              className={handleClass}
              isConnectable={false}
            />
            <Handle
              id="l-in"
              type="target"
              position={Position.Left}
              className={handleClass}
              isConnectable={false}
            />
          </>
        )}
        <div className="mb-1 border-b border-white/10 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-dimmed">
            {node.kind}
          </span>
          <div
            className="break-words font-mono text-sm"
            style={{ color }}
          >
            {node.name}
          </div>
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
      </div>
    </>
  );
}
