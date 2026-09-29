import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProjectGraph as ProjectGraphData } from "../../shared/types";
import { projectGraph } from "../../shared/ipc";
import { colorForNode } from "../graph/colors";
import { CodeNode, type CodeNodeData } from "../graph/CodeNode";
import { CLASS_WIDTH, pickHandles, reflowLayout } from "../graph/layout";
import { EmptyState, ErrorState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };

interface Props {
  root: string;
  scope: string;
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

function toNodes(
  data: ProjectGraphData,
  collapsed: Set<string>,
  onToggleCollapse: (id: string) => void
): Node[] {
  const hidden = new Set<string>();
  for (const folder of data.folders) {
    let parent = folder.parentId;
    while (parent) {
      if (collapsed.has(parent)) {
        hidden.add(folder.id);
        break;
      }
      parent = data.folders.find((f) => f.id === parent)?.parentId;
    }
  }
  for (const file of data.files) {
    if (collapsed.has(file.folderId)) {
      hidden.add(file.id);
    }
  }

  const folderNodes: Node[] = data.folders.map((folder) => ({
    id: folder.id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    parentId: folder.parentId,
    extent: folder.parentId ? ("parent" as const) : undefined,
    draggable: false,
    hidden: hidden.has(folder.id),
    style: { width: folder.parentId ? undefined : CLASS_WIDTH },
    data: {
      project: {
        kind: "folder",
        name: folder.name,
        collapsed: collapsed.has(folder.id),
      },
      color: colorForNode(folder.id),
      onToggleCollapse,
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  }));

  const fileNodes: Node[] = data.files.map((file) => ({
    id: file.id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    parentId: file.folderId,
    extent: "parent" as const,
    draggable: false,
    hidden: hidden.has(file.id),
    style: { width: 180 },
    data: {
      project: { kind: "file", name: file.name, imports: file.imports },
      color: colorForNode(file.id),
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  }));

  return [...folderNodes, ...fileNodes];
}

export function ProjectGraph({ root, scope, onNavigate }: Props) {
  return (
    <ReactFlowProvider>
      <ProjectGraphInner root={root} scope={scope} onNavigate={onNavigate} />
    </ReactFlowProvider>
  );
}

function ProjectGraphInner({ root, scope, onNavigate }: Props) {
  const [data, setData] = useState<ProjectGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setCollapsed(new Set());
    projectGraph(root, scope)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [root, scope]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    setNodes(toNodes(data, collapsed, toggleCollapse));
  }, [data, collapsed, toggleCollapse, setNodes]);

  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}:${node.hidden ? 1 : 0}`)
    .join("|");
  useEffect(() => {
    setNodes((current) => reflowLayout(current));
  }, [sizeSignature, setNodes]);

  const edges: Edge[] = useMemo(() => {
    if (!data) {
      return [];
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return data.edges
      .filter((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return source && target && !source.hidden && !target.hidden;
      })
      .map((edge) => {
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        const active =
          selectedId !== null &&
          (edge.source === selectedId || edge.target === selectedId);
        const unrelated = selectedId !== null && !active;
        const stroke =
          (source.data as CodeNodeData).color ?? "#00F0FF";
        return {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: "step",
          ...pickHandles(source, target, byId),
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: active ? 20 : 16,
            height: active ? 16 : 16,
          },
          style: {
            stroke,
            strokeWidth: active ? 5 : 2,
            opacity: unrelated ? 0.12 : 1,
          },
        };
      });
  }, [data, nodes, selectedId]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedId(node.id);
  }, []);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.id === scope) {
        return;
      }
      const kind = data?.folders.some((folder) => folder.id === node.id)
        ? "folder"
        : "code";
      onNavigate({ kind, path: node.id });
    },
    [data, onNavigate, scope]
  );

  const selectedFile =
    data && selectedId
      ? data.files.find((file) => file.id === selectedId)
      : undefined;

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!data) {
    return <EmptyState message="Loading project…" />;
  }
  if (data.files.length === 0) {
    return <EmptyState message="No source files in this folder" />;
  }

  return (
    <div className="relative h-full bg-bg" onContextMenu={(event) => event.preventDefault()}>
      {data.truncated && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
          Large project: only the first 2000 files are shown
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => setSelectedId(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2A3138" gap={20} />
        <Controls />
      </ReactFlow>

      {selectedFile && (
        <div className="absolute right-3 top-3 z-20 max-h-[60%] w-80 overflow-auto rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
          <div className="break-words font-mono text-sm text-accent">
            {selectedFile.name}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Imports
          </div>
          {selectedFile.imports.length === 0 ? (
            <div className="font-mono text-white/80">none</div>
          ) : (
            selectedFile.imports.map((entry, index) => (
              <div key={index} className="break-words font-mono text-white/85">
                {entry.targetId || entry.specifier}
                {entry.names.length > 0 ? `: ${entry.names.join(", ")}` : ""}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
