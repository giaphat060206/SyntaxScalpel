# Frontend Module Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the two graph canvases and the shell loaders so the ELK lifecycle, node construction, and async loading each sit behind one small, testable interface.

**Architecture:** A single `useGraphCanvas` hook owns React Flow + ELK lifecycle, viewport, context menu, and styled-edge construction; the two graphs become thin adapters that build domain Nodes/Edges. Node construction moves into pure `graph/nodes.ts` / `project/nodes.ts`. The shell's three hand-rolled loaders collapse into one `useAsyncLoad<T>`.

**Tech Stack:** React 18 + TypeScript (strict, `noUnusedLocals`), `@xyflow/react` v12, `elkjs`, Vitest, Tailwind.

**Specs:** `GLOSSARY.md` (Graph Canvas, Node, Block, Edge, Selection, Trace, Focus), `docs/adr/0001-single-file-function-graphs.md`, `docs/adr/0002-no-layout-persistence.md`, `docs/adr/0003-elk-owns-layout-and-routing.md`.

## Global Constraints

- Windows, PowerShell 5.1: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- No comments unless asked; no new libraries.
- Keep the component tree stable across UI toggles — React Flow must never remount (ADR-0003; graph bugs came from remounts/reflows).
- ELK owns placement and routing; no layout persistence; `.scalpel/metadata.json` is neither read nor written (ADR-0002).
- Every hook runs before any early return (**Rules of Hooks**).
- React Flow v12: controlled `nodes`/`edges`, wire `onNodesChange`; do not pass the `fitView` prop when centring programmatically.
- `npm test` and `npm run build` must pass before each commit.
- Rust untouched by this plan.

### File Structure

```
src/features/graph/
  canvas/useGraphCanvas.ts     (new) React Flow + ELK lifecycle, viewport, menu, styled edges
  canvas/useGraphCanvas.test.tsx (new)
  nodes.ts                     (new) pure buildFunctionNodes / decorateFunctionNodes
  nodes.test.ts                (new)
  flow.ts                      absorbed then deleted (Task 5)
  GraphView.tsx                (modify) thin adapter over the canvas + nodes
  layout.ts                    (modify) delete dead helpers (Task 1)
src/features/project/
  nodes.ts                     (new) pure buildProjectNodes / decorateProjectNodes + shared folderChain
  nodes.test.ts                (new)
  selection.ts                 (modify) use the shared folderChain helper
  ProjectGraph.tsx             (modify) thin adapter
src/features/shell/
  useAsyncLoad.ts              (new) generic loader
  useAsyncLoad.test.tsx        (new)
  useFileContent.ts            (modify) thin adapter
  useImports.ts                (modify) thin adapter
  useSource.ts                 (new) thin adapter
  ContentPane.tsx              (modify) consume useSource
```

---

### Task 1: Delete the dead layout helpers

**Files:**
- Modify: `src/features/graph/layout.ts` (delete `absolutePosition`, `pickHandles`, `spreadHandles`)
- Modify: `src/features/graph/layout.test.ts` (delete the `pickHandles`/`spreadHandles` describes)

**Interfaces:**
- Produces: `layout.ts` exports only `nodeHeight`, `arrangeGrid`, `reflowLayout` (plus constants), all still consumed by both graphs.

- [ ] **Step 1: Confirm the exports have no production caller**

Run: `rg -n "pickHandles|spreadHandles|absolutePosition" src`
Expected: matches only in `layout.ts` and `layout.test.ts`.

- [ ] **Step 2: Delete the functions**

Remove `absolutePosition` (lines ~24–39), `pickHandles` (~41–75), and `spreadHandles` (~80–109) from `layout.ts`. Keep `nodeHeight`, `arrangeGrid`, `reflowLayout` and every constant they use.

- [ ] **Step 3: Delete their tests**

Remove the `describe("pickHandles", …)` and `describe("spreadHandles", …)` blocks from `layout.test.ts`, and drop `pickHandles`/`spreadHandles` from its import (line 3).

- [ ] **Step 4: Verify and commit**

Run: `npm test` then `npm run build`
Expected: all pass; build succeeds with `noUnusedLocals`.

