import { useCallback, useEffect } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, LayoutMap, ParseResult } from "../../shared/types";
import { buildFlow, type FlowEdge, type FlowNode } from "./flow";
import { traceNeighbors } from "./trace";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { EmptyState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };

function visibilityOf(id: string, edges: GraphEdge[], selectedId: string | null) {
  const traced = selectedId ? traceNeighbors(edges, selectedId) : null;
  return {
    highlighted: traced ? traced.has(id) : false,
    dimmed: traced ? !traced.has(id) : false,
  };
}

function toFlowNode(node: FlowNode, selectedId: string | null, edges: GraphEdge[]): Node {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    parentId: node.parentId,
    extent: node.extent,
    style: node.style,
    draggable: node.data.node.kind !== "class",
    data: {
      node: node.data.node,
      ...visibilityOf(node.id, edges, selectedId),
    } satisfies CodeNodeData,
  };
}

function toFlowEdge(edge: FlowEdge, selectedId: string | null): Edge {
  const active =
    selectedId !== null && (edge.source === selectedId || edge.target === selectedId);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    style: { stroke: active ? "#3DF0A8" : "#00F0FF", strokeWidth: 2 },
  };
}

interface Props {
  result: ParseResult;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDragStop: (positions: LayoutMap) => void;
}

export function GraphView({ result, selectedId, onSelect, onDragStop }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Rebuild the flow whenever a different file is parsed.
  useEffect(() => {
    const flow = buildFlow(result);
    setNodes(flow.nodes.map((node) => toFlowNode(node, null, result.edges)));
    setEdges(flow.edges.map((edge) => toFlowEdge(edge, null)));
  }, [result, setNodes, setEdges]);

  // Re-decorate for trace highlighting without touching positions the user dragged.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, ...visibilityOf(node.id, result.edges, selectedId) },
      }))
    );
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        style: {
          stroke:
            selectedId !== null &&
            (edge.source === selectedId || edge.target === selectedId)
              ? "#3DF0A8"
              : "#00F0FF",
          strokeWidth: 2,
        },
      }))
    );
  }, [selectedId, result.edges, setNodes, setEdges]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => onSelect(node.id),
    [onSelect]
  );

  const handleDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      // Save the FULL layout, not just the dragged node. `save_layout` replaces the
      // entry for this file, so sending one node would erase every other node's
      // saved position on the next open.
      const positions: LayoutMap = {};
      for (const current of nodes) {
        const position = current.id === node.id ? node.position : current.position;
        positions[current.id] = { x: position.x, y: position.y };
      }
      onDragStop(positions);
    },
    [nodes, onDragStop]
  );

  if (result.nodes.length === 0) {
    return <EmptyState message="No functions detected" />;
  }

  return (
    <div className="relative h-full bg-bg">
      {result.nodes.length > 5000 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
          Large file: {result.nodes.length} nodes — performance may degrade
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleDragStop}
        onPaneClick={() => onSelect(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2A3138" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
