# SyntaxScalpel MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Tauri desktop app that parses Python and JS/TS source files into interactive React Flow call graphs and renders Markdown docs side by side.

**Architecture:** Tauri v2 shell. Rust backend reads files and uses Tree-sitter to emit a language-agnostic `{nodes, edges}` payload; React frontend renders it with React Flow or renders raw Markdown. All graph assembly happens in Rust; the frontend never understands language syntax.

**Tech Stack:** Tauri v2, Rust (tree-sitter, tree-sitter-python, tree-sitter-typescript, serde, serde_json), React 18 + TypeScript, Vite, Tailwind CSS v3.4, @xyflow/react (React Flow), react-markdown, remark-gfm, rehype-highlight, react-resizable-panels, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md`

## Global Constraints

- OS: Windows (win32). Shell: PowerShell 5.1. Do not use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Tauri v2; WebView2 assumed present.
- Theme tokens (Tailwind): bg `#1E2329`, panel `#161B20`, accent `#00F0FF`, highlight/mint `#3DF0A8`, dimmed text `#8A93A0`.
- All Rust IPC structs derive `serde::Serialize` with `#[serde(rename_all = "camelCase")]`. Without this, values cannot cross the IPC boundary.
- Node ids: `name` (function), `ClassName` (class), `ClassName.method` (method), `varName.method` (JS object method).
- Edges are in-file calls only. Class names are never edge targets. No self-edges. No edges for imports, builtins, or callbacks.
- `save_layout` fires from `onNodeDragStop` ONLY — never `onNodesChange` (fires per pixel, thrashes disk). Debounce 500 ms as defense-in-depth.
- All Tauri commands return `Result<T, String>`; never panic.
- Layout file: `<projectRoot>/.scalpel/metadata.json`, keyed by project-relative path. A save replaces that file's entry, so the frontend must send positions for **all** nodes in the file, not just the dragged one.
- Unsupported extension → toast "Unsupported file type".
- Commit after every task. Never commit secrets.

### File Structure

```
src-tauri/src/
  main.rs                  entrypoint (template)
  lib.rs                   Tauri builder + command registration
  models.rs                GraphNode, GraphEdge, ParseResult, Position, NodeKind (serde)
  commands/mod.rs          re-exports
  commands/fs_cmds.rs      list_directory, read_markdown
  commands/layout.rs       load_layout, save_layout (+ .scalpel/metadata.json I/O)
  commands/parse.rs        parse_python, parse_js_ts
  parser/mod.rs            shared Def/helpers + dispatch helpers
  parser/python.rs         Python extraction
  parser/jsts.rs           JS/TS extraction
src/
  main.tsx                     React entrypoint
  index.css                    Tailwind + theme
  shared/
    types.ts                   payload types (GraphNode, ParseResult, LayoutMap)
    ipc.ts                     typed invoke wrappers
    extensions.ts              extension → route
    extensions.test.ts
    StateViews.tsx             ErrorState + EmptyState
  features/
    explorer/
      FileExplorer.tsx
    graph/
      GraphView.tsx            React Flow canvas
      CodeNode.tsx             custom node (function/class/method)
      flow.ts                  ParseResult → React Flow nodes/edges
      flow.test.ts
      trace.ts                 1-hop trace set
      trace.test.ts
      useLayoutAutosave.ts     onNodeDragStop → debounced save_layout
    markdown/
      MarkdownView.tsx
    shell/
      App.tsx                  root component + panel layout + file state
      ContentPane.tsx
      useFileContent.ts        load by extension (loading/error/graph/markdown)
```

Feature folders group code that changes together: graph rendering logic lives with the graph, markdown with markdown, the explorer with the explorer. `shared/` holds the cross-feature kernel (payload types, IPC wrappers, extension routing, state views).

---

### Task 1: Scaffold the Tauri + React project

**Files:**
- Create: entire `src-tauri/`, `src/`, `package.json`, `vite.config.ts`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `vitest.config.ts` (via scaffold + edits)

**Interfaces:**
- Consumes: nothing
- Produces: a building Tauri app; `npm run build`, `cargo test`, and `npm test` all runnable.

- [ ] **Step 1: Scaffold into a temp dir, then move into the repo**

The repo root is non-empty (`logo/`, `docs/`), so scaffold elsewhere first.

```powershell
$tmp = "C:\Users\THISPC~1\AppData\Local\Temp\opencode\scalpel-scaffold"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
npm create tauri-app@latest scalpel-scaffold --prefix $tmp -- --template react-ts --manager npm --identifier com.syntaxscalpel.app --yes
Copy-Item -Recurse -Force "$tmp\scalpel-scaffold\*" "D:\College\Personal Projects\SyntaxScalper\"
Remove-Item -Recurse -Force $tmp
```

**Fallback if that command errors:** `create-tauri-app` flag support varies by version. If `--prefix`, `--identifier`, or `--yes` is rejected, do it in two steps instead:

```powershell
$tmp = "C:\Users\THISPC~1\AppData\Local\Temp\opencode\scalpel-scaffold"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
npm create tauri-app@latest scalpel-scaffold -- --template react-ts --manager npm
```

Run that with the shell's working directory set to `$tmp` (pass `workdir`), answer prompts for identifier `com.syntaxscalpel.app`, then copy the generated contents into the repo root and delete `$tmp` as above. After scaffolding, open `src-tauri/tauri.conf.json` and confirm `"identifier": "com.syntaxscalpel.app"`; set it if the tool skipped it.

- [ ] **Step 2: Install JS dependencies**

```powershell
npm install
npm install @xyflow/react react-resizable-panels react-markdown remark-gfm rehype-highlight highlight.js @tauri-apps/plugin-dialog
npm install -D tailwindcss@3.4.17 postcss autoprefixer vitest
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind theme**

Replace `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1E2329",
        panel: "#161B20",
        accent: "#00F0FF",
        mint: "#3DF0A8",
        dimmed: "#8A93A0",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
```

- [ ] **Step 4: Install the typography plugin and write theme CSS**

```powershell
npm install -D @tailwindcss/typography
```

Replace `src/index.css` (or whatever global stylesheet the template created — keep only one and import it in `main.tsx`; delete `src/App.css` if present and remove its import):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  background: #1E2329;
  color: #FFFFFF;
}
```

- [ ] **Step 5: Add Vitest config and a test script**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Add to `package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 6: Verify everything builds and tests run**

```powershell
npm run build
if ($?) { npm test }
if ($?) { cargo test --manifest-path src-tauri/Cargo.toml }
```

Expected: all succeed. `npm test` reports "No test files found" is acceptable at this stage only if exit code is 0; if it errors, add `passWithNoTests: true` under `test` in `vitest.config.ts`.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: scaffold Tauri v2 + React + TS + Tailwind"
```

---

### Task 2: Rust data models

**Files:**
- Create: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod models;`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pub enum NodeKind { Function, Class, Method }` (Clone, PartialEq, Debug, Serialize, JSON lowercase)
  - `pub struct Position { pub x: f64, pub y: f64 }`
  - `pub struct GraphNode { pub id: String, pub kind: NodeKind, pub name: String, pub params: Vec<String>, pub returns: Vec<String>, pub parent: Option<String>, pub position: Option<Position> }`
  - `pub struct GraphEdge { pub source: String, pub target: String }`
  - `pub struct ParseResult { pub nodes: Vec<GraphNode>, pub edges: Vec<GraphEdge>, pub file_path: String }`

- [ ] **Step 1: Add dependencies**

```powershell
cargo add tree-sitter@0.25 tree-sitter-python@0.23 tree-sitter-typescript@0.23 serde --features derive serde_json --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Write the failing test**

Append to `src-tauri/src/models.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Function,
    Class,
    Method,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub params: Vec<String>,
    pub returns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub file_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node() -> GraphNode {
        GraphNode {
            id: "Greeter.greet".into(),
            kind: NodeKind::Method,
            name: "greet".into(),
            params: vec!["self".into(), "name".into()],
            returns: vec!["name".into()],
            parent: Some("Greeter".into()),
            position: None,
        }
    }

    #[test]
    fn graph_node_serializes_camel_case_and_lowercase_kind() {
        let json = serde_json::to_value(sample_node()).unwrap();
        assert_eq!(json["id"], "Greeter.greet");
        assert_eq!(json["kind"], "method");
        assert_eq!(json["params"][0], "self");
        assert_eq!(json["parent"], "Greeter");
        assert!(json.get("position").is_none());
    }

    #[test]
    fn graph_node_includes_position_when_set() {
        let mut node = sample_node();
        node.position = Some(Position { x: 10.0, y: 20.0 });
        let json = serde_json::to_value(node).unwrap();
        assert_eq!(json["position"]["x"], 10.0);
        assert_eq!(json["position"]["y"], 20.0);
    }

    #[test]
    fn parse_result_uses_camel_case_file_path() {
        let result = ParseResult {
            nodes: vec![],
            edges: vec![],
            file_path: "src/main.py".into(),
        };
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["filePath"], "src/main.py");
        assert_eq!(json["nodes"], serde_json::json!([]));
    }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml models`
Expected: 3 tests PASS. (This task is serialization-only; the test file is written together with the types because Rust requires the types to compile the test.)

- [ ] **Step 4: Register the module**

Add `mod models;` at the top of `src-tauri/src/lib.rs`.

- [ ] **Step 5: Verify the project still compiles**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, no warnings about unused `models`.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/models.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add serde-serializable graph payload models"
```

---

### Task 3: Frontend payload types + extension routing

**Files:**
- Create: `src/shared/types.ts`, `src/shared/extensions.ts`, `src/shared/extensions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `types.ts`: `NodeKind`, `Position`, `GraphNode`, `GraphEdge`, `ParseResult`, `LayoutMap = Record<string, Position>`
  - `routeForExtension(name: string): FileRoute` where `FileRoute = "python" | "jsts" | "markdown" | "unsupported"`

- [ ] **Step 1: Write the failing test**

Create `src/shared/extensions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routeForExtension } from "./extensions";

