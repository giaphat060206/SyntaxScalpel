# ELK Layout & Orthogonal Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled grid + `smoothstep` routing with Eclipse Layout Kernel (ELK) for both graphs: ELK positions nodes (hierarchically, compound containers) and returns orthogonal edge sections that a custom edge draws.

**Architecture:** A pure `elk/` module builds the ELK graph from React Flow nodes, applies ELK's result back to node positions/sizes and per-edge polylines, and runs ELK in a web worker with a main-thread and grid fallback. A custom `elk` edge draws the polylines.

**Tech Stack:** React 18 + TypeScript, `@xyflow/react`, `elkjs` (worker + bundled builds), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-elk-layout-design.md`

## Global Constraints

- Windows, PowerShell 5.1: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- ELK applies to **both** graphs (project + function).
- ELK owns placement; saved positions in `.scalpel/metadata.json` are neither read nor written by the UI; dragging is temporary.
- Fallback: node count > 1500, or any ELK error, reverts to the existing `reflowLayout` grid + `smoothstep` for that run.
- Worker first; if worker construction throws, run ELK on the main thread.
- No Rust changes; `load_layout`/`save_layout` stay in the codebase but become unused by the UI.
- Node visuals, palette colours, START badge, entry chip, selection dimming, lines toggle, collapse, breadcrumb, double-click drill-down, import card and markdown pane must not change.
- TypeScript strict with `noUnusedLocals`; `npm test` and `npm run build` must pass before each commit.

### File Structure

```
src/features/graph/elk/
  graph.ts        buildElkGraph(nodes, edges) -> hierarchical ElkGraph (pure)
  graph.test.ts
  result.ts       applyElkResult(nodes, elk) -> positions/sizes/absolute sections (pure)
  result.test.ts
  path.ts         sectionToPath(points) -> SVG path (pure)
  path.test.ts
  layout.ts       runElkLayout(nodes, edges) -> Promise<ElkLayoutResult | null> (worker + fallback)
  layout.test.ts
  ElkEdge.tsx     custom edge drawing ELK sections, smoothstep fallback
src/features/graph/GraphView.tsx        (modify) ELK integration, sections, elk edge type
src/features/project/ProjectGraph.tsx   (modify) ELK integration
src/features/shell/App.tsx              (modify) drop layout persistence props
src/features/shell/ContentPane.tsx      (modify) drop persistence props
src/features/graph/useLayoutAutosave.ts (delete)
```

---

### Task 1: ELK graph builder

**Files:**
- Create: `src/features/graph/elk/graph.ts`, `src/features/graph/elk/graph.test.ts`
- Modify: `package.json` (add `elkjs`)

**Interfaces:**
- Consumes: `Node`, `Edge` from `@xyflow/react`
- Produces: `ELK_OPTIONS: Record<string, string>`, `buildElkGraph(nodes: Node[], edges: Edge[]): ElkGraph` where

```ts
interface ElkGraphNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkGraphNode[];
  layoutOptions?: Record<string, string>;
}
interface ElkGraphEdge { id: string; sources: string[]; targets: string[]; }
interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkGraphNode[];
  edges: ElkGraphEdge[];
}
```

- [ ] **Step 1: Install the dependency**

```powershell
npm install elkjs
```

- [ ] **Step 2: Write the failing test**

Create `src/features/graph/elk/graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { buildElkGraph } from "./graph";

function node(
  id: string,
  extra: Partial<Node> = {}
): Node {
  return {
    id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    data: {},
    ...extra,
  };
}

