# SyntaxScalpel — ELK Layout & Orthogonal Routing — Design Spec

Date: 2026-09-29
Status: Approved design, pending implementation plan
Branch: `feature/elk-layout`

## 1. Overview

Both graphs currently place blocks with a hand-rolled near-square grid (`layout.ts`) and route edges with React Flow's `smoothstep`, which produces zig-zag detours and overlapping lines on dense graphs. This change replaces both with **Eclipse Layout Kernel (ELK)**:

- **Placement**: ELK's layered algorithm positions nodes and sizes compound containers (folders, classes), minimising crossings.
- **Routing**: ELK's `ORTHOGONAL` edge routing returns per-edge sections (start, bend points, end); a custom React Flow edge draws those sections so lines follow real channels instead of guessing.

## 2. Decisions

The user asked for "full ELK" and dismissed the follow-up questions, so these are the controller's rulings; each is recorded with its cost.

| # | Decision | Rationale | Cost if wrong |
|---|---|---|---|
| D1 | ELK applies to **both** the project graph and the function graph | One engine, consistent look; both currently share `layout.ts` | Function-graph layouts change noticeably (visual rework only) |
| D2 | ELK is the **default placement**; `reflowLayout` is retired from the render path (kept only as the D7 fallback) | Grid + ELK cannot both own positions | Losing the grid fallback; mitigated by D7 |
| D3 | **ELK owns placement.** Saved positions in `.scalpel/metadata.json` are no longer read by the UI, and node positions are no longer written to it | User's choice: "ELK owns layout, drag temporary" | The layout-persistence feature (original spec, Should Have) becomes unused by the UI; the Rust commands stay but are unused |
| D4 | The **Re-align** context-menu action re-runs ELK | Existing Re-align semantics ("original layout") now mean "ELK layout" | none |
| D5 | Dragging a block is **temporary** in both views: it moves the block for the session, and the next layout run (open, collapse, Re-align) puts it back | Consistent with D3 | Users lose manual arrangement across reloads |
| D6 | Edge geometry comes from **ELK sections** via a custom edge; when a section is missing the edge falls back to `smoothstep` | ELK always returns sections, but hidden nodes / collapsed containers can drop one | A few edges look like today |
| D7 | If ELK fails or the graph is too large (>1500 nodes), fall back to the existing `reflowLayout` grid and `smoothstep` | Never leave the user with an unlayouted graph | Large graphs keep today's look |
| D8 | ELK runs in a **web worker** (`elkjs` worker build); if worker construction fails, run on the main thread | Keeps the UI responsive | Layout takes ~100–500 ms on the main thread |

## 3. Architecture

```
src/features/graph/elk/
  graph.ts        buildElkGraph(nodes, edges)      -> ElkNode (pure, tested)
  result.ts       applyElkResult(nodes, result)    -> { nodes, sections } (pure, tested)
  path.ts         sectionToPath(sections)          -> SVG path string (pure, tested)
  worker.ts       elk worker bootstrap
  layout.ts       runElkLayout(nodes, edges, opts) -> Promise<ElkLayoutResult> (worker + fallback)
  ElkEdge.tsx     custom edge drawing ELK sections (falls back to smoothstep)
```

### 3.1 Input graph (`graph.ts`)

- Nodes are grouped by `parentId` into a **hierarchical** ELK graph (`hierarchyHandling: INCLUDE_CHILDREN`).
- Leaf nodes carry measured `width`/`height` (from `node.measured`, with the existing natural-width estimate as fallback).
- Container nodes (class, folder) carry no size; ELK computes it from children plus `padding`.
- Nodes with `hidden: true` (collapsed descendants) are **excluded**, together with their edges.
- Edges reference node ids; edges whose endpoints are excluded are dropped.

### 3.2 ELK options

```ts
{
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
}
```

### 3.3 Result application (`result.ts`)