describe("routeForExtension", () => {
  it("routes python files", () => {
    expect(routeForExtension("main.py")).toBe("python");
  });

  it("routes js and ts variants", () => {
    expect(routeForExtension("a.js")).toBe("jsts");
    expect(routeForExtension("a.jsx")).toBe("jsts");
    expect(routeForExtension("a.ts")).toBe("jsts");
    expect(routeForExtension("a.tsx")).toBe("jsts");
  });

  it("routes markdown", () => {
    expect(routeForExtension("README.md")).toBe("markdown");
  });

  it("is case insensitive and handles multi-dot names", () => {
    expect(routeForExtension("Main.PY")).toBe("python");
    expect(routeForExtension("notes.v2.md")).toBe("markdown");
  });

  it("returns unsupported for unknown or extensionless names", () => {
    expect(routeForExtension("Makefile")).toBe("unsupported");
    expect(routeForExtension("style.css")).toBe("unsupported");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extensions`
Expected: FAIL — cannot resolve `./extensions`.

- [ ] **Step 3: Write `src/shared/types.ts` and `src/shared/extensions.ts`**

Create `src/shared/types.ts`:

```ts
export type NodeKind = "function" | "class" | "method";

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  params: string[];
  returns: string[];
  parent?: string;
  position?: Position;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filePath: string;
}

export type LayoutMap = Record<string, Position>;
```

Create `src/shared/extensions.ts`:

```ts
export type FileRoute = "python" | "jsts" | "markdown" | "unsupported";

export function routeForExtension(name: string): FileRoute {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "unsupported";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "py") return "python";
  if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") return "jsts";
  if (ext === "md") return "markdown";
  return "unsupported";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extensions`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/extensions.ts src/shared/extensions.test.ts
git commit -m "feat(ui): add payload types and extension routing"
```

---

### Task 4: 1-hop trace logic

**Files:**
- Create: `src/features/graph/trace.ts`, `src/features/graph/trace.test.ts`

**Interfaces:**
- Consumes: `GraphEdge` from `src/shared/types.ts`
- Produces: `traceNeighbors(edges: GraphEdge[], nodeId: string): Set<string>` — the node plus its direct callers and callees.

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/trace.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { traceNeighbors } from "./trace";
import type { GraphEdge } from "../../shared/types";

const edges: GraphEdge[] = [
  { source: "main", target: "add" },
  { source: "main", target: "helper" },
  { source: "other", target: "main" },
  { source: "unrelated", target: "isolated" },
];

describe("traceNeighbors", () => {
  it("includes the node itself plus direct callees and callers", () => {
    const result = traceNeighbors(edges, "main");
    expect([...result].sort()).toEqual(["add", "helper", "main", "other"]);
  });

  it("does not include 2-hop nodes", () => {
    const result = traceNeighbors(edges, "add");
    expect([...result].sort()).toEqual(["add", "main"]);
  });

  it("returns only the node when it has no edges", () => {
    expect([...traceNeighbors(edges, "far")]).toEqual(["far"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trace`
Expected: FAIL — cannot resolve `./trace`.

- [ ] **Step 3: Write the implementation**

Create `src/features/graph/trace.ts`:

```ts
import type { GraphEdge } from "../../shared/types";

export function traceNeighbors(edges: GraphEdge[], nodeId: string): Set<string> {
  const hits = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) hits.add(edge.target);
    if (edge.target === nodeId) hits.add(edge.source);
  }
  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- trace`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/trace.ts src/features/graph/trace.test.ts
git commit -m "feat(ui): add 1-hop neighbor trace"
```

---

### Task 5: ParseResult → React Flow mapping

**Files:**
- Create: `src/features/graph/flow.ts`, `src/features/graph/flow.test.ts`

**Interfaces:**
- Consumes: `ParseResult`, `GraphNode`, `GraphEdge` from `src/shared/types.ts`
- Produces:
  - `interface FlowNode { id: string; type: "scalpel"; position: Position; parentId?: string; extent?: "parent"; data: { node: GraphNode }; style?: { width: number; height: number } }`
  - `interface FlowEdge { id: string; source: string; target: string; type: "step" }`
  - `buildFlow(result: ParseResult): { nodes: FlowNode[]; edges: FlowEdge[] }`

Rules: use `node.position` when present, else auto-layout — top-level nodes in a single column (`x: 0`, `y: 130 * index`); class methods stacked inside their class (`x: 20`, `y: 50 + 90 * index`), class node height `60 + 90 * methodCount`.

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/flow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFlow } from "./flow";
import type { ParseResult } from "../../shared/types";

const result: ParseResult = {
  filePath: "src/main.py",
  nodes: [
    { id: "helper", kind: "function", name: "helper", params: [], returns: [] },
    { id: "Greeter", kind: "class", name: "Greeter", params: [], returns: [] },
    {
      id: "Greeter.greet",
      kind: "method",
      name: "greet",
      params: ["self"],
      returns: [],
      parent: "Greeter",
    },
  ],
  edges: [{ source: "Greeter.greet", target: "helper" }],
};

describe("buildFlow", () => {
  it("makes method nodes children of their class with parent extent", () => {
    const { nodes } = buildFlow(result);
    const method = nodes.find((n) => n.id === "Greeter.greet")!;
    expect(method.parentId).toBe("Greeter");
    expect(method.extent).toBe("parent");
  });

  it("sizes the class node to fit its methods", () => {
    const { nodes } = buildFlow(result);
    const cls = nodes.find((n) => n.id === "Greeter")!;
    expect(cls.style).toEqual({ width: 240, height: 150 });
  });

  it("auto-lays out top-level nodes in a column when no saved position", () => {
    const { nodes } = buildFlow(result);
    const helper = nodes.find((n) => n.id === "helper")!;
    const cls = nodes.find((n) => n.id === "Greeter")!;
    expect(helper.position).toEqual({ x: 0, y: 0 });
    expect(cls.position).toEqual({ x: 0, y: 130 });
  });

  it("uses saved positions when present", () => {
    const saved: ParseResult = {
      ...result,
      nodes: result.nodes.map((n) =>
        n.id === "helper" ? { ...n, position: { x: 500, y: 42 } } : n
      ),
    };
    const { nodes } = buildFlow(saved);
    expect(nodes.find((n) => n.id === "helper")!.position).toEqual({ x: 500, y: 42 });
  });

  it("emits orthogonal step edges", () => {
    const { edges } = buildFlow(result);
    expect(edges).toEqual([
      { id: "Greeter.greet->helper", source: "Greeter.greet", target: "helper", type: "step" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flow`
Expected: FAIL — cannot resolve `./flow`.

- [ ] **Step 3: Write the implementation**

Create `src/features/graph/flow.ts`:

```ts
import type { GraphEdge, GraphNode, ParseResult, Position } from "../../shared/types";

export interface FlowNode {
  id: string;
  type: "scalpel";
  position: Position;
  parentId?: string;
  extent?: "parent";
  data: { node: GraphNode };
  style?: { width: number; height: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "step";
}

const ROW_HEIGHT = 130;
const METHOD_ROW = 90;

export function buildFlow(result: ParseResult): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of result.nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }

  const topLevel = result.nodes.filter((n) => !n.parent);
  const nodes: FlowNode[] = [];
  let row = 0;

  for (const node of topLevel) {
    const children = childrenOf.get(node.id) ?? [];
    const autoPosition: Position = { x: 0, y: ROW_HEIGHT * row };
    nodes.push({
      id: node.id,
      type: "scalpel",
      position: node.position ?? autoPosition,
      data: { node },
      ...(node.kind === "class"
        ? { style: { width: 240, height: 60 + METHOD_ROW * children.length } }
        : {}),
    });
    row += 1;

    children.forEach((child, index) => {
      nodes.push({
        id: child.id,
        type: "scalpel",
        parentId: node.id,
        extent: "parent",
        position: child.position ?? { x: 20, y: 50 + METHOD_ROW * index },
        data: { node: child },
      });
    });
  }

  const edges: FlowEdge[] = result.edges.map((edge: GraphEdge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "step",
  }));

  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flow`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/flow.ts src/features/graph/flow.test.ts
git commit -m "feat(ui): map parse results to React Flow nodes and edges"
```

---

### Task 6: Python extraction — functions, params, returns

**Files:**
- Create: `src-tauri/src/parser/mod.rs`, `src-tauri/src/parser/python.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod parser;`)

**Interfaces:**
- Consumes: `models::{GraphNode, GraphEdge, NodeKind, ParseResult, Position}`
- Produces: `parser::python::parse_source(source: &str, file_path: &str, layout: &HashMap<String, Position>) -> Result<ParseResult, String>` (edges empty until Task 8; layout applied in Task 9)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/parser/mod.rs`:

```rust
pub mod python;
```

Create `src-tauri/src/parser/python.rs`:

```rust
use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult, Position};

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "\
def add(a, b):
    return a + b

def main():
    total = add(1, 2)
    return total
";

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/main.py", &HashMap::new()).unwrap()
    }

    #[test]
    fn extracts_top_level_functions() {
        let result = parse(SOURCE);
        let names: Vec<&str> = result.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["add", "main"]);
        assert!(result.nodes.iter().all(|n| n.kind == NodeKind::Function));
    }

    #[test]
    fn extracts_parameters_from_signature() {
        let result = parse(SOURCE);
        let add = result.nodes.iter().find(|n| n.name == "add").unwrap();
        assert_eq!(add.params, vec!["a", "b"]);
    }

    #[test]
    fn extracts_return_identifiers() {
        let result = parse(SOURCE);
        let add = result.nodes.iter().find(|n| n.name == "add").unwrap();
        let main = result.nodes.iter().find(|n| n.name == "main").unwrap();
        assert_eq!(add.returns, vec!["a", "b"]);
        assert_eq!(main.returns, vec!["total"]);
    }

    #[test]
    fn function_without_return_has_empty_returns() {
        let result = parse("def shout(x):\n    print(x)\n");
        assert_eq!(result.nodes[0].returns, Vec::<String>::new());
    }

    #[test]
    fn sets_file_path() {
        let result = parse(SOURCE);
        assert_eq!(result.file_path, "src/main.py");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: FAIL — `parse_source` not found.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/parser/python.rs` (above the `#[cfg(test)]` module):

```rust
struct Def<'a> {
    id: String,
    kind: NodeKind,
    name: String,
    params: Vec<String>,
    returns: Vec<String>,
    parent: Option<String>,
    body: Option<Node<'a>>,
}

pub fn parse_source(
    source: &str,
    file_path: &str,
    _layout: &HashMap<String, Position>,
) -> Result<ParseResult, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_python::LANGUAGE.into())
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let defs = collect_defs(tree.root_node(), source);
    let nodes = defs.iter().map(to_node).collect();

    Ok(ParseResult {
        nodes,
        edges: Vec::new(),
        file_path: file_path.to_string(),
    })
}

fn collect_defs<'a>(root: Node<'a>, source: &str) -> Vec<Def<'a>> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() == "function_definition" {
            if let Some(def) = function_def(child, source, None) {
                defs.push(def);
            }
        }
    }
    defs
}

fn function_def<'a>(node: Node<'a>, source: &str, parent: Option<String>) -> Option<Def<'a>> {
    let name = node
        .child_by_field_name("name")?
        .utf8_text(source.as_bytes())
        .ok()?
        .to_string();
    let id = match &parent {
        Some(p) => format!("{p}.{name}"),
        None => name.clone(),
    };
    let kind = if parent.is_some() {
        NodeKind::Method
    } else {
        NodeKind::Function
    };
    let params = parameter_names(node, source);
    let body = node.child_by_field_name("body")?;
    let returns = return_names(body, source);

    Some(Def {
        id,
        kind,
        name,
        params,
        returns,
        parent,
        body: Some(body),
    })
}

fn parameter_names(node: Node, source: &str) -> Vec<String> {
    let Some(list) = node.child_by_field_name("parameters") else {
        return Vec::new();
    };
    let mut names = Vec::new();
    let mut cursor = list.walk();
    for param in list.named_children(&mut cursor) {
        if let Some(name) = param_name(param, source) {
            names.push(name);
        }
    }
    names
}

fn param_name(node: Node, source: &str) -> Option<String> {
    if node.kind() == "identifier" {
        return node.utf8_text(source.as_bytes()).ok().map(str::to_string);
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "identifier" {
            return child.utf8_text(source.as_bytes()).ok().map(str::to_string);
        }
    }
    None
}

fn return_names(body: Node, source: &str) -> Vec<String> {
    let mut names = Vec::new();
    collect_returns(body, source, &mut names);
    names
}

fn collect_returns(node: Node, source: &str, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_definition" | "class_definition" | "lambda" => continue,
            "return_statement" => collect_expr_names(child, source, out),
            _ => collect_returns(child, source, out),
        }
    }
}

fn collect_expr_names(node: Node, source: &str, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "identifier" => push_unique(out, child, source),
            "attribute" => {
                if let Some(attr) = child.child_by_field_name("attribute") {
                    push_unique(out, attr, source);
                }
            }
            "function_definition" | "class_definition" | "lambda" => continue,
            _ => collect_expr_names(child, source, out),
        }
    }
}

fn push_unique(out: &mut Vec<String>, node: Node, source: &str) {
    if let Ok(text) = node.utf8_text(source.as_bytes()) {
        if !out.iter().any(|existing| existing == text) {
            out.push(text.to_string());
        }
    }
}

fn to_node(def: &Def) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        parent: def.parent.clone(),
        position: None,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser src-tauri/src/lib.rs
git commit -m "feat(rust): extract python functions with params and returns"
```

---

### Task 7: Python extraction — classes and methods

**Files:**
- Modify: `src-tauri/src/parser/python.rs`

**Interfaces:**
- Consumes: existing `function_def`, `Def`, `collect_defs`
- Produces: class nodes (`kind: class`, no params/returns, no body) and method nodes (`kind: method`, `parent: Some(ClassName)`).

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/parser/python.rs`:

```rust
    const CLASS_SOURCE: &str = "\
class Greeter:
    def greet(self, name):
        return name

    def hello(self):
        return self.greet(\"world\")

def run():
    g = Greeter()
    return g.hello()
";

    #[test]
    fn extracts_classes_and_methods() {
        let result = parse(CLASS_SOURCE);
        let class = result.nodes.iter().find(|n| n.id == "Greeter").unwrap();
        assert_eq!(class.kind, NodeKind::Class);
        assert!(class.parent.is_none());

        let greet = result.nodes.iter().find(|n| n.id == "Greeter.greet").unwrap();
        assert_eq!(greet.kind, NodeKind::Method);
        assert_eq!(greet.parent.as_deref(), Some("Greeter"));
        assert_eq!(greet.params, vec!["self", "name"]);
    }

    #[test]
    fn class_node_has_no_params_or_returns() {
        let result = parse(CLASS_SOURCE);
        let class = result.nodes.iter().find(|n| n.id == "Greeter").unwrap();
        assert!(class.params.is_empty());
        assert!(class.returns.is_empty());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: FAIL — no node with id `Greeter`.

- [ ] **Step 3: Extend `collect_defs` to handle classes**

Replace the `collect_defs` function in `src-tauri/src/parser/python.rs` with:

```rust
fn collect_defs<'a>(root: Node<'a>, source: &str) -> Vec<Def<'a>> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(def) = function_def(child, source, None) {
                    defs.push(def);
                }
            }
            "class_definition" => {
                let class_name = child
                    .child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("")
                    .to_string();
                if let Some(body) = child.child_by_field_name("body") {
                    let mut inner_cursor = body.walk();
                    for inner in body.children(&mut inner_cursor) {
                        if inner.kind() == "function_definition" {
                            if let Some(def) =
                                function_def(inner, source, Some(class_name.clone()))
                            {
                                defs.push(def);
                            }
                        }
                    }
                }
                defs.push(Def {
                    id: class_name.clone(),
                    kind: NodeKind::Class,
                    name: class_name,
                    params: Vec::new(),
                    returns: Vec::new(),
                    parent: None,
                    body: None,
                });
            }
            _ => {}
        }
    }
    defs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/python.rs
git commit -m "feat(rust): extract python classes and methods"
```

---

### Task 8: Python extraction — in-file call edges

**Files:**
- Modify: `src-tauri/src/parser/python.rs`

**Interfaces:**
- Consumes: `Def.body`, `Def.id`, `Def.name`
- Produces: `parse_source` now returns populated `edges`. Rules: callee name matches an in-file function (`id == name`) or method (`id == Class.name`); class ids excluded; no self-edges; deduplicated; callbacks/unknown names dropped.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/parser/python.rs`:

```rust
    #[test]
    fn links_function_calls_within_file() {
        let result = parse(SOURCE);
        assert_eq!(
            result.edges,
            vec![GraphEdge {
                source: "main".into(),
                target: "add".into(),
            }]
        );
    }

    #[test]
    fn links_method_calls_and_constructor_is_not_an_edge() {
        let result = parse(CLASS_SOURCE);
        assert!(result.edges.contains(&GraphEdge {
            source: "Greeter.hello".into(),
            target: "Greeter.greet".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "run".into(),
            target: "Greeter.hello".into(),
        }));
        // `Greeter()` is a class constructor reference: never an edge.
        assert!(!result.edges.iter().any(|e| e.target == "Greeter"));
    }

    #[test]
    fn does_not_create_self_edges() {
        let source = "def loop():\n    loop()\n    loop()\n";
        let result = parse(source);
        assert!(result.edges.is_empty());
    }

    #[test]
    fn deduplicates_repeated_calls() {
        let source = "\
def helper():
    return 1

def main():
    helper()
    helper()
";
        let result = parse(source);
        assert_eq!(
            result.edges,
            vec![GraphEdge {
                source: "main".into(),
                target: "helper".into(),
            }]
        );
    }

    #[test]
    fn ignores_imports_and_builtins() {
        let source = "\
import math

def area(r):
    return math.pi * r

def show(x):
    print(x)
    return x
";
        let result = parse(source);
        assert!(result.edges.is_empty());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: FAIL — edges are empty.

- [ ] **Step 3: Implement edge collection**

In `src-tauri/src/parser/python.rs`, change `parse_source` to build edges and update `to_node` to keep the layout parameter (layout merge lands in Task 9; keep `_layout` unused here):

```rust
    let defs = collect_defs(tree.root_node(), source);
    let nodes = defs.iter().map(to_node).collect();
    let edges = collect_edges(&defs, source);

    Ok(ParseResult {
        nodes,
        edges,
        file_path: file_path.to_string(),
    })
```

Add these functions:

```rust
fn collect_edges(defs: &[Def], source: &str) -> Vec<GraphEdge> {
    let mut targets: HashMap<&str, &str> = HashMap::new();
    for def in defs {
        if def.kind != NodeKind::Class {
            targets.insert(def.id.as_str(), def.id.as_str());
            targets.insert(def.name.as_str(), def.id.as_str());
        }
    }

    let mut edges: Vec<GraphEdge> = Vec::new();
    for def in defs {
        let Some(body) = def.body else { continue };
        let mut calls = Vec::new();
        collect_calls(body, source, &mut calls);
        for name in calls {
            let Some(target) = targets.get(name.as_str()) else {
                continue;
            };
            if *target == def.id.as_str() {
                continue;
            }
            let edge = GraphEdge {
                source: def.id.clone(),
                target: target.to_string(),
            };
            if !edges.iter().any(|e| e.source == edge.source && e.target == edge.target) {
                edges.push(edge);
            }
        }
    }
    edges
}

fn collect_calls(node: Node, source: &str, out: &mut Vec<String>) {
    if node.kind() == "call" {
        if let Some(function) = node.child_by_field_name("function") {
            match function.kind() {
                "identifier" => {
                    if let Ok(text) = function.utf8_text(source.as_bytes()) {
                        out.push(text.to_string());
                    }
                }
                "attribute" => {
                    if let Some(attr) = function.child_by_field_name("attribute") {
                        if let Ok(text) = attr.utf8_text(source.as_bytes()) {
                            out.push(text.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "function_definition" || child.kind() == "class_definition" {
            continue;
        }
        collect_calls(child, source, out);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/python.rs
git commit -m "feat(rust): resolve in-file python call edges"
```

---

### Task 9: Python extraction — apply saved layout

**Files:**
- Modify: `src-tauri/src/parser/python.rs`

**Interfaces:**
- Consumes: `layout: &HashMap<String, Position>` (already a `parse_source` parameter)
- Produces: `GraphNode.position` populated from the layout map by node id.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/parser/python.rs`:

```rust
    #[test]
    fn applies_saved_positions_by_node_id() {
        let mut layout = HashMap::new();
        layout.insert("helper".to_string(), Position { x: 12.0, y: 34.0 });
        let result =
            parse_source("def helper():\n    return 1\n", "src/a.py", &layout).unwrap();
        assert_eq!(result.nodes[0].position, Some(Position { x: 12.0, y: 34.0 }));
    }

    #[test]
    fn leaves_position_none_when_not_in_layout() {
        let result = parse_source("def helper():\n    return 1\n", "src/a.py", &HashMap::new())
            .unwrap();
        assert_eq!(result.nodes[0].position, None);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: FAIL — positions are `None`.

- [ ] **Step 3: Apply layout in `to_node`**

Change the `parse_source` line that maps nodes and update `to_node`:

```rust
    let nodes = defs.iter().map(|def| to_node(def, layout)).collect();
```

```rust
fn to_node(def: &Def, layout: &HashMap<String, Position>) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        parent: def.parent.clone(),
        position: layout.get(&def.id).cloned(),
    }
}
```

Also rename the `_layout` parameter of `parse_source` back to `layout`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::python`
Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/python.rs
git commit -m "feat(rust): merge saved node layout into python parse results"
```

---

### Task 10: JS/TS extraction — declarations

**Files:**
- Create: `src-tauri/src/parser/jsts.rs`
- Modify: `src-tauri/src/parser/mod.rs`

**Interfaces:**
- Consumes: `models::{GraphNode, GraphEdge, NodeKind, ParseResult, Position}`
- Produces: `parser::jsts::parse_source(source: &str, file_path: &str, layout: &HashMap<String, Position>) -> Result<ParseResult, String>` (edges empty until Task 11)

Node rules:
- `function_declaration` → function (named by `name` field)
- `lexical_declaration` / `variable_declaration` declarator whose value is `arrow_function` / `function` / `function_expression` → function named by declarator's `name`
- `class_declaration` → class; `method_definition` in its body → method with `parent` = class name
- `method_definition` in an object literal → method named `varName.methodName`, `parent` = `varName`; if no owning variable declarator, standalone function named `methodName`
- Params: identifier → text; destructured/rest/complex → raw node text
- Returns: identifiers in `return` statements; simple identifier arrow-expression body counts as a return

- [ ] **Step 1: Write the failing test**

Add `pub mod jsts;` to `src-tauri/src/parser/mod.rs`.

Create `src-tauri/src/parser/jsts.rs`:

```rust
use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult, Position};

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "\
function add(a, b) {
  return a + b;
}

const mul = (a, b) => {
  return a * b;
};

class Calc {
  double(n) {
    return add(n, n);
  }
}

const utils = {
  helper(x) {
    return x;
  }
};

function run() {
  const c = new Calc();
  return mul(c.double(2), 3);
}
";

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/app.js", &HashMap::new()).unwrap()
    }

    #[test]
    fn extracts_function_declarations() {
        let result = parse(SOURCE);
        let add = result.nodes.iter().find(|n| n.name == "add").unwrap();
        assert_eq!(add.kind, NodeKind::Function);
        assert_eq!(add.params, vec!["a", "b"]);
    }

    #[test]
    fn extracts_arrow_function_assigned_to_variable() {
        let result = parse(SOURCE);
        let mul = result.nodes.iter().find(|n| n.id == "mul").unwrap();
        assert_eq!(mul.kind, NodeKind::Function);
        assert_eq!(mul.params, vec!["a", "b"]);
        assert_eq!(mul.returns, vec!["a", "b"]);
    }

    #[test]
    fn extracts_classes_and_methods() {
        let result = parse(SOURCE);
        let calc = result.nodes.iter().find(|n| n.id == "Calc").unwrap();
        assert_eq!(calc.kind, NodeKind::Class);
        let double = result.nodes.iter().find(|n| n.id == "Calc.double").unwrap();
        assert_eq!(double.kind, NodeKind::Method);
        assert_eq!(double.parent.as_deref(), Some("Calc"));
    }

    #[test]
    fn extracts_object_literal_methods_with_variable_parent() {
        let result = parse(SOURCE);
        let helper = result.nodes.iter().find(|n| n.id == "utils.helper").unwrap();
        assert_eq!(helper.kind, NodeKind::Method);
        assert_eq!(helper.parent.as_deref(), Some("utils"));
        assert_eq!(helper.params, vec!["x"]);
    }

    #[test]
    fn handles_typescript_grammar() {
        const TS: &str = "\
interface Point {
  x: number;
}

function magnitude(p: Point): number {
  return p.x;
}
";
        let result = parse_source(TS, "src/math.ts", &HashMap::new()).unwrap();
        let names: Vec<&str> = result.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["magnitude"]);
    }

    #[test]
    fn destructured_params_render_as_written() {
        let result = parse("function dist({ x, y }) {\n  return x;\n}\n");
        assert_eq!(result.nodes[0].params, vec!["{ x, y }"]);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::jsts`
Expected: FAIL — `parse_source` not found.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/parser/jsts.rs` (above the test module):

```rust
struct Def<'a> {
    id: String,
    kind: NodeKind,
    name: String,
    params: Vec<String>,
    returns: Vec<String>,
    parent: Option<String>,
    body: Option<Node<'a>>,
}

fn grammar_for(file_path: &str) -> tree_sitter::Language {
    if file_path.ends_with(".ts") || file_path.ends_with(".tsx") {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    } else {
        tree_sitter_typescript::LANGUAGE_JAVASCRIPT.into()
    }
}

pub fn parse_source(
    source: &str,
    file_path: &str,
    layout: &HashMap<String, Position>,
) -> Result<ParseResult, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&grammar_for(file_path))
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let defs = collect_defs(tree.root_node(), source);
    let nodes = defs.iter().map(|def| to_node(def, layout)).collect();

    Ok(ParseResult {
        nodes,
        edges: Vec::new(),
        file_path: file_path.to_string(),
    })
}

fn collect_defs<'a>(root: Node<'a>, source: &str) -> Vec<Def<'a>> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(def) = declared_function(child, source, None) {
                    defs.push(def);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                collect_declarators(child, source, None, &mut defs);
            }
            "class_declaration" => {
                let class_name = node_text(child.child_by_field_name("name"), source);
                if let Some(body) = child.child_by_field_name("class_body") {
                    let mut inner = body.walk();
                    for member in body.children(&mut inner) {
                        if member.kind() == "method_definition" {
                            if let Some(def) =
                                declared_function(member, source, Some(class_name.clone()))
                            {
                                defs.push(def);
                            }
                        }
                    }
                }
                if !class_name.is_empty() {
                    defs.push(Def {
                        id: class_name.clone(),
                        kind: NodeKind::Class,
                        name: class_name,
                        params: Vec::new(),
                        returns: Vec::new(),
                        parent: None,
                        body: None,
                    });
                }
            }
            _ => {}
        }
    }
    collect_object_methods(root, source, &mut defs);
    defs
}

fn collect_declarators<'a>(
    declaration: Node<'a>,
    source: &str,
    parent: Option<String>,
    defs: &mut Vec<Def<'a>>,
) {
    let mut cursor = declaration.walk();
    for declarator in declaration.children(&mut cursor) {
        if declarator.kind() != "variable_declarator" {
            continue;
        }
        let name = node_text(declarator.child_by_field_name("name"), source);
        let Some(value) = declarator.child_by_field_name("value") else {
            continue;
        };
        if matches!(
            value.kind(),
            "arrow_function" | "function" | "function_expression"
        ) {
            let mut def = declared_function(value, source, parent.clone());
            if let Some(def) = def.as_mut() {
                if !name.is_empty() {
                    def.name = name.clone();
                    def.id = match &parent {
                        Some(p) => format!("{p}.{name}"),
                        None => name.clone(),
                    };
                    def.kind = if parent.is_some() {
                        NodeKind::Method
                    } else {
                        NodeKind::Function
                    };
                }
            }
            if let Some(def) = def {
                defs.push(def);
            }
        } else if value.kind() == "object" {
            collect_declarators_in_object(value, source, Some(name), defs);
        }
    }
}

fn collect_declarators_in_object<'a>(
    object: Node<'a>,
    source: &str,
    owner: Option<String>,
    defs: &mut Vec<Def<'a>>,
) {
    let mut cursor = object.walk();
    for pair in object.children(&mut cursor) {
        if pair.kind() != "pair" {
            continue;
        }
        let Some(value) = pair.child_by_field_name("value") else {
            continue;
        };
        if value.kind() == "object" {
            let name = node_text(pair.child_by_field_name("key"), source);
            collect_declarators_in_object(value, source, Some(name), defs);
        }
    }
}

fn collect_object_methods<'a>(root: Node<'a>, source: &str, defs: &mut Vec<Def<'a>>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "object" {
                collect_methods_in_object(child, source, None, defs);
            }
            stack.push(child);
        }
    }
}