describe("buildElkGraph", () => {
  it("nests children under their parent", () => {
    const nodes = [
      node("folder", { style: { width: 240 } }),
      node("folder/a.ts", { parentId: "folder", measured: { width: 180, height: 60 } }),
      node("folder/b.ts", { parentId: "folder", measured: { width: 180, height: 60 } }),
    ];
    const graph = buildElkGraph(nodes, []);
    expect(graph.children).toHaveLength(1);
    expect(graph.children[0].id).toBe("folder");
    expect(graph.children[0].children?.map((c) => c.id)).toEqual([
      "folder/a.ts",
      "folder/b.ts",
    ]);
    // Containers carry no size; ELK computes it.
    expect(graph.children[0].width).toBeUndefined();
  });

  it("sizes leaves from measured, falling back to style then a default", () => {
    const nodes = [
      node("measured", { measured: { width: 200, height: 44 } }),
      node("styled", { style: { width: 150 } }),
      node("plain"),
    ];
    const graph = buildElkGraph(nodes, []);
    const byId = new Map(graph.children.map((c) => [c.id, c]));
    expect(byId.get("measured")!.width).toBe(200);
    expect(byId.get("measured")!.height).toBe(44);
    expect(byId.get("styled")!.width).toBe(150);
    expect(byId.get("plain")!.width).toBe(180);
  });

  it("excludes hidden nodes and any edge touching them", () => {
    const nodes = [
      node("a"),
      node("b", { hidden: true }),
      node("c"),
    ];
    const edges: Edge[] = [
      { id: "a->b", source: "a", target: "b" },
      { id: "a->c", source: "a", target: "c" },
    ];
    const graph = buildElkGraph(nodes, edges);
    expect(graph.children.map((c) => c.id)).toEqual(["a", "c"]);
    expect(graph.edges.map((e) => e.id)).toEqual(["a->c"]);
  });

  it("sets orthogonal routing options", () => {
    const graph = buildElkGraph([node("a")], []);
    expect(graph.layoutOptions["elk.algorithm"]).toBe("layered");
    expect(graph.layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
    expect(graph.layoutOptions["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- elk/graph`
Expected: FAIL — cannot resolve `./graph`.

- [ ] **Step 4: Implement**

Create `src/features/graph/elk/graph.ts`:

```ts
import type { Edge, Node } from "@xyflow/react";

export interface ElkGraphNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkGraphNode[];
  layoutOptions?: Record<string, string>;
}

export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkGraphNode[];
  edges: ElkGraphEdge[];
}

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.nodeNode": "40",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  "elk.padding": "[top=40,left=20,bottom=20,right=20]",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 60;

function leafSize(node: Node): { width: number; height: number } {
  const styleWidth = (node.style as { width?: number } | undefined)?.width;
  const styleHeight = (node.style as { height?: number } | undefined)?.height;
  return {
    width: node.measured?.width ?? styleWidth ?? DEFAULT_WIDTH,
    height: node.measured?.height ?? styleHeight ?? DEFAULT_HEIGHT,
  };
}

export function buildElkGraph(nodes: Node[], edges: Edge[]): ElkGraph {
  const visible = nodes.filter((node) => !node.hidden);
  const byParent = new Map<string | null, Node[]>();
  for (const node of visible) {
    const key = node.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }

  const build = (parentId: string | null): ElkGraphNode[] =>
    (byParent.get(parentId) ?? []).map((node) => {
      const children = build(node.id);
      if (children.length > 0) {
        return {
          id: node.id,
          children,
          layoutOptions: {
            "elk.padding": "[top=40,left=20,bottom=20,right=20]",
          },
        };
      }
      const size = leafSize(node);
      return { id: node.id, width: size.width, height: size.height };
    });

  const visibleIds = new Set(visible.map((node) => node.id));
  return {
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: build(null),
    edges: edges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- elk/graph`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/features/graph/elk/graph.ts src/features/graph/elk/graph.test.ts
git commit -m "feat(ui): build a hierarchical ELK graph from flow nodes"
```

---

### Task 2: Apply the ELK result

**Files:**
- Create: `src/features/graph/elk/result.ts`, `src/features/graph/elk/result.test.ts`

**Interfaces:**
- Consumes: `Node` from `@xyflow/react`
- Produces:

```ts
interface ElkPoint { x: number; y: number }
interface ElkLayoutResult {
  positions: Record<string, ElkPoint>;   // parent-relative, as React Flow expects
  sizes: Record<string, { width: number; height: number }>;
  sections: Record<string, ElkPoint[]>;  // absolute polyline per edge id
}
function applyElkResult(nodes: Node[], elk: ElkResultLike): ElkLayoutResult;
```

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/elk/result.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { applyElkResult } from "./result";

function node(id: string, parentId?: string): Node {
  return {
    id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    data: {},
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
  };
}

const elkResult = {
  children: [
    {
      id: "folder",
      x: 100,
      y: 50,
      width: 300,
      height: 200,
      children: [
        { id: "folder/a.ts", x: 20, y: 40, width: 180, height: 60 },
        { id: "folder/b.ts", x: 20, y: 120, width: 180, height: 60 },
      ],
    },
    { id: "top.ts", x: 0, y: 0, width: 180, height: 60 },
  ],
  edges: [
    {
      id: "folder/a.ts->folder/b.ts",
      sources: ["folder/a.ts"],
      sections: [
        {
          startPoint: { x: 110, y: 100 },
          bendPoints: [{ x: 110, y: 150 }],
          endPoint: { x: 110, y: 170 },
        },
      ],
    },
  ],
};

describe("applyElkResult", () => {
  it("keeps node positions parent-relative", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    expect(result.positions["folder"]).toEqual({ x: 100, y: 50 });
    expect(result.positions["folder/a.ts"]).toEqual({ x: 20, y: 40 });
  });

  it("records container sizes only", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    expect(result.sizes["folder"]).toEqual({ width: 300, height: 200 });
  });

  it("converts sections to absolute coordinates through the source container", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    // folder is at (100,50); the section is relative to the folder's graph.
    expect(result.sections["folder/a.ts->folder/b.ts"]).toEqual([
      { x: 210, y: 150 },
      { x: 210, y: 200 },
      { x: 210, y: 220 },
    ]);
  });

  it("skips edges without sections", () => {
    const result = applyElkResult(
      [node("a"), node("b")],
      { children: [], edges: [{ id: "a->b", sources: ["a"], sections: [] }] }
    );
    expect(result.sections["a->b"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- elk/result`
Expected: FAIL — cannot resolve `./result`.

- [ ] **Step 3: Implement**

Create `src/features/graph/elk/result.ts`:

```ts
import type { Node } from "@xyflow/react";

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkLayoutResult {
  positions: Record<string, ElkPoint>;
  sizes: Record<string, { width: number; height: number }>;
  sections: Record<string, ElkPoint[]>;
}

interface ElkNodeLike {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNodeLike[];
}

interface ElkSectionLike {
  startPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  endPoint: ElkPoint;
}

interface ElkEdgeLike {
  id: string;
  sources?: string[];
  sections?: ElkSectionLike[];
}

export interface ElkResultLike {
  children?: ElkNodeLike[];
  edges?: ElkEdgeLike[];
}

/**
 * ELK reports a node's x/y relative to its parent, which is exactly what React
 * Flow expects for child nodes, so positions are copied straight through.
 * Edge sections, however, come in the coordinate space of the edge's container,
 * so they are shifted by the source node's absolute offset to be drawable.
 */
export function applyElkResult(nodes: Node[], elk: ElkResultLike): ElkLayoutResult {
  const positions: Record<string, ElkPoint> = {};
  const sizes: Record<string, { width: number; height: number }> = {};
  const absolute: Record<string, ElkPoint> = {};

  const walk = (children: ElkNodeLike[], parentAbsolute: ElkPoint) => {
    for (const child of children) {
      const here = {
        x: parentAbsolute.x + (child.x ?? 0),
        y: parentAbsolute.y + (child.y ?? 0),
      };
      absolute[child.id] = here;
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
      if (child.width !== undefined && child.height !== undefined) {
        sizes[child.id] = { width: child.width, height: child.height };
      }
      if (child.children?.length) {
        walk(child.children, here);
      }
    }
  };
  walk(elk.children ?? [], { x: 0, y: 0 });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sections: Record<string, ElkPoint[]> = {};
  for (const edge of elk.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) {
      continue;
    }
    const sourceId = edge.sources?.[0];
    const container = sourceId ? nodeById.get(sourceId)?.parentId : undefined;
    const offset = container ? absolute[container] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    sections[edge.id] = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
  }

  return { positions, sizes, sections };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- elk/result`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/elk/result.ts src/features/graph/elk/result.test.ts
git commit -m "feat(ui): apply ELK positions, sizes and edge sections"
```

---

### Task 3: Section to SVG path

**Files:**
- Create: `src/features/graph/elk/path.ts`, `src/features/graph/elk/path.test.ts`

**Interfaces:**
- Consumes: `ElkPoint` from `./result`
- Produces: `sectionToPath(points: ElkPoint[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/elk/path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sectionToPath } from "./path";

describe("sectionToPath", () => {
  it("returns an empty path for too few points", () => {
    expect(sectionToPath([])).toBe("");
    expect(sectionToPath([{ x: 1, y: 2 }])).toBe("");
  });

  it("draws a straight two-point section", () => {
    expect(sectionToPath([{ x: 10, y: 20 }, { x: 10, y: 90 }])).toBe(
      "M 10 20 L 10 90"
    );
  });

  it("draws an L-shaped section through its bend", () => {
    expect(
      sectionToPath([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 80, y: 40 },
      ])
    ).toBe("M 0 0 L 0 40 L 80 40");
  });

  it("draws every bend", () => {
    const path = sectionToPath([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(path).toBe("M 0 0 L 0 10 L 10 10 L 10 20");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- elk/path`
Expected: FAIL — cannot resolve `./path`.

- [ ] **Step 3: Implement**

Create `src/features/graph/elk/path.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- elk/path`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/elk/path.ts src/features/graph/elk/path.test.ts
git commit -m "feat(ui): turn ELK sections into SVG paths"
```

---

### Task 4: ELK runner (worker + fallback)

**Files:**
- Create: `src/features/graph/elk/layout.ts`, `src/features/graph/elk/layout.test.ts`

**Interfaces:**
- Consumes: `buildElkGraph`, `applyElkResult`, `Node`, `Edge`
- Produces:
  - `runElkLayout(nodes: Node[], edges: Edge[]): Promise<ElkLayoutResult | null>`
  - `__setElkLayoutForTests(layoutFn: ((graph: unknown) => Promise<unknown>) | null): void`

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/elk/layout.test.ts`:

```ts
import { afterEach, describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { __setElkLayoutForTests, runElkLayout } from "./layout";

function node(id: string): Node {
  return { id, type: "scalpel", position: { x: 0, y: 0 }, data: {} };
}

afterEach(() => __setElkLayoutForTests(null));

describe("runElkLayout", () => {
  it("returns null above the node cap", async () => {
    const nodes = Array.from({ length: 1501 }, (_, index) => node(`n${index}`));
    expect(await runElkLayout(nodes, [])).toBeNull();
  });

  it("returns null when the layout throws", async () => {
    __setElkLayoutForTests(async () => {
      throw new Error("boom");
    });
    expect(await runElkLayout([node("a")], [] as Edge[])).toBeNull();
  });

  it("maps a successful layout", async () => {
    __setElkLayoutForTests(async () => ({
      children: [{ id: "a", x: 5, y: 7, width: 180, height: 60 }],
      edges: [],
    }));
    const result = await runElkLayout([node("a")], []);
    expect(result?.positions.a).toEqual({ x: 5, y: 7 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- elk/layout`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Implement**

Create `src/features/graph/elk/layout.ts`:

```ts
import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk-api";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";
import { buildElkGraph } from "./graph";
import { applyElkResult, type ElkLayoutResult } from "./result";

const MAX_NODES = 1500;

type LayoutFn = (graph: unknown) => Promise<unknown>;

let elk: InstanceType<typeof ELK> | null = null;
let override: LayoutFn | null = null;

function getLayoutFn(): LayoutFn {
  if (override) {
    return override;
  }
  if (!elk) {
    try {
      elk = new ELK({ workerUrl });
    } catch {
      // Worker unavailable (older WebView, CSP): fall back to the main thread.
      elk = new ELK();
    }
  }
  return (graph) => elk!.layout(graph as never);
}

/** Test seam: replace the ELK call (pass null to restore the real one). */
export function __setElkLayoutForTests(layoutFn: LayoutFn | null): void {
  override = layoutFn;
}

export async function runElkLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<ElkLayoutResult | null> {
  if (nodes.filter((node) => !node.hidden).length > MAX_NODES) {
    return null;
  }
  try {
    const graph = buildElkGraph(nodes, edges);
    const result = await getLayoutFn()(graph);
    return applyElkResult(nodes, result as never);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- elk/layout`
Expected: 3 tests PASS.

If the `?url` import fails under Vitest, add `test: { server: { deps: { inline: ["elkjs"] } } }` to `vitest.config.ts` — but do not change the test's assertions.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/elk/layout.ts src/features/graph/elk/layout.test.ts
git commit -m "feat(ui): run ELK in a worker with a capped, failing-safe runner"
```

---

### Task 5: Custom ELK edge

**Files:**
- Create: `src/features/graph/elk/ElkEdge.tsx`

**Interfaces:**
- Consumes: `sectionToPath`, `BaseEdge`/`getSmoothStepPath` from `@xyflow/react`
- Produces: `ElkEdge` component reading `data.points` (absolute polyline); falls back to `smoothstep`

- [ ] **Step 1: Implement the component**

Create `src/features/graph/elk/ElkEdge.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify and commit**

Run: `npm run build`
Expected: succeeds (the component is unused until Task 6, which is fine for `tsc`).

```powershell
git add src/features/graph/elk/ElkEdge.tsx
git commit -m "feat(ui): add an edge component that draws ELK sections"
```

---

### Task 6: Integrate ELK into the function graph

**Files:**
- Modify: `src/features/graph/GraphView.tsx`

**Interfaces:**
- Consumes: `runElkLayout`, `ElkEdge`, `reflowLayout` (fallback), `type ElkLayoutResult`
- Produces: GraphView positions nodes via ELK, draws `elk` edges from sections, and re-runs ELK on Re-align

- [ ] **Step 1: Add the edge type and sections state**

At module level next to `nodeTypes`:

```tsx
const edgeTypes = { elk: ElkEdge };
```

Inside `GraphViewInner`:

```tsx
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
```

Pass `edgeTypes={edgeTypes}` to `<ReactFlow>`.

- [ ] **Step 2: Replace the grid reflow effect with the ELK effect**

Delete the existing `sizeSignature` debounce effect that calls `reflowLayout` and replace it with:

```tsx
  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}`)
    .join("|");

  // ELK owns placement: run it once the measured sizes settle, and again after a
  // Re-align. On any failure (or above the node cap) fall back to the old grid.
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await runElkLayout(nodes, edgesForLayout);
      if (cancelled) {
        return;
      }
      if (!result) {
        setSections({});
        setNodes((current) => reflowLayout(current));
        return;
      }
      setSections(result.sections);
      setNodes((current) =>
        current.map((node) => {
          const position = result.positions[node.id];
          const size = result.sizes[node.id];
          if (!position) {
            return node;
          }
          return {
            ...node,
            position,
            ...(size
              ? { style: { ...(node.style ?? {}), ...size } }
              : {}),
          };
        })
      );
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sizeSignature, layoutRun, result.filePath, setNodes]);
```

`edgesForLayout` is the current `edges` memo value; define it above this effect by moving the `edges` memo above it (it already sits just below — move the memo up so the effect can reference it, and add `sections` and `layoutRun` to the memo's dependency list).

- [ ] **Step 3: Draw the ELK edges**

In the edges memo change the edge shape to:

```tsx
        type: "elk",
        data: { points: sections[edge.id] },
```

and add `sections` to the memo deps. Keep `style` (colour, width, opacity), `markerEnd`, and the dim/bold-free rules exactly as they are. `pathOptions` and `...handles` are no longer needed for the path — remove them (the handles stay in `CodeNode` as invisible anchors).

- [ ] **Step 4: Re-align re-runs ELK**

In `handleRealign`, replace the rebuild-and-persist body with:

```tsx
    setMenu(null);
    setSections({});
    setLayoutRun((value) => value + 1);
```

(`onResetLayout` is removed in Task 8; keep the prop until then but stop calling it.)

- [ ] **Step 5: Verify**

Run: `npm test` then `npm run build`
Expected: 25+ tests pass (the four ELK suites included) and the build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/features/graph/GraphView.tsx
git commit -m "feat(ui): lay out the function graph with ELK and draw routed edges"
```

---

### Task 7: Integrate ELK into the project graph

**Files:**
- Modify: `src/features/project/ProjectGraph.tsx`

**Interfaces:**
- Same as Task 6, plus: collapse toggles and scope changes re-run ELK

- [ ] **Step 1: Add the edge type, sections state and layout token**

```tsx
const edgeTypes = { elk: ElkEdge };
```

Inside the component:

```tsx
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
```

Pass `edgeTypes={edgeTypes}` to `<ReactFlow>`.

- [ ] **Step 2: Replace the reflow effect**

Replace the `sizeSignature` reflow effect with the ELK effect, using the same body as Task 6 but with the project graph's dependencies:

```tsx
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await runElkLayout(nodes, edgesForLayout);
      if (cancelled) {
        return;
      }
      if (!result) {
        setSections({});
        setNodes((current) => reflowLayout(current));
        return;
      }
      setSections(result.sections);
      setNodes((current) =>
        current.map((node) => {
          const position = result.positions[node.id];
          const size = result.sizes[node.id];
          if (!position) {
            return node;
          }
          return {
            ...node,
            position,
            ...(size ? { style: { ...(node.style ?? {}), ...size } } : {}),
          };
        })
      );
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sizeSignature, layoutRun, collapsed, data, setNodes]);
```

Move the `edges` memo above this effect (it needs `sections`) and change its edges to `type: "elk"`, `data: { points: sections[edge.id] }`, dropping `pathOptions`/`spreadHandles` for the path; keep style/opacity/arrow rules. Add `sections` and `layoutRun` to its deps.

- [ ] **Step 3: Re-align re-runs ELK**

In `handleRealign`, replace the rebuild body with:

```tsx
    setMenu(null);
    setSections({});
    setLayoutRun((value) => value + 1);
```

- [ ] **Step 4: Verify**

Run: `npm test` then `npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/features/project/ProjectGraph.tsx
git commit -m "feat(ui): lay out the project graph with ELK and draw routed edges"
```

---

### Task 8: Remove layout persistence from the UI

**Files:**
- Modify: `src/features/shell/App.tsx`, `src/features/shell/ContentPane.tsx`, `src/features/graph/GraphView.tsx`
- Delete: `src/features/graph/useLayoutAutosave.ts`

**Interfaces:**
- Produces: no `onDragStop`/`onResetLayout` props; dragging a block no longer writes `.scalpel/metadata.json`

- [ ] **Step 1: Drop the autosave hook from the shell**

In `App.tsx` remove the `useLayoutAutosave` import and its call, remove `handleDragStop`, and stop passing `onDragStop` to `ContentPane`.

In `ContentPane.tsx` remove the `onDragStop` prop, the `saveLayout` import and `handleResetLayout`, and stop passing `onDragStop`/`onResetLayout` to `GraphView`.

In `GraphView.tsx` remove the `onDragStop`/`onResetLayout` props from `Props`, delete `handleDragStop` and the `onNodeDragStop` wiring, and delete `useLayoutAutosave.ts`.

- [ ] **Step 2: Verify nothing else references them**

Run:

```powershell
rg -n "useLayoutAutosave|onDragStop|onResetLayout|saveLayout" src
```
Expected: no matches (the Rust `save_layout` command is untouched and unused).

- [ ] **Step 3: Verify and commit**

Run: `npm test` then `npm run build`
Expected: all tests pass, build succeeds.

```powershell
git add -A src
git commit -m "refactor(ui): drop layout persistence from the UI (ELK owns layout)"
```

---

### Task 9: Verification and documentation

**Files:**
- Modify: `README.md` (features note), `docs/superpowers/specs/2026-09-29-elk-layout-design.md` (status line)

- [ ] **Step 1: Run all suites**

```powershell
npm test
if ($?) { npm run build }
if ($?) { cargo test --manifest-path src-tauri/Cargo.toml }
```
Expected: all pass (Rust unchanged: 73).

- [ ] **Step 2: Manual GUI checks** (report NOT RUN if headless)

- Open a folder: blocks are laid out by ELK with orthogonal, non-overlapping lines and arrows at the target.
- Collapse a folder: the graph re-lays out; the collapsed block shrinks.
- Re-align from the right-click menu: the graph re-runs ELK.
- Drag a block: it moves for the session; reopening the file/folder restores the ELK layout (no persistence).
- Start chip: clicking an entry still centres the viewport on it.
- Selection: dimming, lines toggle, transparency of endpoint containers still behave.
- Open a code file: the function graph is ELK-laid-out; imports/imported-by blocks and constants still render.
- A file with >1500 nodes: falls back to the grid layout without errors.

- [ ] **Step 3: Update docs**

- In `README.md`, note that layout is computed by ELK and that node positions are no longer persisted.
- In the design spec, change the status line to `Implemented (see plan 2026-09-29-elk-layout.md)`.

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/superpowers/specs/2026-09-29-elk-layout-design.md
git commit -m "docs: note ELK layout and dropped position persistence"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| D1 both graphs | 6, 7 |
| D2 ELK default placement, grid only as fallback | 6, 7 |
| D3/D5 no persistence, temporary drag | 8 |
| D4 Re-align re-runs ELK | 6, 7 |
| D6 custom edge with smoothstep fallback | 5 |
| D7 node cap + failure fallback | 4 (cap/failure), 6, 7 (apply fallback) |
| D8 worker with main-thread fallback | 4 |
| Hierarchical graph builder | 1 |
| Result application (positions/sizes/sections) | 2 |
| Path building | 3 |
| Testing | every task; final checks in 9 |

**Placeholder scan:** no TBD/TODO; each code step carries complete code. Task 6/7 reference `edgesForLayout`, defined in the same step by moving the existing memo.

**Type consistency:** `ElkPoint`/`ElkLayoutResult` come from `result.ts` and are used by `path.ts`, `ElkEdge.tsx`, `layout.ts` and both integration tasks. `buildElkGraph` output matches `applyElkResult`'s `ElkResultLike` (both `children` + `edges`). Edge `type: "elk"` matches the `edgeTypes` key in both components. `__setElkLayoutForTests` is used only by `layout.test.ts`.
