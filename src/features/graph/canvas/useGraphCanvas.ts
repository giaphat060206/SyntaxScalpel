import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  MarkerType,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type OnNodesChange,
} from "@xyflow/react";
import type { CodeNodeData } from "../CodeNode";
import { reflowLayout } from "../layout";
import { runElkLayout } from "../elk/layout";
import type { ElkLayoutResult } from "../elk/result";

export interface DomainEdge { id: string; source: string; target: string; }
export type EdgeVisibility = "active" | "dim" | "hidden";

type LayoutFn = (nodes: Node[], edges: Edge[]) => Promise<ElkLayoutResult | null>;

export interface GraphCanvasConfig {
  nodes: Node[];
  edges: DomainEdge[];
  selection: unknown;
  layoutKey: string;
  fit: { token: string; target?: string; padding?: number };
  edgeVisibility: (edge: DomainEdge, selection: unknown) => EdgeVisibility;
  layout?: LayoutFn;
}

export interface GraphCanvas {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  showLines: boolean;
  toggleLines: () => void;
  menu: { x: number; y: number } | null;
  menuNodeId: string | null;
  openMenu: (event: ReactMouseEvent | globalThis.MouseEvent, nodeId?: string) => void;
  closeMenu: () => void;
  realign: () => void;
  fitView: () => void;
  centerOn: (id: string, zoom: number, duration: number) => boolean;
  focusNode: (id: string) => boolean;
  zoomToNode: (id: string) => boolean;
  lastRun: number;
}

function nodeSignature(nodes: Node[]): string {
  try {
    return nodes
      .map((node) =>
        JSON.stringify([
          node.id,
          node.type ?? null,
          node.parentId ?? null,
          node.hidden ?? false,
          node.draggable ?? true,
          node.zIndex ?? null,
          node.style ?? null,
          node.data ?? null,
        ])
      )
      .join("|");
  } catch {
    return `!${nodes.map((node) => node.id).join(",")}`;
  }
}

function mergeNode(incoming: Node, existing: Node | undefined): Node {
  if (!existing) {
    return { ...incoming };
  }
  const style = { ...(incoming.style ?? {}) };
  if (existing.style) {
    if ("width" in existing.style) style.width = existing.style.width;
    if ("height" in existing.style) style.height = existing.style.height;
  }
  return {
    ...incoming,
    position: existing.position,
    measured: existing.measured,
    style,
  };
}