fn collect_methods_in_object<'a>(
    object: Node<'a>,
    source: &str,
    owner_override: Option<String>,
    defs: &mut Vec<Def<'a>>,
) {
    let owner = owner_override.or_else(|| ancestor_variable_name(object, source));
    let mut cursor = object.walk();
    for member in object.children(&mut cursor) {
        if member.kind() == "method_definition" {
            if let Some(mut def) = declared_function(member, source, owner.clone()) {
                def.id = match &owner {
                    Some(o) => format!("{o}.{}", def.name),
                    None => def.name.clone(),
                };
                def.kind = NodeKind::Method;
                if !defs.iter().any(|existing| existing.id == def.id) {
                    defs.push(def);
                }
            }
        }
    }
}

fn ancestor_variable_name(node: Node, source: &str) -> Option<String> {
    let mut current = node.parent();
    while let Some(parent) = current {
        if parent.kind() == "variable_declarator" {
            let name = node_text(parent.child_by_field_name("name"), source);
            if !name.is_empty() {
                return Some(name);
            }
        }
        current = parent.parent();
    }
    None
}

fn declared_function<'a>(
    node: Node<'a>,
    source: &str,
    parent: Option<String>,
) -> Option<Def<'a>> {
    let name = node_text(node.child_by_field_name("name"), source);
    if name.is_empty() && node.kind() != "arrow_function" && node.kind() != "function_expression" {
        return None;
    }
    let id = match &parent {
        Some(p) if !name.is_empty() => format!("{p}.{name}"),
        _ => name.clone(),
    };
    let kind = if parent.is_some() {
        NodeKind::Method
    } else {
        NodeKind::Function
    };
    let params = parameter_names(node, source);
    let body = node.child_by_field_name("body");
    let returns = match body {
        Some(b) if b.kind() == "statement_block" => return_names(b, source),
        Some(b) => vec![node_text(Some(b), source)],
        None => Vec::new(),
    };

    Some(Def {
        id,
        kind,
        name,
        params,
        returns,
        parent,
        body: node.child_by_field_name("body"),
    })
}