```powershell
git add src/features/graph/layout.ts src/features/graph/layout.test.ts
git commit -m "refactor(ui): delete dead handle-layout helpers"
```

---

### Task 2: `useGraphCanvas` — the canvas module

**Files:**
- Create: `src/features/graph/canvas/useGraphCanvas.ts`
- Create: `src/features/graph/canvas/useGraphCanvas.test.tsx`

**Interfaces:**
- Consumes: `runElkLayout` (default layout), `reflowLayout` (fallback), `ElkEdge`, `CodeNode`.
- Produces:

```ts
export interface DomainEdge { id: string; source: string; target: string; }
export type EdgeVisibility = "active" | "dim" | "hidden";
export interface CanvasMenuItem { label: string; onSelect: () => void; tone?: "mint"; }

export interface GraphCanvasConfig {
  nodes: Node[];
  edges: DomainEdge[];
  selection: unknown;
  layoutKey: string;
  fit: { token: string; target?: string; padding?: number };
  edgeVisibility: (edge: DomainEdge, selection: unknown) => EdgeVisibility;
  menuItems?: CanvasMenuItem[];
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onPaneClick?: () => void;
  layout?: (nodes: Node[], edges: Edge[]) => Promise<import("../elk/result").ElkLayoutResult | null>;
}

export interface GraphCanvas {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  showLines: boolean;
  toggleLines: () => void;
  menu: { x: number; y: number } | null;
  menuNodeId: string | null;
  openMenu: (event: ReactMouseEvent | globalThis.MouseEvent, nodeId?: string) => void;
  closeMenu: () => void;
  realign: () => void;
  fitView: () => void;
  centerOn: (id: string, zoom: number, duration: number) => boolean;
  lastRun: number;
}

export function useGraphCanvas(config: GraphCanvasConfig): GraphCanvas;
```

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/canvas/useGraphCanvas.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Node, Edge } from "@xyflow/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useGraphCanvas, type DomainEdge } from "./useGraphCanvas";

const edge: DomainEdge = { id: "a->b", source: "a", target: "b" };

