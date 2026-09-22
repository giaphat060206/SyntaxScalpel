# SyntaxScalpel — Design Spec

Date: 2026-09-22
Status: Approved design, pending implementation plan

## 1. Overview

SyntaxScalpel is a local-first, native desktop application that dissects complex, undocumented codebases into visual, interactive node graphs, and renders Markdown documentation. It acts as a surgical visualization tool for source code and specs to accelerate developer onboarding.

Name: **SyntaxScalpel** (user-confirmed; repo folder `SyntaxScalper` predates the decision — logos will be reused, folder name is cosmetic).

### Purpose
Onboarding onto undocumented codebases is slow. SyntaxScalpel turns a Python file into a clickable call graph and renders Markdown specs alongside it, so a developer can compare design docs against implementation structure visually.

### MoSCoW (MVP scope)
- **Must:** Tauri shell + OS file access; Rust backend routing by extension (Tree-sitter for `.py`, raw string for `.md`); Tauri IPC bridge; React Flow node graph of Python functions; react-markdown rendering.
- **Should:** Resizable split-pane (md + graph side by side); cross-node tracing (1-hop highlight); local JSON storage (`.scalpel/metadata.json`) via Rust.
- **Could (post-MVP):** JS/Go grammars; local AI summarization (Ollama `localhost:11434`); OpenRouter BYOK.
- **Won't:** Code editing; cloud DBs/accounts/telemetry; real-time collab.

## 2. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Name | SyntaxScalpel |
| Graph scope | Single file per view (not project-wide) |
| Call edges | In-file calls only; external calls (imports, builtins) get no edge |
| Trace depth | 1-hop neighbors on click |
| `metadata.json` content | Node positions per file (layout persistence) |
| Navigation | File explorer panel (no router lib) |
| Parser scope | Functions + classes + methods (class nodes contain method child-nodes) |
| Node I/O | Inputs = signature params; outputs = `return` expression names (static) |
| Graph assembly | Rust builds finished `{nodes, edges}` JSON; frontend renders only |

## 3. Architecture

```
┌─ Tauri v2 app ──────────────────────────────────────┐
│  React 18 + TS (WebView)          Rust backend     │
│  ┌──────────────┐   IPC invoke    ┌──────────────┐  │
│  │ FileExplorer │ ──────────────► │ list_dir cmd │  │
│  │ GraphView    │ ◄────────────── │ parse_py cmd │  │
│  │ MarkdownView │   JSON payload  │ read_file    │  │
│  └──────────────┘                 │ save/load    │  │
└─────────────────────────────────────────────────────┘
```

- **Framework:** Tauri v2, React 18 + TypeScript, Tailwind CSS.
- **Graph:** React Flow, orthogonal edges (`type: "step"`).
- **Docs:** react-markdown + remark-gfm + rehype-highlight + `@tailwindcss/typography` (`prose prose-invert`).
- **Layout:** `react-resizable-panels`.
- **State:** plain React state + context; no router.

### Rust commands (Tauri v2 IPC contract)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `list_directory(path)` | absolute path | file tree (recursive, filtered to code/doc extensions) | for explorer panel |
| `parse_python(path)` | absolute path | `{nodes, edges}` | Tree-sitter walk; merges saved layout |
| `read_markdown(path)` | absolute path | raw string | for MarkdownView |
| `load_layout(path)` | absolute file path | layout map or null | reads `.scalpel/metadata.json` |
| `save_layout(path, layout)` | file path + node position map | ok | writes `.scalpel/metadata.json` |

All commands return `Result<T, String>`; errors surface as inline error states, never panics.

### Payload shapes

```ts
type NodeKind = "function" | "class" | "method";
interface GraphNode {
  id: string;            // "name" or "ClassName.method"
  kind: NodeKind;
  name: string;
  params: string[];
  returns: string[];     // names from return statements; [] if none
  parent?: string;       // class id, for methods
  position?: { x: number; y: number }; // from metadata.json, if saved
}
interface GraphEdge {
  source: string;        // caller node id
  target: string;        // callee node id (in-file only)
}
interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filePath: string;      // project-relative
}
```