fn parameter_names(node: Node, source: &str) -> Vec<String> {
    let Some(list) = node.child_by_field_name("parameters") else {
        return Vec::new();
    };
    let mut names = Vec::new();
    let mut cursor = list.walk();
    for param in list.named_children(&mut cursor) {
        let text = node_text(Some(param), source).trim().to_string();
        if !text.is_empty() {
            names.push(text);
        }
    }
    names
}

fn return_names(body: Node, source: &str) -> Vec<String> {
    let mut names = Vec::new();
    collect_returns(body, source, &mut names);
    names
}

fn collect_returns(node: Node, source: &str, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_declaration" | "function" | "arrow_function" | "class_declaration" => {
                continue
            }
            "return_statement" => collect_expr_names(child, source, out),
            _ => collect_returns(child, source, out),
        }
    }
}

fn collect_expr_names(node: Node, source: &str, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "identifier" => push_unique(out, child, source),
            "member_expression" => {
                if let Some(prop) = child.child_by_field_name("property") {
                    push_unique(out, prop, source);
                }
            }
            "function_declaration" | "function" | "arrow_function" | "class_declaration" => {
                continue
            }
            _ => collect_expr_names(child, source, out),
        }
    }
}

fn push_unique(out: &mut Vec<String>, node: Node, source: &str) {
    let text = node_text(Some(node), source);
    if !text.is_empty() && !out.iter().any(|existing| existing == &text) {
        out.push(text);
    }
}