function node(id: string): Node {
  return { id, type: "scalpel", position: { x: 0, y: 0 }, data: {} };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe("useGraphCanvas", () => {
  it("runs the injected layout once per layoutKey and applies positions", async () => {
    const layout = vi.fn(async () => ({
      positions: { a: { x: 10, y: 20 } },
      sizes: {},
      sections: {},
    }));
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a")],
          edges: [edge],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper }
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(layout).toHaveBeenCalledTimes(1);
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({ x: 10, y: 20 });
  });

  it("falls back to the grid when layout returns null", async () => {
    const layout = vi.fn(async () => null);
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), node("b")],
          edges: [],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper }
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(result.current.nodes.every((n) => n.position.y >= 0)).toBe(true);
  });

  it("builds edges with the injected visibility", () => {
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), node("b")],
          edges: [edge],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "hidden",
          layout: async () => null,
        }),
      { wrapper }
    );
    expect(result.current.edges[0].style?.opacity).toBe(0);
    expect(result.current.edges[0].zIndex).toBe(0);
  });

  it("ignores a stale layout result after the layoutKey changes", async () => {
    let release: () => void = () => {};
    const first = new Promise<void>((resolve) => (release = resolve));
    const layout = vi.fn()
      .mockImplementationOnce(async () => {
        await first;
        return { positions: { a: { x: 99, y: 99 } }, sizes: {}, sections: {} };
      })
      .mockImplementationOnce(async () => ({
        positions: { a: { x: 1, y: 1 } },
        sizes: {},
        sections: {},
      }));
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useGraphCanvas({
          nodes: [node("a")],
          edges: [],
          selection: null,
          layoutKey: key,
          fit: { token: key },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper, initialProps: { key: "one" } }
    );
    rerender({ key: "two" });
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({ x: 1, y: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useGraphCanvas`
Expected: FAIL — cannot resolve `./useGraphCanvas`.

- [ ] **Step 3: Implement the hook**

Create `src/features/graph/canvas/useGraphCanvas.ts`. The key invariants: seed `useNodesState` from the `nodes` prop and re-seed only when the prop identity changes; guard layout with a generation counter so a superseded `layoutKey` never applies; apply `sections` to edges; own `showLines`, menu, fit, and `centerOn`.

```ts
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
export interface CanvasMenuItem { label: string; onSelect: () => void; tone?: "mint"; }

type LayoutFn = (nodes: Node[], edges: Edge[]) => Promise<ElkLayoutResult | null>;

export interface GraphCanvasConfig {
  nodes: Node[];
  edges: DomainEdge[];
  selection: unknown;
  layoutKey: string;
  fit: { token: string; target?: string; padding?: number };
  edgeVisibility: (edge: DomainEdge, selection: unknown) => EdgeVisibility;
  menuItems?: CanvasMenuItem[];
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onPaneClick?: () => void;
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
  lastRun: number;
}

export function useGraphCanvas(config: GraphCanvasConfig): GraphCanvas {
  const { nodes: builtNodes, edges: domainEdges, selection, layoutKey, fit, edgeVisibility } = config;
  const layout = config.layout ?? runElkLayout;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
  const [showLines, setShowLines] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const { fitView, getInternalNode, setCenter } = useReactFlow();
  const lastLayoutKey = useRef("");
  const lastFit = useRef("");
  const generation = useRef(0);

  useEffect(() => {
    setNodes(builtNodes.map((node) => ({ ...node })));
  }, [builtNodes, setNodes]);

  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return domainEdges.map((edge) => {
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

  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}:${node.hidden ? 1 : 0}`)
    .join("|");

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }
    const myGeneration = ++generation.current;
    const timer = window.setTimeout(async () => {
      const result = await layout(nodes, edges);
      if (myGeneration !== generation.current) {
        return;
      }
      if (!result) {
        setSections({});
        setNodes((current) => reflowLayout(current));
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
    }, 160);
    return () => window.clearTimeout(timer);
  }, [sizeSignature, layoutRun, layoutKey, layout, edges, nodes, setNodes]);

  const centerOn = useCallback(
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

  useEffect(() => {
    if (lastFit.current === fit.token || nodes.length === 0) {
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const focused = fit.target && attempts >= 2 ? centerOn(fit.target, 1.1, 0) : false;
      if (focused || attempts >= 40) {
        lastFit.current = fit.token;
        if (!focused) {
          fitView({ padding: fit.padding ?? 0.2, duration: 0 });
        }
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [fit.token, fit.target, fit.padding, sizeSignature, nodes.length, centerOn, fitView]);

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
    lastRun: layoutRun,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useGraphCanvas`
Expected: 4 tests PASS. If `@testing-library/react` is absent, run `npm install -D @testing-library/react jsdom` and set `test.environment = "jsdom"` in `vitest.config.ts`; do not change the assertions.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/canvas/useGraphCanvas.ts src/features/graph/canvas/useGraphCanvas.test.tsx vitest.config.ts package.json package-lock.json
git commit -m "feat(ui): add a deep graph-canvas module owning layout, viewport and edges"
```

---

### Task 3: Convert `GraphView` to an adapter

**Files:**
- Modify: `src/features/graph/GraphView.tsx`

**Interfaces:**
- Consumes: `useGraphCanvas`, and (until Task 5) the existing `buildFlow`/`toFlowNode`/`specialFlowNodes` helpers.
- Produces: `GraphView` props unchanged (`result`, `imports`, `selectedId`, `onSelect`); the component only builds nodes and wires events.

- [ ] **Step 1: Build the node list and pass it to the canvas**

In `GraphViewInner`, keep the current node-building effect (lines 204–262) but replace `setNodes(...)` with a `useState<Node[]>` the effect writes to. Replace the decorate effect (268–275) with a `useMemo` producing decorated nodes from the rebuilt nodes + `activeSelectedId`. Then call:

```tsx
const canvas = useGraphCanvas({
  nodes: decoratedNodes,
  edges: result.edges.map((edge) => ({ ...edge, id: `${edge.source}->${edge.target}` })),
  selection: activeSelectedId,
  layoutKey: `${result.filePath}|${imports ? imports.imports.length : "none"}`,
  fit: { token: `${result.filePath}|${imports ? imports.imports.length : "none"}` },
  edgeVisibility: (edge, selected) => {
    if (selected === null) return "active";
    return edge.source === selected || edge.target === selected ? "active" : "dim";
  },
  onNodeClick: (id) => onSelect(id),
  onHover: setHoveredId,
  onPaneClick: () => onSelect(null),
});
```

- [ ] **Step 2: Render from the canvas**

Replace the `<ReactFlow>` block with one driven by `canvas.nodes`, `canvas.edges`, `canvas.onNodesChange`, `canvas.openMenu`; remove the `fitView` prop; wire `onNodeMouseEnter/Leave` to `canvas`-provided hover via `onHover` (already set) and remove the now-unused `handleNodeClick`, `handleNodeMouseEnter/Leave`, `handleRealign`, `handleFitView`, `centerOn`, and their state (`sections`, `layoutRun`, `lastFit`, `lastLayoutKey`). Keep `activeGraph`/info card, the lines toggle button (call `canvas.toggleLines`), `GraphSearch`, and the context menu overlay (render `canvas.menu`, `canvas.menuItems` are not needed here beyond Re-align/Fit).

- [ ] **Step 3: Re-align and fit from the canvas menu**

The context menu's "Re-align nodes" calls `canvas.realign`; "Fit view" calls `canvas.fitView`. Search-pick centring calls `canvas.centerOn(id, 1.2, 400)`.

- [ ] **Step 4: Verify and commit**

Run: `npm test` then `npm run build`
Expected: all pass; graphs render, selection/trace, lines toggle, info card, and context menu behave as before.

```powershell
git add src/features/graph/GraphView.tsx
git commit -m "refactor(ui): make GraphView a thin adapter over useGraphCanvas"
```

---

### Task 4: Convert `ProjectGraph` to an adapter

**Files:**
- Modify: `src/features/project/ProjectGraph.tsx`

**Interfaces:**
- Consumes: `useGraphCanvas`, `toNodes` (until Task 6), `selectionInfo`.
- Produces: `ProjectGraph` props unchanged (`root`, `scope`, `onNavigate`).

- [ ] **Step 1: Pass built nodes and project edges to the canvas**

Keep the data-fetch effect (175–192) and `toggleCollapse`. Build a decorated node list from `toNodes` + the collapse/selection effect (now a `useMemo`). Then:

```tsx
const canvas = useGraphCanvas({
  nodes: decoratedNodes,
  edges: data?.edges ?? [],
  selection: activeSelectedId,
  layoutKey: `${scope}|${collapsed.size}`,
  fit: { token: `${root}|${scope}`, target: data?.entry ?? undefined },
  edgeVisibility: (edge, selected) => {
    const selection = selected && data ? selectionInfo(data, selected as string) : null;
    const focus = selection?.focus ?? null;
    if (!focus) return "active";
    return focus.has(edge.source) || focus.has(edge.target) ? "active" : "dim";
  },
  menuItems: menuNodeId && menuNodeId !== data?.root ? [{
    label: data?.folders.some((f) => f.id === menuNodeId) ? "Open folder graph" : "Open file graph",
    tone: "mint",
    onSelect: handleOpenFromMenu,
  }] : undefined,
  onNodeClick: (id) => setSelectedId(id),
  onNodeDoubleClick: handleNodeDoubleClick,
  onPaneClick: () => setSelectedId(null),
});
```

- [ ] **Step 2: Render from the canvas**

Replace the `<ReactFlow>` block with one driven by the canvas; remove `sections`, `layoutRun`, `layoutVersion`, `lastFit`, `lastLayoutKey`, the ELK effect, the build effect, the collapse effect, `centerOn`, `handleRealign`, `handleFitView`, and the Escape effect. Keep the Start panel (using `canvas.centerOn` via `focusEntry`), the truncated banner, the selected-file info card, `GraphSearch`, and `handleNodeDoubleClick`'s domain logic.

- [ ] **Step 3: Context menu from the canvas**

Render the overlay from `canvas.menu`; "Re-align nodes" → `canvas.realign`; "Fit view" → `canvas.fitView`; the open-graph item comes from `canvas.menuItems`.

- [ ] **Step 4: Verify and commit**

Run: `npm test` then `npm run build`
Expected: all pass; entry centring, collapse, drill-down, info card, and menu behave as before.

```powershell
git add src/features/project/ProjectGraph.tsx
git commit -m "refactor(ui): make ProjectGraph a thin adapter over useGraphCanvas"
```

---

### Task 5: Pure function-node builders

**Files:**
- Create: `src/features/graph/nodes.ts`, `src/features/graph/nodes.test.ts`
- Delete: `src/features/graph/flow.ts`, `src/features/graph/flow.test.ts`
- Modify: `src/features/graph/GraphView.tsx`

**Interfaces:**
- Consumes: `ParseResult`, `ImportAnalysis`, `GraphEdge`, `GraphNode`, `CodeNodeData`.
- Produces:

```ts
export function buildFunctionNodes(result: ParseResult, imports: ImportAnalysis | null | undefined): Node[];
export function decorateFunctionNodes(nodes: Node[], edges: GraphEdge[], selectedId: string | null): Node[];
```

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/nodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFunctionNodes, decorateFunctionNodes } from "./nodes";
import type { ParseResult } from "../../shared/types";

const result: ParseResult = {
  filePath: "a.py",
  nodes: [
    { id: "Cls", kind: "class", name: "Cls", params: [], returns: [], uses: [] },
    { id: "Cls.m", kind: "method", name: "m", params: [], returns: [], uses: [], parent: "Cls" },
    { id: "V", kind: "variable", name: "V", params: [], returns: [], uses: [], value: "1" },
    { id: "f", kind: "function", name: "f", params: ["x"], returns: [], uses: [] },
  ],
  edges: [{ source: "f", target: "Cls.m" }],
};

describe("buildFunctionNodes", () => {
  it("groups variables under a CONSTANTS container", () => {
    const nodes = buildFunctionNodes(result, null);
    const constants = nodes.find((n) => n.id === "__constants");
    expect(constants).toBeDefined();
    expect(nodes.find((n) => n.id === "V")?.parentId).toBe("__constants");
  });

  it("marks classes owning an edge endpoint as transparent", () => {
    const nodes = buildFunctionNodes(result, null);
    expect((nodes.find((n) => n.id === "Cls")?.data as { transparent?: boolean }).transparent).toBe(true);
  });

  it("appends IMPORTS and IMPORTED BY special blocks when analysis is present", () => {
    const nodes = buildFunctionNodes(result, { imports: [], importedBy: [] });
    expect(nodes.map((n) => n.id)).toContain("__imports");
    expect(nodes.map((n) => n.id)).toContain("__importedBy");
  });
});

describe("decorateFunctionNodes", () => {
  it("highlights the 1-hop trace and dims the rest", () => {
    const nodes = decorateFunctionNodes(buildFunctionNodes(result, null), result.edges, "f");
    expect((nodes.find((n) => n.id === "f")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "Cls.m")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "V")?.data as { dimmed: boolean }).dimmed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- graph/nodes`
Expected: FAIL — cannot resolve `./nodes`.

- [ ] **Step 3: Implement by moving `flow.ts` + `GraphView`'s helpers**

Move `naturalWidth`, `graphNodeLines`, `specialFlowNodes`, `visibilityOf`, `toFlowNode`, the constants container construction, and `endpointParents` from `GraphView.tsx` into `nodes.ts`. `buildFunctionNodes` composes special blocks + constants container + children + others (the current effect body). `decorateFunctionNodes` maps `visibilityOf` over the nodes using `traceNeighbors`. Delete `flow.ts`/`flow.test.ts`; port its meaningful assertions (parent nesting, variable handling) into `nodes.test.ts`.

- [ ] **Step 4: Update GraphView to consume the builders**

Replace the inline effect with `useMemo(() => decorateFunctionNodes(buildFunctionNodes(result, imports), result.edges, activeSelectedId), [result, imports, activeSelectedId])` and feed the result to `useGraphCanvas`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -A src/features/graph
git commit -m "refactor(ui): extract pure function-node builders from GraphView"
```

---

### Task 6: Pure project-node builders and the shared folder chain

**Files:**
- Create: `src/features/project/nodes.ts`, `src/features/project/nodes.test.ts`
- Modify: `src/features/project/selection.ts`, `src/features/project/ProjectGraph.tsx`

**Interfaces:**
- Consumes: `ProjectGraph` (data), `hiddenIds`, `selectionInfo`.
- Produces:

```ts
export function folderChain(folderId: string, folderById: Map<string, ProjectGraphFolder>): string[];
export function buildProjectNodes(data: ProjectGraph, collapsed: Set<string>, onToggleCollapse: (id: string) => void): Node[];
export function decorateProjectNodes(nodes: Node[], data: ProjectGraph, collapsed: Set<string>, selectedId: string | null): Node[];
```

- [ ] **Step 1: Write the failing test**

Create `src/features/project/nodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { folderChain, buildProjectNodes, decorateProjectNodes } from "./nodes";
import type { ProjectGraph } from "../../shared/types";

const data: ProjectGraph = {
  root: ".",
  truncated: false,
  folders: [
    { id: ".", name: "root", depth: 0 },
    { id: "src", name: "src", parentId: ".", depth: 1 },
  ],
  files: [
    { id: "src/a.ts", name: "a.ts", folderId: "src", kind: "code", imports: [] },
    { id: "src/b.ts", name: "b.ts", folderId: "src", kind: "code", imports: [{ targetId: "src/a.ts", specifier: "./a", names: ["x"] }] },
  ],
  edges: [{ source: "src/b.ts", target: "src/a.ts" }],
  entry: "src/b.ts",
  entries: ["src/b.ts"],
};

describe("folderChain", () => {
  it("walks parents to the root", () => {
    const byId = new Map(data.folders.map((f) => [f.id, f]));
    expect(folderChain("src", byId)).toEqual(["src", "."]);
  });
});

describe("buildProjectNodes", () => {
  it("renders files and nested folders but not the scope root", () => {
    const nodes = buildProjectNodes(data, new Set(), () => {});
    expect(nodes.map((n) => n.id).sort()).toEqual(["src", "src/a.ts", "src/b.ts"]);
  });

  it("mints entry files and greys external ones", () => {
    const nodes = buildProjectNodes(data, new Set(), () => {});
    expect((nodes.find((n) => n.id === "src/b.ts")?.data as { color: string }).color).toBe("#3DF0A8");
  });
});

describe("decorateProjectNodes", () => {
  it("hides descendants of a collapsed folder", () => {
    const nodes = decorateProjectNodes(buildProjectNodes(data, new Set(["src"]), () => {}), data, new Set(["src"]), null);
    expect(nodes.find((n) => n.id === "src/a.ts")?.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- project/nodes`
Expected: FAIL — cannot resolve `./nodes`.

- [ ] **Step 3: Implement by moving `toNodes` and sharing the chain walk**

Move `toNodes` from `ProjectGraph.tsx` and split into `buildProjectNodes` (structure/colour) and `decorateProjectNodes` (hidden/highlight/dim/collapsed). Extract the parent walk as `folderChain`; rewrite `selection.ts`'s `addFolderChain` to call it.

- [ ] **Step 4: Update ProjectGraph to consume the builders**

Replace `toNodes` + the collapse/selection effect with a `useMemo` calling `decorateProjectNodes(buildProjectNodes(data, collapsed, toggleCollapse), data, collapsed, activeSelectedId)` and feed it to `useGraphCanvas`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add -A src/features/project
git commit -m "refactor(ui): extract pure project-node builders and share folderChain"
```

---

### Task 7: One loader for the shell

**Files:**
- Create: `src/features/shell/useAsyncLoad.ts`, `src/features/shell/useAsyncLoad.test.tsx`, `src/features/shell/useSource.ts`
- Modify: `src/features/shell/useFileContent.ts`, `src/features/shell/useImports.ts`, `src/features/shell/ContentPane.tsx`

**Interfaces:**
- Produces:

```ts
export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

export function useAsyncLoad<T>(key: string | null, load: (() => Promise<T>) | null): LoadState<T>;
```

- [ ] **Step 1: Write the failing test**

Create `src/features/shell/useAsyncLoad.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncLoad } from "./useAsyncLoad";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("useAsyncLoad", () => {
  it("is idle when the key is null", () => {
    const { result } = renderHook(() => useAsyncLoad(null, null));
    expect(result.current.status).toBe("idle");
  });

  it("goes loading then ready", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncLoad("k", () => d.promise));
    expect(result.current.status).toBe("loading");
    await act(async () => d.resolve("hi"));
    expect(result.current).toEqual({ status: "ready", value: "hi" });
  });

  it("captures the error message", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncLoad("k", () => d.promise));
    await act(async () => d.reject(new Error("nope")));
    expect(result.current).toEqual({ status: "error", message: "Error: nope" });
  });

  it("drops a stale resolve after the key changes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncLoad(key, () => (key === "one" ? first.promise : second.promise)),
      { initialProps: { key: "one" } }
    );
    rerender({ key: "two" });
    await act(async () => first.resolve("old"));
    expect(result.current.status).toBe("loading");
    await act(async () => second.resolve("new"));
    expect(result.current).toEqual({ status: "ready", value: "new" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useAsyncLoad`
Expected: FAIL — cannot resolve `./useAsyncLoad`.

- [ ] **Step 3: Implement `useAsyncLoad`**

Create `src/features/shell/useAsyncLoad.ts`:

```ts
import { useEffect, useState } from "react";

export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

export function useAsyncLoad<T>(
  key: string | null,
  load: (() => Promise<T>) | null
): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "idle" });

  useEffect(() => {
    if (key === null || load === null) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    load()
      .then((value) => {
        if (!cancelled) {
          setState({ status: "ready", value });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, load]);

  return state;
}
```

- [ ] **Step 4: Rewrite the three adapters**

`useSource.ts`:

```ts
import { useCallback } from "react";
import { readFile } from "../../shared/ipc";
import { useAsyncLoad } from "./useAsyncLoad";

export function useSource(root: string | null, filePath: string | null, enabled: boolean): string | null {
  const load = useCallback(
    () => (root && filePath ? readFile(filePath, root) : Promise.resolve("")),
    [root, filePath]
  );
  const state = useAsyncLoad(enabled && filePath ? `${root}|${filePath}` : null, enabled ? load : null);
  return state.status === "ready" ? state.value : null;
}
```

`useFileContent.ts` keeps its `FileState` return but maps a `useAsyncLoad<FileState-ready>`: compute the route, pass `null` when unsupported, and build the `load` thunk with `parsePython`/`parseJsTs`/`readMarkdown`. `useImports.ts` maps to `T | null`, passing `null` for non-code routes. Both use `useCallback` for the thunk so `useAsyncLoad`'s dependency is stable.

- [ ] **Step 5: Update `ContentPane`**

Remove the inline `source` effect and state; call `const source = useSource(root, filePath, state.status === "graph");`. Keep the rest of the render.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add -A src/features/shell
git commit -m "refactor(ui): collapse the shell loaders into one useAsyncLoad"
```

---

## Self-Review

**Spec coverage:**

| Deepening | Task |
|---|---|
| #3 delete dead helpers | 1 |
| #1 canvas module | 2, 3, 4 |
| #2 node builders | 5, 6 |
| #4 loader | 7 |

**Placeholder scan:** no TBD/TODO; every new pure module carries test + implementation code. Component conversions (Tasks 3, 4) are described as exact deletions/replacements against the named line ranges rather than re-pasting the whole render, because they preserve existing JSX.

**Type consistency:** `DomainEdge`, `EdgeVisibility`, `CanvasMenuItem`, `GraphCanvas`, `GraphCanvasConfig` are defined once in Task 2 and consumed in Tasks 3–4. `buildFunctionNodes`/`decorateFunctionNodes` match Task 5's consumer. `folderChain`/`buildProjectNodes`/`decorateProjectNodes` match Task 6's consumer and `selection.ts`. `LoadState<T>` is defined once in Task 7 and consumed by the three adapters. Node ids `__constants`, `__imports`, `__importedBy` match the existing `layout.ts` constants.