- ELK returns, per node, `x`/`y` **relative to its parent** (compound semantics) plus a computed size for containers.
- Apply: `node.position = { x, y }`; for containers set `style.width/height`; keep `parentId`/`extent` so React Flow still nests them.
- Per edge, ELK returns `sections: [{ startPoint, endPoint, bendPoints[] }]` in the coordinate space of the edge's owning graph. Sections are normalised to **absolute** coordinates in `result.ts` (walk the ancestor chain, adding each parent's position) so the custom edge can draw without knowing nesting.
- Output shape:

```ts
interface ElkLayoutResult {
  positions: Record<string, { x: number; y: number }>;
  sizes: Record<string, { width: number; height: number }>;
  sections: Record<string, { x: number; y: number }[]>; // absolute polyline per edge id
}
```

### 3.4 Path building (`path.ts`)

`sectionToPath(points)` → `"M x0 y0 L x1 y1 …"` with a small corner radius applied by `elk.layered` bend points; no smoothing needed since ELK already produces orthogonal channels. A final short segment is added toward the target so the arrow marker lands on the block edge.

### 3.5 Custom edge (`ElkEdge.tsx`)

- Reads its polyline from `edge.data.points` (injected by the render layer from `sections`).
- Renders `<path d={sectionToPath(points)} />` plus `markerEnd` (arrow), using the same colour/opacity/bold rules as today (source palette colour, dim on unrelated selection, hidden when the lines toggle is off).
- Falls back to `getSmoothStepPath` when `points` is missing.
- `interactionWidth` kept small so thin lines stay clickable.

### 3.6 Integration

Both `GraphView` and `ProjectGraph`:

1. Build nodes/edges as today (unchanged extraction, colours, handles kept but hidden — they are no longer used for routing).
2. After measurement settles (existing debounced `sizeSignature`), call `runElkLayout`.
3. Apply the result: `setNodes(applyPositions(current, result))`; store `sections` in state; edges memo injects `data.points` and `type: "elk"`.
4. Collapse (project graph) and Re-align re-run ELK.
5. After layout, the existing entry-point centring runs (it already waits for measurement).
6. If ELK fails or node count > 1500: keep current positions and use `reflowLayout` + `smoothstep` (D7).
7. The drag-autosave hook (`useLayoutAutosave`) and the saved-layout read are removed from the render path (D3); `onNodeDragStop` only stops the drag, it no longer writes metadata.

## 4. Behaviour that must not change

- Node visuals, palette colours, START badge, entry chip and its click-to-centre.
- Selection semantics: dim unrelated blocks/lines, bold-free edges, lines toggle, transparency of endpoint containers.
- Collapse/expand, breadcrumb navigation, double-click drill-down, import card, markdown pane, split view.
- No Rust changes.

### Behaviour that changes (by decision)

- Layout persistence is no longer used by the UI (D3): `.scalpel/metadata.json` is neither read nor written for node positions. The Rust `load_layout`/`save_layout` commands remain in the codebase but are unused; removing them is a follow-up, not part of this change.
- Dragging is temporary (D5).

## 5. Performance

- Worker build of `elkjs`; results cached per `(nodes signature, edges signature)` so pan/zoom/selection never re-runs ELK.
- Re-run triggers: file/folder change, collapse toggle, Re-align, and the first settled measurement.
- Guard: skip ELK above 1500 nodes (D7).

## 6. Testing

- `graph.ts`: hierarchical children, hidden nodes and their edges excluded, sizes taken from `measured` with estimate fallback, container padding.
- `result.ts`: parent-relative → absolute coordinate normalisation across two nesting levels; sizes applied to containers only; sections keyed by edge id.
- `path.ts`: path string for a straight two-point section, an L-shaped three-point section, and a section with several bends.
- `layout.ts`: falls back to the main thread when worker construction throws (inject a fake worker factory).
- Manual GUI checks listed in the plan's final task.

## 7. Out of scope

- Rust-side changes of any kind.
- Layout persistence for the project graph (still session-only).
- Editing ELK options from the UI (fixed preset, one constant).
- Incremental ELK layout (full re-run per trigger, guarded by the node cap).