fn node_text(node: Option<Node>, source: &str) -> String {
    node.and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("")
        .to_string()
}

fn to_node(def: &Def, layout: &HashMap<String, Position>) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        parent: def.parent.clone(),
        position: layout.get(&def.id).cloned(),
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::jsts`
Expected: 6 tests PASS. **If the crate API differs:** `tree-sitter-typescript` has exported the grammar under slightly different names across versions (`LANGUAGE_TYPESCRIPT`/`LANGUAGE_JAVASCRIPT` constants vs `language_typescript()`/`language_javascript()` functions returning `LanguageFn`). Find the truth before guessing:

```powershell
rg -n "pub (const|fn) (LANGUAGE|language)" "$env:USERPROFILE\.cargo\registry\src\*\tree-sitter-typescript-*\bindings\rust\*.rs"
```

Then use whatever that prints; both forms work with `.into()` when building the `Language` passed to `set_language`. If the crate has no Rust bindings file, use `cargo doc -p tree-sitter-typescript --no-deps --open` and read the exported items.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/mod.rs src-tauri/src/parser/jsts.rs
git commit -m "feat(rust): extract js/ts functions, classes, and methods"
```

---

### Task 11: JS/TS extraction — in-file call edges

**Files:**
- Modify: `src-tauri/src/parser/jsts.rs`