export function useGraphCanvas(config: GraphCanvasConfig): GraphCanvas {
  const { nodes: builtNodes, edges: domainEdges, selection, layoutKey, fit, edgeVisibility } = config;
  const layout = config.layout ?? runElkLayout;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [showLines, setShowLines] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const { fitView, fitBounds, getInternalNode, setCenter, getZoom } = useReactFlow();
  const lastLayoutKey = useRef("");
  const lastFit = useRef("");
  const lastBuiltSignature = useRef<string | null>(null);
  const generation = useRef(0);
  const timers = useRef<Set<number>>(new Set());

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    []
  );

  useEffect(() => {
    const signature = nodeSignature(builtNodes);
    if (lastBuiltSignature.current === signature) {
      return;
    }
    lastBuiltSignature.current = signature;
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      const merged = builtNodes.map((incoming) =>
        mergeNode(incoming, byId.get(incoming.id))
      );
      // Seed the grid only for a genuinely different graph: every container is
      // built at the origin, so a fresh graph would otherwise paint stacked on
      // one point. A selection change only reskins the same nodes (new
      // `data`), and re-gridding those would visibly jump them off the layout.
      const sameNodes =
        current.length === merged.length &&
        merged.every((node) => byId.has(node.id));
      return sameNodes ? merged : reflowLayout(merged);
    });
  }, [builtNodes, setNodes]);

  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return domainEdges
      .filter((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return Boolean(source && target && !source.hidden && !target.hidden);
      })
      .map((edge) => {
      const visibility = edgeVisibility(edge, selection);
      const source = byId.get(edge.source);
      const stroke = (source?.data as CodeNodeData | undefined)?.color ?? "#00F0FF";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "elk",
        data: { points: sections[edge.id] },
        zIndex: 0,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
        style: {
          stroke,
          strokeWidth: 2,
          opacity: visibility === "hidden" ? 0 : visibility === "dim" ? 0.12 : showLines ? 0.7 : 0,
        },
      };
    });
  }, [domainEdges, nodes, selection, sections, showLines, edgeVisibility]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}:${node.hidden ? 1 : 0}`)
    .join("|");

  const activeLayoutKey = useRef(layoutKey);
  activeLayoutKey.current = layoutKey;

  useEffect(() => {
    if (nodesRef.current.length === 0) {
      return;
    }
    const effectLayoutKey = layoutKey;
    const myGeneration = ++generation.current;
    const timer = window.setTimeout(async () => {
      timers.current.delete(timer);
      const result = await layout(nodesRef.current, edgesRef.current);
      if (myGeneration !== generation.current) {
        return;
      }
      if (!result) {
        setSections({});
        setNodes((current) => reflowLayout(current));
        setLayoutVersion((value) => value + 1);
        return;
      }
      const key = `${layoutKey}|${layoutRun}|${sizeSignature}`;
      if (lastLayoutKey.current === key) {
        return;
      }
      lastLayoutKey.current = key;
      setSections(result.sections);
      setNodes((current) =>
        current.map((node) => {
          const position = result.positions[node.id];
          if (!position) {
            return node;
          }
          const size = result.sizes[node.id];
          return { ...node, position, ...(size ? { style: { ...(node.style ?? {}), ...size } } : {}) };
        })
      );
      setLayoutVersion((value) => value + 1);
    }, 160);
    timers.current.add(timer);
    return () => {
      if (activeLayoutKey.current === effectLayoutKey) {
        window.clearTimeout(timer);
        timers.current.delete(timer);
      }
    };
  }, [sizeSignature, layoutRun, layoutKey, layout, setNodes]);

  const centerOnRaw = useCallback(
    (id: string, zoom: number, duration: number): boolean => {
      const internals = getInternalNode(id);
      if (!internals) {
        return false;
      }
      const { positionAbsolute, userNode } = internals.internals;
      const width = userNode.measured?.width ?? 0;
      const height = userNode.measured?.height ?? 0;
      if (width === 0 || height === 0) {
        return false;
      }
      setCenter(positionAbsolute.x + width / 2, positionAbsolute.y + height / 2, { zoom, duration });
      return true;
    },
    [getInternalNode, setCenter]
  );

  // Navigation the user asked for; a layout that lands later must not undo it.
  const userMoved = useRef(false);
  const centerOn = useCallback(
    (id: string, zoom: number, duration: number) => {
      userMoved.current = true;
      return centerOnRaw(id, zoom, duration);
    },
    [centerOnRaw]
  );

  const focusNode = useCallback(
    (id: string) => centerOn(id, getZoom(), 400),
    [centerOn, getZoom]
  );

  const zoomToNode = useCallback(
    (id: string) => {
      const internals = getInternalNode(id);
      if (!internals) {
        return false;
      }
      const { positionAbsolute, userNode } = internals.internals;
      const width = userNode.measured?.width ?? 0;
      const height = userNode.measured?.height ?? 0;
      if (width === 0 || height === 0) {
        return false;
      }
      userMoved.current = true;
      fitBounds(
        { x: positionAbsolute.x, y: positionAbsolute.y, width, height },
        { padding: 0.2, duration: 400 }
      );
      return true;
    },
    [fitBounds, getInternalNode]
  );

  const fittedToken = useRef("");
  useEffect(() => {
    userMoved.current = false;
  }, [fit.token]);

  const fitKey = `${fit.token}|${layoutVersion}`;
  useEffect(() => {
    if (lastFit.current === fitKey || nodes.length === 0) {
      return;
    }
    // A layout that finishes after the user moved the viewport may refine
    // positions, but re-centring here would yank them back to the entry file.
    if (fittedToken.current === fit.token && userMoved.current) {
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const focused = fit.target && attempts >= 2 ? centerOnRaw(fit.target, 1.1, 0) : false;
      if (focused || attempts >= 40) {
        lastFit.current = fitKey;
        fittedToken.current = fit.token;
        userMoved.current = false;
        if (!focused) {
          fitView({ padding: fit.padding ?? 0.2, duration: 0 });
        }
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [fitKey, fit.target, fit.padding, sizeSignature, nodes.length, centerOnRaw, fitView]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setMenuNodeId(null);
  }, []);
  const openMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent, nodeId?: string) => {
      event.preventDefault();
      setMenuNodeId(nodeId ?? null);
      setMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );
  const realign = useCallback(() => {
    setMenu(null);
    setSections({});
    setLayoutRun((value) => value + 1);
  }, []);
  const fitAll = useCallback(() => {
    setMenu(null);
    fitView({ padding: fit.padding ?? 0.2 });
  }, [fit.padding, fitView]);
  const toggleLines = useCallback(() => setShowLines((value) => !value), []);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, closeMenu]);

  return {
    nodes,
    edges,
    onNodesChange,
    showLines,
    toggleLines,
    menu,
    menuNodeId,
    openMenu,
    closeMenu,
    realign,
    fitView: fitAll,
    centerOn,
    focusNode,
    zoomToNode,
    lastRun: layoutRun,
  };
}