### Extraction rules (Rust, Tree-sitter Python)
- Nodes: top-level `function_definition` → `function`; top-level `class_definition` → `class`; `function_definition` inside class body → `method` with `parent` = class id.
- Inputs: parameters from signature (`def f(a, b=1)` → `["a", "b"]`).
- Outputs: identifiers/attribute names returned in `return` statements (multiple returns may yield multiple entries). Function with no return → empty `returns`.
- Edges: call-expression inside function/method body whose callee name matches a top-level function or method name in the same file. Calls resolving to nothing (imports, builtins, unknown) produce no edge.
- Class constructor references are not edges (MVP); only explicit call matches.

## 4. Workflows

### Code workflow
1. User clicks `.py` in explorer.
2. Frontend invokes `parse_python(path)`.
3. Rust: read file → Tree-sitter parse → extract nodes/edges → load positions from `.scalpel/metadata.json` → return JSON.
4. GraphView renders React Flow graph: sharp orthogonal edges, cyan nodes.
5. User drags node → debounced `save_layout` (500 ms).

### Documentation workflow
1. User clicks `.md`.
2. Frontend invokes `read_markdown(path)`.
3. MarkdownView renders GitHub-flavored markdown, syntax-highlighted code fences, interactive checkboxes.

### Split-pane workflow
- Layout: `[ FileExplorer | MarkdownView | GraphView ]` — resizable panes. Single-file mode: `[ FileExplorer | content ]` where content swaps by extension.

### Trace (cross-node)
- Click node → node + direct callers/callees highlighted (mint), everything else dimmed ~30% opacity.
- Click canvas background → reset.
- Pure frontend filter over `edges`.

## 5. UI / Theme

- Aesthetic: clinical "surgical" dark theme.
- Tailwind tokens:
  - bg `#1E2329`, panel `#161B20`
  - accent `#00F0FF` (neon cyan) — edges, headers
  - highlight `#3DF0A8` (mint) — trace highlights
  - text: optic white; dimmed `#8A93A0`
- Node design:
  - Function node: name header (cyan), inputs left column (params), outputs bottom/right (return names).
  - Class node: container node; method child-nodes rendered inside (React Flow `parentNode`).
- Edges: 2px, orthogonal; cyan normal, mint highlighted.
- MarkdownView: `prose prose-invert`, code fences highlighted.

## 6. Persistence

`.scalpel/metadata.json` in the opened project root (project root = the folder the user opens in the file explorer):

```json
{
  "version": 1,
  "layouts": {
    "src/main.py": {
      "node-id-1": { "x": 120, "y": 340 },
      "node-id-2": { "x": 420, "y": 340 }
    }
  }
}
```

- Key = project-relative file path. Node id matches payload node ids.
- Auto-save debounced 500 ms after drag end.
- Missing `.scalpel/` → created on save. Corrupt JSON → ignored, fresh start.

## 7. Error handling

| Case | Behavior |
|---|---|
| Tree-sitter parse errors | Error-tolerant: parse what's parseable; no functions found → empty-state "No functions detected" |
| Unsupported extension clicked | Toast: "Unsupported file type" |
| File read errors / missing paths | `Err(String)` → inline error state in content pane |
| Huge file (>5000 nodes) | Render + warning banner; no virtualization in MVP |
| Non-UTF8 file | Error payload, no panic |
| Call-graph cycles | Fine; 1-hop trace means no infinite walk |
| Corrupt `metadata.json` | Ignore, start fresh |

## 8. Testing

- **Rust:** `cargo test` against fixture `.py` files — extraction rules (nodes, params, returns, edges, cycles, parse errors).
- **TypeScript:** Vitest — 1-hop trace filter, payload validation, layout merge logic.
- Playwright e2e: post-MVP, not MVP.

## 9. Out of scope (MVP)

- Direct code editing.
- Project-wide call graphs.
- Cloud anything (DB, accounts, telemetry).
- Collaborative editing.
- Additional languages (JS/Go).
- AI summarization (Ollama / OpenRouter).