**Interfaces:**
- Consumes: `Def.body`, `Def.id`, `Def.name`, `collect_calls` pattern from `parser::python`
- Produces: populated `edges` for JS/TS. Rules identical to Python: in-file function/method name match, class targets excluded (so `new Calc()` is never an edge), no self-edges, no duplicates.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/parser/jsts.rs`:

```rust
    #[test]
    fn links_function_and_method_calls() {
        let result = parse(SOURCE);
        assert!(result.edges.contains(&GraphEdge {
            source: "run".into(),
            target: "mul".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "run".into(),
            target: "Calc.double".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "Calc.double".into(),
            target: "add".into(),
        }));
    }

    #[test]
    fn constructor_is_not_an_edge() {
        let result = parse(SOURCE);
        assert!(!result.edges.iter().any(|e| e.target == "Calc"));
    }

    #[test]
    fn ignores_callbacks_imports_and_builtins() {
        let source = "\
import { readFile } from \"fs\";

function run(items) {
  return items.map((x) => x).concat(console.log(items));
}
";
        let result = parse(source);
        assert!(result.edges.is_empty());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::jsts`
Expected: FAIL — edges are empty.

- [ ] **Step 3: Implement edge collection**

In `parse_source`, build edges:

```rust
    let defs = collect_defs(tree.root_node(), source);
    let nodes = defs.iter().map(|def| to_node(def, layout)).collect();
    let edges = collect_edges(&defs, source);
```

Add:

```rust
fn collect_edges(defs: &[Def], source: &str) -> Vec<GraphEdge> {
    let mut targets: HashMap<&str, &str> = HashMap::new();
    for def in defs {
        if def.kind != NodeKind::Class {
            targets.insert(def.id.as_str(), def.id.as_str());
            targets.insert(def.name.as_str(), def.id.as_str());
        }
    }

    let mut edges: Vec<GraphEdge> = Vec::new();
    for def in defs {
        let Some(body) = def.body else { continue };
        let mut calls = Vec::new();
        collect_calls(body, source, &mut calls);
        for name in calls {
            let Some(target) = targets.get(name.as_str()) else {
                continue;
            };
            if *target == def.id.as_str() {
                continue;
            }
            let edge = GraphEdge {
                source: def.id.clone(),
                target: target.to_string(),
            };
            if !edges.iter().any(|e| e.source == edge.source && e.target == edge.target) {
                edges.push(edge);
            }
        }
    }
    edges
}

fn collect_calls(node: Node, source: &str, out: &mut Vec<String>) {
    if node.kind() == "call_expression" || node.kind() == "new_expression" {
        if let Some(callee) = node
            .child_by_field_name("function")
            .or_else(|| node.child_by_field_name("constructor"))
        {
            match callee.kind() {
                "identifier" => {
                    let text = node_text(Some(callee), source);
                    if !text.is_empty() {
                        out.push(text);
                    }
                }
                "member_expression" => {
                    if let Some(prop) = callee.child_by_field_name("property") {
                        let text = node_text(Some(prop), source);
                        if !text.is_empty() {
                            out.push(text);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "function_declaration" | "function" | "arrow_function" | "class_declaration"
        ) {
            continue;
        }
        collect_calls(child, source, out);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::jsts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/jsts.rs
git commit -m "feat(rust): resolve in-file js/ts call edges"
```

---

### Task 12: Layout persistence commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/layout.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod commands;`)

**Interfaces:**
- Consumes: `models::Position`
- Produces:
  - `commands::layout::load_layout(root: String, rel_path: String) -> Result<Option<HashMap<String, Position>>, String>`
  - `commands::layout::save_layout(root: String, rel_path: String, layout: HashMap<String, Position>) -> Result<(), String>`
  - `commands::layout::metadata_path(root: &str) -> std::path::PathBuf` (internal helper)
  - Both commands are Tauri commands (Task 13 registers them).

Stored shape in `<root>/.scalpel/metadata.json`:

```json
{ "version": 1, "layouts": { "src/main.py": { "helper": { "x": 12, "y": 34 } } } }
```

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/commands/mod.rs`:

```rust
pub mod layout;
```

Create `src-tauri/src/commands/layout.rs`:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::Position;

#[derive(Debug, Serialize, Deserialize, Default)]
struct Metadata {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    layouts: HashMap<String, HashMap<String, Position>>,
}

fn default_version() -> u32 {
    1
}

pub fn metadata_path(root: &str) -> PathBuf {
    Path::new(root).join(".scalpel").join("metadata.json")
}

fn read_metadata(root: &str) -> Metadata {
    let path = metadata_path(root);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Metadata::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("scalpel-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn load_returns_none_when_no_metadata_file() {
        let root = temp_root("load-none");
        assert_eq!(load_layout(root, "src/a.py".into()).unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips_positions() {
        let root = temp_root("round-trip");
        let mut layout = HashMap::new();
        layout.insert("helper".to_string(), Position { x: 12.0, y: 34.0 });
        save_layout(root.clone(), "src/a.py".into(), layout.clone()).unwrap();

        let loaded = load_layout(root, "src/a.py".into()).unwrap().unwrap();
        assert_eq!(loaded, layout);
        assert!(metadata_path(&temp_root("round-trip"))
            .parent()
            .unwrap()
            .exists());
    }

    #[test]
    fn saving_one_file_preserves_other_files() {
        let root = temp_root("preserve");
        let mut a = HashMap::new();
        a.insert("a".to_string(), Position { x: 1.0, y: 1.0 });
        let mut b = HashMap::new();
        b.insert("b".to_string(), Position { x: 2.0, y: 2.0 });
        save_layout(root.clone(), "src/a.py".into(), a.clone()).unwrap();
        save_layout(root.clone(), "src/b.py".into(), b.clone()).unwrap();

        assert_eq!(load_layout(root.clone(), "src/a.py".into()).unwrap().unwrap(), a);
        assert_eq!(load_layout(root, "src/b.py".into()).unwrap().unwrap(), b);
    }

    #[test]
    fn corrupt_metadata_is_treated_as_absent() {
        let root = temp_root("corrupt");
        let path = metadata_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not json").unwrap();

        assert_eq!(load_layout(root.clone(), "src/a.py".into()).unwrap(), None);

        let mut layout = HashMap::new();
        layout.insert("x".to_string(), Position { x: 0.0, y: 0.0 });
        save_layout(root.clone(), "src/a.py".into(), layout.clone()).unwrap();
        assert_eq!(load_layout(root, "src/a.py".into()).unwrap().unwrap(), layout);
    }
}

pub fn load_layout(
    root: String,
    rel_path: String,
) -> Result<Option<HashMap<String, Position>>, String> {
    Ok(read_metadata(&root).layouts.get(&rel_path).cloned())
}

pub fn save_layout(
    root: String,
    rel_path: String,
    layout: HashMap<String, Position>,
) -> Result<(), String> {
    let mut metadata = read_metadata(&root);
    metadata.version = default_version();
    metadata.layouts.insert(rel_path, layout);

    let path = metadata_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}
```

Note: `load_layout`/`save_layout` are plain functions in Task 12. Task 13 wraps them as `#[tauri::command]` entry points; keeping them plain here lets `cargo test` call them directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::layout`
Expected: FAIL — functions not found.

- [ ] **Step 3: Ensure `Position` derives `Deserialize`**

`load_layout` deserializes `Position`. Update the derive in `src-tauri/src/models.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}
```

and change the `use serde::Serialize;` line to `use serde::{Deserialize, Serialize};`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::layout`
Expected: 4 tests PASS.

- [ ] **Step 5: Register the module and commit**

Add `mod commands;` to `src-tauri/src/lib.rs`.

```powershell
git add src-tauri/src/commands src-tauri/src/models.rs src-tauri/src/lib.rs
git commit -m "feat(rust): persist node layout to .scalpel/metadata.json"
```

---

### Task 13: Filesystem commands + Tauri command registration

**Files:**
- Create: `src-tauri/src/commands/fs_cmds.rs`, `src-tauri/src/commands/parse.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `parser::python::parse_source`, `parser::jsts::parse_source`, `commands::layout::{load_layout, save_layout, metadata_path}`, `models::ParseResult`
- Produces (all Tauri commands):
  - `list_directory(root: String, rel_path: String) -> Result<Vec<FileEntry>, String>` — `FileEntry { name, path, isDir, children }` (`path` is project-relative)
  - `read_markdown(path: String) -> Result<String, String>`
  - `parse_python(path: String, root: String) -> Result<ParseResult, String>`
  - `parse_js_ts(path: String, root: String) -> Result<ParseResult, String>`
  - `load_layout(root: String, rel_path: String) -> Result<Option<HashMap<String, Position>>, String>`
  - `save_layout(root: String, rel_path: String, layout: HashMap<String, Position>) -> Result<(), String>`
  - `relative_path(root: &str, path: &str) -> String` (internal helper)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/commands/fs_cmds.rs`:

```rust
use std::path::Path;

use serde::Serialize;

const ALLOWED_EXTENSIONS: [&str; 15] = [
    "py", "js", "jsx", "ts", "tsx", "md", "c", "cpp", "cc", "hpp", "h", "java", "cs", "rs", "go",
];

const SKIPPED_DIRS: [&str; 8] = [
    ".git", "node_modules", "target", "dist", ".scalpel", "__pycache__", ".venv", "venv",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileEntry>,
}

pub fn relative_path(root: &str, path: &str) -> String {
    Path::new(path)
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"))
}

fn is_supported(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| ALLOWED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        let dir = std::env::temp_dir().join(format!("scalpel-fs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("src/main.py"), "def a():\n    return 1\n").unwrap();
        std::fs::write(dir.join("README.md"), "# hi\n").unwrap();
        std::fs::write(dir.join("src/style.css"), "body {}").unwrap();
        std::fs::write(dir.join("node_modules/junk.py"), "def junk(): pass\n").unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn lists_supported_files_and_skips_ignored_dirs() {
        let root = fixture();
        let entries = list_directory(root.clone(), "".into()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"README.md"));
        assert!(names.contains(&"src"));
        assert!(!names.contains(&"node_modules"));

        let src = entries.iter().find(|e| e.name == "src").unwrap();
        let child_names: Vec<&str> =
            src.children.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(child_names, vec!["main.py"]);
    }

    #[test]
    fn entry_paths_are_project_relative_with_forward_slashes() {
        let root = fixture();
        let entries = list_directory(root, "".into()).unwrap();
        let readme = entries.iter().find(|e| e.name == "README.md").unwrap();
        assert_eq!(readme.path, "README.md");
    }

    #[test]
    fn read_markdown_returns_raw_text() {
        let root = fixture();
        let path = Path::new(&root).join("README.md");
        assert_eq!(read_markdown(path.to_string_lossy().to_string()).unwrap(), "# hi\n");
    }

    #[test]
    fn read_markdown_errors_on_missing_file() {
        assert!(read_markdown("C:/definitely/missing.md".into()).is_err());
    }
}

pub fn list_directory(root: String, rel_path: String) -> Result<Vec<FileEntry>, String> {
    let base = Path::new(&root).join(&rel_path);
    let read = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for item in read {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let full = item.path();
        let is_dir = full.is_dir();

        if is_dir {
            if SKIPPED_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            let child_rel = relative_path(&root, &full.to_string_lossy());
            let children = list_directory(root.clone(), child_rel).unwrap_or_default();
            if children.is_empty() {
                continue;
            }
            entries.push(FileEntry {
                name,
                path: relative_path(&root, &full.to_string_lossy()),
                is_dir: true,
                children,
            });
        } else if is_supported(&name) {
            entries.push(FileEntry {
                name,
                path: relative_path(&root, &full.to_string_lossy()),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

pub fn read_markdown(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}
```

Create `src-tauri/src/commands/parse.rs`:

```rust
use std::collections::HashMap;

use crate::commands::fs_cmds::relative_path;
use crate::commands::layout::{load_layout, save_layout};
use crate::models::{ParseResult, Position};
use crate::parser;

fn parse_with<F>(path: String, root: String, parse: F) -> Result<ParseResult, String>
where
    F: Fn(&str, &str, &HashMap<String, Position>) -> Result<ParseResult, String>,
{
    let source = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let rel = relative_path(&root, &path);
    let layout = load_layout(root, rel.clone())?.unwrap_or_default();
    parse(&source, &rel, &layout)
}

#[tauri::command]
pub fn parse_python(path: String, root: String) -> Result<ParseResult, String> {
    parse_with(path, root, parser::python::parse_source)
}

#[tauri::command]
pub fn parse_js_ts(path: String, root: String) -> Result<ParseResult, String> {
    parse_with(path, root, parser::jsts::parse_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_python_command_reads_file_and_returns_graph() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.py");
        std::fs::write(&file, "def one():\n    return 1\n").unwrap();

        let result = parse_python(file.to_string_lossy().to_string(), dir.to_string_lossy().to_string())
            .unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].name, "one");
        assert_eq!(result.file_path, "a.py");
    }

    #[test]
    fn parse_python_command_errors_on_missing_file() {
        assert!(parse_python("C:/missing/a.py".into(), "C:/missing".into()).is_err());
    }
}
```

Update `src-tauri/src/commands/mod.rs`:

```rust
pub mod fs_cmds;
pub mod layout;
pub mod parse;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::`
Expected: FAIL — cannot find `list_directory` / `parse_python`.

- [ ] **Step 3: Register commands in the Tauri builder**

In `src-tauri/src/lib.rs`, inside `run()` (the template's `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`), set:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs_cmds::list_directory,
            commands::fs_cmds::read_markdown,
            commands::parse::parse_python,
            commands::parse::parse_js_ts,
            commands::layout::load_layout,
            commands::layout::save_layout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

Keep the template's `.plugin(tauri_plugin_opener::init())` line if present.

- [ ] **Step 4: Add the `#[tauri::command]` annotations to the layout functions**

In `src-tauri/src/commands/layout.rs`, annotate the two public functions (keep their signatures exactly):

```rust
#[tauri::command]
pub fn load_layout(
    root: String,
    rel_path: String,
) -> Result<Option<HashMap<String, Position>>, String> {
```

```rust
#[tauri::command]
pub fn save_layout(
    root: String,
    rel_path: String,
    layout: HashMap<String, Position>,
) -> Result<(), String> {
```

Tauri v2 converts snake_case args from the JS side automatically when the frontend passes camelCase? No — Tauri v2 expects the JS keys to match the Rust arg names; the frontend in Task 14 passes `{ root, relPath, layout }` and this requires `rel_path`. Fix by adding `#[tauri::command(rename_all = "camelCase")]` to both functions.

- [ ] **Step 5: Run all Rust tests and check the build**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
if ($?) { cargo build --manifest-path src-tauri/Cargo.toml }
```

Expected: all tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/commands src-tauri/src/lib.rs
git commit -m "feat(rust): add filesystem, parse, and layout tauri commands"
```

---

### Task 14: Typed IPC wrappers + file loading hook

**Files:**
- Create: `src/shared/ipc.ts`, `src/features/shell/useFileContent.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`; `shared/types.ts`; `shared/extensions.ts`
- Produces:
  - `ipc.ts`: `listDirectory(root, relPath): Promise<FileEntry[]>`, `readMarkdown(path): Promise<string>`, `parsePython(path, root): Promise<ParseResult>`, `parseJsTs(path, root): Promise<ParseResult>`, `loadLayout(root, relPath): Promise<LayoutMap | null>`, `saveLayout(root, relPath, layout): Promise<void>`; `FileEntry { name: string; path: string; isDir: boolean; children: FileEntry[] }`
  - `useFileContent(root: string | null, filePath: string | null): FileState` where `FileState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "graph"; result: ParseResult } | { status: "markdown"; content: string }`

- [ ] **Step 1: Write `src/shared/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { LayoutMap, ParseResult } from "./types";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: FileEntry[];
}

export function listDirectory(root: string, relPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", { root, relPath });
}

export function readMarkdown(path: string): Promise<string> {
  return invoke<string>("read_markdown", { path });
}

export function parsePython(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_python", { path, root });
}

export function parseJsTs(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_js_ts", { path, root });
}

export function loadLayout(root: string, relPath: string): Promise<LayoutMap | null> {
  return invoke<LayoutMap | null>("load_layout", { root, relPath });
}

export function saveLayout(
  root: string,
  relPath: string,
  layout: LayoutMap
): Promise<void> {
  return invoke<void>("save_layout", { root, relPath, layout });
}
```

- [ ] **Step 2: Write `src/features/shell/useFileContent.ts`**

```ts
import { useEffect, useState } from "react";
import type { ParseResult } from "../../shared/types";
import { routeForExtension } from "../../shared/extensions";
import { parseJsTs, parsePython, readMarkdown } from "../../shared/ipc";

export type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "graph"; result: ParseResult }
  | { status: "markdown"; content: string };

export function useFileContent(
  root: string | null,
  filePath: string | null
): FileState {
  const [state, setState] = useState<FileState>({ status: "idle" });

  useEffect(() => {
    if (!root || !filePath) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    const route = routeForExtension(filePath);
    const load = async (): Promise<FileState> => {
      switch (route) {
        case "python":
          return { status: "graph", result: await parsePython(filePath, root) };
        case "jsts":
          return { status: "graph", result: await parseJsTs(filePath, root) };
        case "markdown":
          return { status: "markdown", content: await readMarkdown(filePath) };
        default:
          return { status: "error", message: "Unsupported file type" };
      }
    };

    load()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, filePath]);

  return state;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds (the hook is unused so far; that is fine for TypeScript, but if the template enables `noUnusedLocals` and flags exported-but-unused files, that only applies within a file — exported symbols are not flagged).

- [ ] **Step 4: Commit**

```powershell
git add src/shared/ipc.ts src/features/shell/useFileContent.ts
git commit -m "feat(ui): add typed IPC wrappers and file content hook"
```

---

### Task 15: File explorer with OS folder picker

**Files:**
- Create: `src/features/explorer/FileExplorer.tsx`
- Modify: `src-tauri/src/lib.rs` (register dialog plugin), `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `listDirectory`, `FileEntry` from `src/shared/ipc.ts`; `open` from `@tauri-apps/plugin-dialog`
- Produces: `<FileExplorer root={root} onOpenFolder={(root) => void} onSelectFile={(relPath) => void} />`

- [ ] **Step 1: Install and register the dialog plugin**

```powershell
npm install @tauri-apps/plugin-dialog
cargo add tauri-plugin-dialog@2 --manifest-path src-tauri/Cargo.toml
```

In `src-tauri/src/lib.rs`, add before `.invoke_handler(...)`:

```rust
        .plugin(tauri_plugin_dialog::init())
```

In `src-tauri/capabilities/default.json`, add `"dialog:default"` to the `permissions` array.

- [ ] **Step 2: Write the component**

```tsx
import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listDirectory, type FileEntry } from "../../shared/ipc";

interface Props {
  root: string | null;
  onOpenFolder: (root: string) => void;
  onSelectFile: (relPath: string) => void;
  selectedFile: string | null;
}

export function FileExplorer({ root, onOpenFolder, onSelectFile, selectedFile }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!root) {
      setEntries([]);
      return;
    }
    listDirectory(root, "")
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [root]);

  const pickFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setError(null);
      onOpenFolder(picked);
    }
  }, [onOpenFolder]);

  const renderEntries = (items: FileEntry[], depth: number) => (
    <ul className="list-none m-0 p-0">
      {items.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            onClick={() => (entry.isDir ? undefined : onSelectFile(entry.path))}
            disabled={entry.isDir}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            className={
              "block w-full text-left px-2 py-1 text-sm rounded " +
              (entry.isDir
                ? "text-dimmed cursor-default"
                : selectedFile === entry.path
                  ? "bg-accent/20 text-accent"
                  : "text-white/90 hover:bg-white/5")
            }
          >
            {entry.isDir ? `▸ ${entry.name}` : entry.name}
          </button>
          {entry.isDir && renderEntries(entry.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="h-full bg-panel p-3 overflow-auto">
      <button
        type="button"
        onClick={pickFolder}
        className="mb-3 w-full rounded border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10"
      >
        Open Folder
      </button>
      {!root && <p className="text-dimmed text-sm">No folder open.</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {root && renderEntries(entries, 0)}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run:

```powershell
npm run build
if ($?) { cargo build --manifest-path src-tauri/Cargo.toml }
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json src/features/explorer/FileExplorer.tsx src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(ui): file explorer with OS folder picker"
```

---

### Task 16: Markdown viewer

**Files:**
- Create: `src/features/markdown/MarkdownView.tsx`

**Interfaces:**
- Consumes: `content: string`
- Produces: `<MarkdownView content={string} />` — GitHub-flavored markdown, highlighted code fences, interactive checkboxes, `prose prose-invert`.

- [ ] **Step 1: Write the component**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  content: string;
}

export function MarkdownView({ content }: Props) {
  return (
    <div className="h-full overflow-auto bg-bg p-6">
      <article className="prose prose-invert max-w-3xl mx-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Import a highlight.js theme**

At the top of `src/index.css` (before the Tailwind directives) or in `src/main.tsx`, add:

```css
@import "highlight.js/styles/github-dark.css";
```

Tailwind v3 requires CSS imports to precede `@tailwind` directives; place the import on line 1 of `index.css`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```powershell
git add src/features/markdown/MarkdownView.tsx src/index.css
git commit -m "feat(ui): render markdown with gfm and syntax highlighting"
```

---

### Task 17: Node graph rendering

**Files:**
- Create: `src/features/graph/CodeNode.tsx`, `src/features/graph/GraphView.tsx`

**Interfaces:**
- Consumes: `buildFlow`, `FlowNode` from `src/features/graph/flow.ts`; `GraphNode` from `src/shared/types.ts`; `ParsedResult` via `result: ParseResult`
- Produces:
  - `<CodeNode data={{ node: GraphNode; highlighted: boolean; dimmed: boolean }} />`
  - `<GraphView result={ParseResult} selectedId={string | null} onSelect={(id: string | null) => void} onDragStop={(positions: LayoutMap) => void} />`

- [ ] **Step 1: Write the custom node**

Create `src/features/graph/CodeNode.tsx`:

```tsx
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
```

- [ ] **Step 2: Write the graph view**

Create `src/features/graph/GraphView.tsx`:

```tsx
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

  const handleDragStop: NodeMouseHandler = useCallback(
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
```

Why `useNodesState`/`useEdgesState`: React Flow v2 (`@xyflow/react`) treats `nodes`/`edges` as controlled. Without `onNodesChange`, dragging has no internal effect and nodes snap back, which breaks layout persistence. The state hooks supply those handlers. The second effect re-applies trace styling to the *current* nodes (preserving dragged positions) instead of rebuilding from `buildFlow`, so toggling trace never resets a user's layout.

- [ ] **Step 3: Write the state components**

Create `src/shared/StateViews.tsx`:

```tsx
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <p className="text-dimmed">{message}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <p className="max-w-lg text-center text-red-400">{message}</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/CodeNode.tsx src/features/graph/GraphView.tsx src/shared/StateViews.tsx
git commit -m "feat(ui): render react flow node graph with orthogonal edges"
```

---

### Task 18: Content pane, autosave, and app shell

**Files:**
- Create: `src/features/graph/useLayoutAutosave.ts`, `src/features/shell/ContentPane.tsx`, `src/features/shell/App.tsx`
- Modify: `src/main.tsx`
- Delete: `src/App.tsx` and `src/App.css` (template leftovers)

**Interfaces:**
- Consumes: `useFileContent`, `GraphView`, `MarkdownView`, `ErrorState`, `EmptyState`, `saveLayout`, `loadLayout`
- Produces:
  - `useLayoutAutosave(root, filePath): (positions: LayoutMap) => void` — debounced 500 ms; wired ONLY to `onNodeDragStop`
  - `<ContentPane root filePath selectedId onSelect onDragStop />`
  - `App` with resizable panels, root/file state, and split-pane mode

- [ ] **Step 1: Write the autosave hook**

Create `src/features/graph/useLayoutAutosave.ts`:

```ts
import { useCallback, useEffect, useRef } from "react";
import type { LayoutMap } from "../../shared/types";
import { saveLayout } from "../../shared/ipc";

export function useLayoutAutosave(
  root: string | null,
  filePath: string | null
): (positions: LayoutMap) => void {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  return useCallback(
    (positions: LayoutMap) => {
      if (!root || !filePath) return;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        saveLayout(root, filePath, positions).catch((error) =>
          console.error("save_layout failed", error)
        );
      }, 500);
    },
    [root, filePath]
  );
}
```

Note: this hook's returned function must only be passed to React Flow's `onNodeDragStop`. Passing it to `onNodesChange` would fire it per pixel of mouse movement.

- [ ] **Step 2: Write the content pane**

Create `src/features/shell/ContentPane.tsx`:

```tsx
import { useState } from "react";
import type { LayoutMap } from "../../shared/types";
import { useFileContent } from "./useFileContent";
import { useLayoutAutosave } from "../graph/useLayoutAutosave";
import { GraphView } from "../graph/GraphView";
import { MarkdownView } from "../markdown/MarkdownView";
import { ErrorState, EmptyState } from "../../shared/StateViews";

interface Props {
  root: string | null;
  filePath: string | null;
  onDragStop: (positions: LayoutMap) => void;
}

export function ContentPane({ root, filePath, onDragStop }: Props) {
  const state = useFileContent(root, filePath);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (state.status === "idle") {
    return <EmptyState message="Select a file to begin." />;
  }
  if (state.status === "loading") {
    return <EmptyState message="Loading…" />;
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }
  if (state.status === "markdown") {
    return <MarkdownView content={state.content} />;
  }
  return (
    <GraphView
      result={state.result}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onDragStop={onDragStop}
    />
  );
}
```

- [ ] **Step 3: Write the app shell**

Replace `src/features/shell/App.tsx` (create the file — the template's `src/App.tsx` is deleted in the next step):

```tsx
import { useCallback, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { FileExplorer } from "../explorer/FileExplorer";
import { ContentPane } from "./ContentPane";
import { useLayoutAutosave } from "../graph/useLayoutAutosave";
import type { LayoutMap } from "../../shared/types";

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [codeFile, setCodeFile] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);

  const activeFile = splitMode && docFile ? docFile : (codeFile ?? docFile);
  const savePositions = useLayoutAutosave(root, codeFile);

  const handleOpenFolder = useCallback((nextRoot: string) => {
    setRoot(nextRoot);
    setCodeFile(null);
    setDocFile(null);
  }, []);

  const handleSelectFile = useCallback((relPath: string) => {
    if (relPath.toLowerCase().endsWith(".md")) {
      setDocFile(relPath);
    } else {
      setCodeFile(relPath);
    }
  }, []);

  const handleDragStop = useCallback(
    (positions: LayoutMap) => savePositions(positions),
    [savePositions]
  );

  return (
    <div className="h-full bg-bg">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={22} minSize={12} className="border-r border-white/10">
          <FileExplorer
            root={root}
            onOpenFolder={handleOpenFolder}
            onSelectFile={handleSelectFile}
            selectedFile={activeFile}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-white/10" />
        <Panel>
          <PanelGroup direction="horizontal">
            {splitMode && docFile && (
              <>
                <Panel defaultSize={50} minSize={20}>
                  <ContentPane root={root} filePath={docFile} onDragStop={handleDragStop} />
                </Panel>
                <PanelResizeHandle className="w-1 bg-white/10" />
              </>
            )}
            <Panel minSize={20}>
              <ContentPane
                root={root}
                filePath={splitMode && docFile ? codeFile : activeFile}
                onDragStop={handleDragStop}
              />
            </Panel>
          </PanelGroup>
          <button
            type="button"
            onClick={() => setSplitMode((value) => !value)}
            className="absolute bottom-3 right-3 z-10 rounded border border-accent/40 bg-panel px-3 py-1 text-xs text-accent hover:bg-accent/10"
          >
            {splitMode ? "Single view" : "Split view"}
          </button>
        </Panel>
      </PanelGroup>
    </div>
  );
}
```

Before running the build, update `src/main.tsx` to import the shell from its feature folder and delete the template's old `src/App.tsx` and `src/App.css`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./features/shell/App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

```powershell
Remove-Item -LiteralPath "src\App.tsx","src\App.css" -ErrorAction SilentlyContinue
```

- [ ] **Step 4: Verify build and tests**

Run:

```powershell
npm run build
if ($?) { npm test }
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```powershell
git add src/main.tsx src/features/shell/App.tsx src/features/shell/ContentPane.tsx src/features/graph/useLayoutAutosave.ts
git commit -m "feat(ui): resizable shell, split view, and drag-stop autosave"
```

---

### Task 19: End-to-end manual verification

**Files:**
- No file changes (verification only)

**Interfaces:**
- Consumes: the full app
- Produces: a verified working app

- [ ] **Step 1: Start the dev app**

Run: `npm run tauri dev`
Expected: window opens with the surgical dark theme, "Open Folder" button in the left panel.

- [ ] **Step 2: Verify the code workflow**

Open this repo's folder. Click `src-tauri/src/parser/python.rs`. Expected: node graph renders with `parse_source`, `collect_defs`, `to_node`, etc.; orthogonal cyan edges between callers and callees; class/method nodes are nested.

- [ ] **Step 3: Verify tracing**

Click `collect_defs`. Expected: it and its 1-hop neighbors turn mint; everything else dims. Click empty canvas. Expected: all nodes return to normal.

- [ ] **Step 4: Verify layout persistence**

Drag `parse_source` to a new position, wait ~1 second, close and reopen the app, reopen the same folder and file. Expected: the node stays where it was dragged. Confirm `.scalpel/metadata.json` exists in the repo root and contains the file's node positions.

- [ ] **Step 5: Verify the documentation workflow**

Click `docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md`. Expected: rendered markdown with styled headings, tables, and syntax-highlighted code fences.

- [ ] **Step 6: Verify split view**

Click the spec (markdown), then a `.py` file, then "Split view". Expected: markdown on the left, node graph on the right, both resizable.

- [ ] **Step 7: Verify unsupported files**

Confirm `.css` files do not appear in the explorer (the backend filters them). Manually invoke a route check: `npm test` covers `routeForExtension("style.css") === "unsupported"`.

- [ ] **Step 8: Run the full test suites one final time**

Run:

```powershell
npm test
if ($?) { cargo test --manifest-path src-tauri/Cargo.toml }
if ($?) { npm run build }
```

Expected: all PASS.

- [ ] **Step 9: Commit any fixes found**

If verification revealed bugs, fix them and commit each fix separately with a `fix:` message. If no changes were needed, this task produces no commit.

---

### Task 20: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: user-facing documentation

- [ ] **Step 1: Write the README**

```markdown
# SyntaxScalpel

Local-first desktop app that dissects source files into interactive node graphs and renders Markdown documentation side by side. Built for fast onboarding onto undocumented codebases.

## Features

- Parse Python (`.py`) and JavaScript/TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`) into call graphs
- Class and method nesting, plus function inputs (params) and outputs (return names)
- 1-hop call tracing: click a node to highlight its callers and callees
- Markdown rendering (GFM, syntax highlighting, checkboxes)
- Resizable split view: design spec on the left, implementation graph on the right
- Node layout persists per file in `.scalpel/metadata.json`

## Requirements

- Node.js 20+
- Rust (stable toolchain)
- Windows 10/11 with WebView2 (included by default)

## Development

```powershell
npm install
npm run tauri dev
```

## Tests

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

## Roadmap

Go, C, C++, Java, C#, and Rust support are planned. HTML/CSS are out of scope for the graph model. See `docs/superpowers/specs/2026-09-22-syntaxscalpel-design.md` for the full design.
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Implementing task(s) |
|---|---|
| Architecture / Tauri shell | 1, 13 |
| Rust commands (list/parse/read/layout) | 12, 13 |
| Payload shapes + serde requirement | 2, 3 |
| Extension routing | 3, 13, 14 |
| Python extraction rules | 6, 7, 8, 9 |
| JS/TS extraction rules | 10, 11 |
| Code workflow | 14, 15, 18 |
| Documentation workflow | 16 |
| Split-pane workflow | 18, 19 |
| 1-hop trace | 4, 17, 18 |
| Theme + node design + orthogonal edges | 1, 16, 17 |
| Persistence format + onNodeDragStop + 500 ms debounce | 12, 18 |
| Error handling (parse errors, unsupported, I/O, cycles, corrupt JSON) | 12, 13, 14, 17 |
| Testing (cargo test, Vitest) | every Rust/TS task |
| Out of scope | not built |

Gap check: the "<5000 node warning banner" from the spec's error table is now implemented inside Task 17 (Step 2 renders a banner when `result.nodes.length > 5000`). No remaining spec gaps.

**Placeholder scan:** no "TBD"/"TODO"/"implement later". Every code step contains complete code. Task 5's caption numbering (`auto-layout`) is fully specified. Task 10 notes crate-version constant fallback explicitly rather than leaving it vague.

**Type consistency:** `ParseResult`/`GraphNode`/`GraphEdge`/`Position`/`LayoutMap` are defined once (Task 2 Rust, Task 3 TS) and reused with identical field names in Tasks 4–19. `routeForExtension`, `traceNeighbors`, `buildFlow`, `useFileContent`, `useLayoutAutosave`, `listDirectory`, `readMarkdown`, `parsePython`, `parseJsTs`, `saveLayout` each have one definition and matching call sites. Command names in Task 13 (`list_directory`, `read_markdown`, `parse_python`, `parse_js_ts`, `load_layout`, `save_layout`) match the `invoke` strings in Task 14. Rust arg `rel_path` maps to JS `relPath` via `#[tauri::command(rename_all = "camelCase")]` (Task 13, Step 4), matching Task 14's wrapper.
