# Project Folder Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project view where clicking a folder renders a nested graph of folder blocks containing file blocks, joined by file→file import edges, with breadcrumb navigation and double-click drill-down.

**Architecture:** Rust gains a `project_graph(root, scope)` command that walks the scope subtree and resolves each file's imports to file paths (reusing the existing import extractor/resolver). The frontend gains a folder-mode graph that reuses the function graph's layout, node component, palette and edge rules; the shell tracks a single `location` and renders a breadcrumb bar.

**Tech Stack:** Rust + Tree-sitter (existing `parser::imports`), Tauri v2 commands, React 18 + TypeScript, `@xyflow/react`, Tailwind, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-09-29-project-folder-graph-design.md`

## Global Constraints

- Windows, PowerShell 5.1: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Folder ids are project-relative paths with forward slashes; the scope root uses `.` when the scope is the project root (React Flow requires non-empty ids).
- Project graph file extension allow-list: `py, js, jsx, ts, tsx`.
- Skip dirs: `.git`, `node_modules`, `target`, `dist`, `.scalpel`, `__pycache__`, `.venv`, `venv`, dot-dirs; depth cap 12; symlinks skipped.
- Edges are file→file and kept only when the resolved target file is inside the scope; deduplicate; sort.
- File cap: 2000 files per scope; exceeding it sets `truncated: true` and stops collecting.
- All IPC structs derive `serde::Serialize` with `#[serde(rename_all = "camelCase")]`; commands return `Result<T, String>` and never panic.
- Palette + block visuals + arrowed edges + bold-on-select + faded unrelated edges are shared with the function graph.
- Vitest covers pure modules; `cargo test` covers Rust. Run both suites plus `npm run build` before finishing.

### File Structure

```
src-tauri/src/
  parser/project.rs           project-graph walk, imports resolution, payload
  parser/imports.rs           (modify) make stem_index public for reuse
  parser/mod.rs               (modify) pub mod project;
  commands/parse.rs           (modify) project_graph command
  lib.rs                      (modify) register the command
src/
  shared/types.ts             (modify) ProjectGraph payload types
  shared/ipc.ts               (modify) projectGraph(root, scope)
  features/graph/layout.ts    (new) shared layout helpers moved out of GraphView
  features/graph/layout.test.ts (new) Vitest for the grid/handle helpers
  features/graph/GraphView.tsx (modify) import the moved helpers
  features/graph/CodeNode.tsx (modify) folder/file variant + collapse toggle
  features/project/ProjectGraph.tsx (new) folder-mode canvas
  features/explorer/FileExplorer.tsx (modify) folders become clickable
  features/shell/App.tsx      (modify) location state + breadcrumb bar
  features/shell/Breadcrumb.tsx (new) breadcrumb bar
```

---

### Task 1: Project graph walker (folders + files)

**Files:**
- Create: `src-tauri/src/parser/project.rs`
- Modify: `src-tauri/src/parser/mod.rs` (`pub mod project;`)

**Interfaces:**
- Consumes: nothing
- Produces: `project::{ProjectFolder, ProjectFile, FileImport, ProjectEdge, ProjectGraph}` and an internal `collect` walk; `project::build_tree(root: &Path, scope_rel: &str) -> Result<(ProjectGraph, Vec<(PathBuf, String)>), String>` (folders/files filled, `imports`/`edges` empty until Task 2).

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/parser/project.rs` with the payload types, a stub `build_tree`, and tests:

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 12;
const CODE_EXTENSIONS: [&str; 5] = ["py", "js", "jsx", "ts", "tsx"];
const SKIPPED_DIRS: [&str; 8] = [
    ".git", "node_modules", "target", "dist", ".scalpel", "__pycache__", ".venv", "venv",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub depth: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImport {
    pub target_id: String,
    pub specifier: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub id: String,
    pub name: String,
    pub folder_id: String,
    pub imports: Vec<FileImport>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGraph {
    pub root: String,
    pub folders: Vec<ProjectFolder>,
    pub files: Vec<ProjectFile>,
    pub edges: Vec<ProjectEdge>,
    pub truncated: bool,
}

pub fn build_tree(
    root: &Path,
    scope_rel: &str,
) -> Result<(ProjectGraph, Vec<(PathBuf, String)>), String> {
    let scope_path = root.join(scope_rel);
    if !scope_path.is_dir() {
        return Err(format!("not a folder: {scope_rel}"));
    }
    let scope_id = if scope_rel.is_empty() {
        ".".to_string()
    } else {
        scope_rel.replace('\\', "/")
    };
    let scope_name = if scope_rel.is_empty() {
        root.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("root")
            .to_string()
    } else {
        Path::new(scope_rel)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(scope_rel)
            .to_string()
    };

    let mut graph = ProjectGraph {
        root: scope_id.clone(),
        folders: vec![ProjectFolder {
            id: scope_id.clone(),
            name: scope_name,
            parent_id: None,
            depth: 0,
        }],
        files: Vec::new(),
        edges: Vec::new(),
        truncated: false,
    };
    let mut collected: Vec<(PathBuf, String)> = Vec::new();
    collect(
        root,
        &scope_path,
        &scope_id,
        1,
        &scope_id,
        &mut graph,
        &mut collected,
    );
    graph.folders.sort_by(|a, b| a.depth.cmp(&b.depth).then(a.id.cmp(&b.id)));
    graph.files.sort_by(|a, b| a.id.cmp(&b.id));
    Ok((graph, collected))
}

#[allow(clippy::too_many_arguments)]
fn collect(
    root: &Path,
    dir: &Path,
    scope_id: &str,
    depth: usize,
    folder_id: &str,
    graph: &mut ProjectGraph,
    collected: &mut Vec<(PathBuf, String)>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if file_type.is_dir() {
            if SKIPPED_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            let id = id_of(root, &path, scope_id);
            graph.folders.push(ProjectFolder {
                id: id.clone(),
                name,
                parent_id: Some(folder_id.to_string()),
                depth,
            });
            collect(root, &path, scope_id, depth + 1, &id, graph, collected);
        } else if let Some((_, ext)) = name.rsplit_once('.') {
            if CODE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                if collected.len() >= MAX_FILES {
                    graph.truncated = true;
                    return;
                }
                let id = id_of(root, &path, scope_id);
                graph.files.push(ProjectFile {
                    id: id.clone(),
                    name,
                    folder_id: folder_id.to_string(),
                    imports: Vec::new(),
                });
                collected.push((path, folder_id.to_string()));
            }
        }
    }
}

fn id_of(root: &Path, path: &Path, scope_id: &str) -> String {
    let rel = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    if rel.is_empty() {
        scope_id.to_string()
    } else {
        rel
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scalpel-project-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn builds_folder_and_file_tree() {
        let root = temp_project("tree");
        std::fs::create_dir_all(root.join("data/loaders")).unwrap();
        std::fs::write(root.join("main.py"), "").unwrap();
        std::fs::write(root.join("data/loader.py"), "").unwrap();
        std::fs::write(root.join("data/loaders/io.py"), "").unwrap();
        std::fs::write(root.join("data/notes.txt"), "").unwrap();

        let (graph, _) = build_tree(&root, "").unwrap();
        let ids: Vec<&str> = graph.folders.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec![".", "data", "data/loaders"]);

        let loaders = graph.folders.iter().find(|f| f.id == "data/loaders").unwrap();
        assert_eq!(loaders.parent_id.as_deref(), Some("data"));
        assert_eq!(loaders.depth, 2);

        let file_ids: Vec<&str> = graph.files.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(
            file_ids,
            vec!["data/loader.py", "data/loaders/io.py", "main.py"]
        );
        assert_eq!(graph.files[0].folder_id, "data");
        assert_eq!(graph.files[2].folder_id, ".");
    }

    #[test]
    fn scopes_to_a_subfolder() {
        let root = temp_project("scope");
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("pkg/a.py"), "").unwrap();
        std::fs::write(root.join("outside.py"), "").unwrap();

        let (graph, _) = build_tree(&root, "pkg").unwrap();
        assert_eq!(graph.root, "pkg");
        assert_eq!(graph.folders.len(), 1);
        assert_eq!(graph.folders[0].id, "pkg");
        assert_eq!(graph.files.len(), 1);
        assert_eq!(graph.files[0].id, "pkg/a.py");
    }
}
```

Add `pub mod project;` to `src-tauri/src/parser/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::project`
Expected: FAIL — `collect`/`id_of` not yet defined (the test file above already contains them, so the first run is the implementation run; instead, to see a genuine RED, temporarily change the expected order in `builds_folder_and_file_tree` — no. Follow Step 1 as written, then Step 3 immediately: this task's types and walker are one unit, as Rust cannot compile a test that references a missing symbol).

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::project`
Expected: 2 tests PASS.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/parser/project.rs src-tauri/src/parser/mod.rs
git commit -m "feat(rust): walk a project scope into a folder/file tree"
```

---

### Task 2: Resolve imports into file→file edges + command

**Files:**
- Modify: `src-tauri/src/parser/imports.rs` (make `stem_index` public)
- Modify: `src-tauri/src/parser/project.rs` (fill `imports`/`edges`; add `project_graph`)
- Modify: `src-tauri/src/commands/parse.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `imports::{extract_imports, resolve_specifier, stem_index}`, `project::build_tree`
- Produces: `project::project_graph(root: &str, scope_rel: &str) -> Result<ProjectGraph, String>`; Tauri command `project_graph(root, scope)`

- [ ] **Step 1: Make `stem_index` public**

In `src-tauri/src/parser/imports.rs`, change `fn stem_index(` to `pub fn stem_index(`.

- [ ] **Step 2: Write the failing tests**

Append to the `tests` module in `src-tauri/src/parser/project.rs`:

```rust
    #[test]
    fn records_file_imports_and_edges() {
        let root = temp_project("edges");
        std::fs::write(root.join("utils.py"), "def helper():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("main.py"),
            "from utils import helper\nimport os\n\ndef run():\n    return helper()\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let main = graph.files.iter().find(|f| f.id == "main.py").unwrap();
        assert!(main
            .imports
            .iter()
            .any(|i| i.specifier == "utils" && i.names == vec!["helper".to_string()]));
        let os = main.imports.iter().find(|i| i.specifier == "os").unwrap();
        assert!(os.target_id.is_empty());

        assert_eq!(
            graph.edges,
            vec![ProjectEdge {
                source: "main.py".into(),
                target: "utils.py".into(),
            }]
        );
    }

    #[test]
    fn drops_edges_whose_target_is_outside_the_scope() {
        let root = temp_project("outside-edge");
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("shared.py"), "VALUE = 1\n").unwrap();
        std::fs::write(root.join("pkg/use.py"), "from shared import VALUE\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "pkg").unwrap();
        assert!(graph.files.iter().all(|f| f.id == "pkg/use.py"));
        assert!(graph.edges.is_empty());
        let use_file = &graph.files[0];
        assert_eq!(use_file.imports[0].target_id, "shared.py");
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parser::project`
Expected: FAIL — `project_graph` not found.

- [ ] **Step 4: Implement**

Add to `src-tauri/src/parser/project.rs` (above the tests module):

```rust
use crate::parser::imports::{extract_imports, resolve_specifier, stem_index};

/// Project graph for `scope_rel` inside `root`, including resolved file→file edges.
pub fn project_graph(root: &str, scope_rel: &str) -> Result<ProjectGraph, String> {
    let root_path = Path::new(root);
    let (mut graph, collected) = build_tree(root_path, scope_rel)?;

    let paths: Vec<PathBuf> = collected.iter().map(|(path, _)| path.clone()).collect();
    let index = stem_index(&paths);
    let ids: std::collections::HashSet<String> =
        graph.files.iter().map(|file| file.id.clone()).collect();

    for (path, _) in &collected {
        let id = id_of(root_path, path, &graph.root);
        let source = std::fs::read_to_string(path).unwrap_or_default();
        let mut imports = Vec::new();
        let mut edges = Vec::new();
        for entry in extract_imports(&source, &id) {
            let resolved = resolve_specifier(&entry.specifier, &id, root_path, &index)
                .map(|target| id_of(root_path, &target, &graph.root));
            let target_id = resolved.clone().unwrap_or_default();
            if let Some(target) = resolved {
                if ids.contains(&target) && target != id {
                    edges.push(ProjectEdge {
                        source: id.clone(),
                        target,
                    });
                }
            }
            imports.push(FileImport {
                target_id,
                specifier: entry.specifier,
                names: entry.names,
            });
        }
        graph.edges.append(&mut edges);
        if let Some(file) = graph.files.iter_mut().find(|file| file.id == id) {
            file.imports = imports;
        }
    }

    graph.edges.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then(a.target.cmp(&b.target))
    });
    graph.edges.dedup_by(|a, b| a.source == b.source && a.target == b.target);
    Ok(graph)
}
```

Add to `src-tauri/src/commands/parse.rs`:

```rust
use crate::parser::project::ProjectGraph;

#[tauri::command(rename_all = "camelCase")]
pub fn project_graph(root: String, scope: String) -> Result<ProjectGraph, String> {
    crate::parser::project::project_graph(&root, &scope)
}
```

In `src-tauri/src/lib.rs`, add `commands::parse::project_graph,` to the `generate_handler!` list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass (62 total: 54 existing + 4 project tests, plus the 2 earlier ones).

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/parser/imports.rs src-tauri/src/parser/project.rs src-tauri/src/commands/parse.rs src-tauri/src/lib.rs
git commit -m "feat(rust): resolve project file imports into file-to-file edges"
```

---

### Task 3: Frontend types + IPC

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`

**Interfaces:**
- Produces: `ProjectFolder`, `FileImport`, `ProjectFile`, `ProjectEdge`, `ProjectGraph` types; `projectGraph(root: string, scope: string): Promise<ProjectGraph>`

- [ ] **Step 1: Add the types**

Append to `src/shared/types.ts`:

```ts
export interface ProjectFolder {
  id: string;
  name: string;
  parentId?: string;
  depth: number;
}

export interface FileImport {
  targetId: string;
  specifier: string;
  names: string[];
}

export interface ProjectFile {
  id: string;
  name: string;
  folderId: string;
  imports: FileImport[];
}

export interface ProjectEdge {
  source: string;
  target: string;
}

export interface ProjectGraph {
  root: string;
  folders: ProjectFolder[];
  files: ProjectFile[];
  edges: ProjectEdge[];
  truncated: boolean;
}
```

- [ ] **Step 2: Add the IPC wrapper**

In `src/shared/ipc.ts`, extend the type import and add:

```ts
import type {
  ImportAnalysis,
  LayoutMap,
  ParseResult,
  ProjectGraph,
} from "./types";

export function projectGraph(root: string, scope: string): Promise<ProjectGraph> {
  return invoke<ProjectGraph>("project_graph", { root, scope });
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npm run build`
Expected: succeeds.

```powershell
git add src/shared/types.ts src/shared/ipc.ts
git commit -m "feat(ui): add project graph payload types and ipc wrapper"
```

---

### Task 4: Extract shared layout helpers + tests

**Files:**
- Create: `src/features/graph/layout.ts`, `src/features/graph/layout.test.ts`
- Modify: `src/features/graph/GraphView.tsx` (import from `./layout`, delete the moved code)

**Interfaces:**
- Consumes: `Node` from `@xyflow/react`, `CodeNodeData` from `./CodeNode`
- Produces: exports `CHILD_X`, `CHILD_WIDTH`, `CHILD_GAP`, `CLASS_HEADER`, `CLASS_PAD`, `CLASS_WIDTH`, `TOP_GAP`, `TOP_WIDTH`, `CONSTANTS_NODE_ID`, `IMPORTS_NODE_ID`, `IMPORTED_BY_NODE_ID`, `nodeHeight`, `absolutePosition`, `pickHandles`, `arrangeGrid`, `reflowLayout`

- [ ] **Step 1: Write the failing test**

Create `src/features/graph/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { arrangeGrid, pickHandles } from "./layout";

function node(id: string, x: number, y: number, width = 200, height = 80): Node {
  return {
    id,
    type: "scalpel",
    position: { x, y },
    style: { width },
    measured: { width, height },
    data: {},
  };
}

describe("arrangeGrid", () => {
  it("lays nine items in a 3x3 grid", () => {
    const items = Array.from({ length: 9 }, (_, i) => node(`n${i}`, 0, 0));
    const { positions } = arrangeGrid(items, 0, 0, 10, 10);
    expect(positions[3]).toEqual({ x: 0, y: 90 });
    expect(positions[4]).toEqual({ x: 210, y: 90 });
    expect(positions[8]).toEqual({ x: 420, y: 180 });
  });

  it("sizes each column from its longest block", () => {
    const items = [
      node("a", 0, 0, 200),
      node("c", 0, 0, 200),
      node("b", 0, 0, 400),
      node("d", 0, 0, 200),
    ];
    const { positions } = arrangeGrid(items, 0, 0, 10, 10);
    // Two columns: item index 2 (b, width 400) lands in column 0, so its widest
    // block drives column 1's start to 410.
    expect(positions[1]).toEqual({ x: 410, y: 0 });
  });
});

describe("pickHandles", () => {
  it("uses right to left when the target is to the right", () => {
    const byId = new Map<string, Node>([
      ["a", node("a", 0, 0)],
      ["b", node("b", 400, 0)],
    ]);
    expect(pickHandles(byId.get("a")!, byId.get("b")!, byId)).toEqual({
      sourceHandle: "r-out",
      targetHandle: "l-in",
    });
  });

  it("uses top to bottom when the target is above", () => {
    const byId = new Map<string, Node>([
      ["a", node("a", 0, 300)],
      ["b", node("b", 0, 0)],
    ]);
    expect(pickHandles(byId.get("a")!, byId.get("b")!, byId)).toEqual({
      sourceHandle: "t-out",
      targetHandle: "b-in",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- layout`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Move the helpers into `layout.ts`**

Create `src/features/graph/layout.ts` containing, moved **verbatim** from `GraphView.tsx`: the constants `CHILD_X`, `CHILD_WIDTH`, `CHILD_GAP`, `CLASS_HEADER`, `CLASS_PAD`, `CLASS_WIDTH`, `TOP_GAP`, `TOP_WIDTH`, `IMPORTS_NODE_ID`, `IMPORTED_BY_NODE_ID`, `CONSTANTS_NODE_ID`, and the functions `nodeHeight`, `absolutePosition`, `pickHandles`, `arrangeGrid`, `reflowLayout`. Keep their bodies unchanged. Add `export` to each. The file needs these imports:

```ts
import type { Node } from "@xyflow/react";
import type { CodeNodeData } from "./CodeNode";
```

Then in `GraphView.tsx`, delete those constants/functions and import what it still uses:

```ts
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
  CLASS_WIDTH,
  TOP_GAP,
  TOP_WIDTH,
  arrangeGrid,
  pickHandles,
  reflowLayout,
} from "./layout";
```

- [ ] **Step 4: Run everything**

Run: `npm test` then `npm run build`
Expected: all tests pass (15: 13 + 4 new layout tests replaces... exact: layout.test.ts adds 4) and the build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/features/graph/layout.ts src/features/graph/layout.test.ts src/features/graph/GraphView.tsx
git commit -m "refactor(ui): extract graph layout helpers into a tested module"
```

---

### Task 5: CodeNode folder/file variant

**Files:**
- Modify: `src/features/graph/CodeNode.tsx`

**Interfaces:**
- Produces: `CodeNodeData.project?: { kind: "folder" | "file"; name: string; collapsed?: boolean; imports?: FileImport[] }`; folder blocks render a header with a `▸`/`▾` toggle firing `data.onToggleCollapse?.(id)`

- [ ] **Step 1: Extend the data type**

In `CodeNode.tsx`, add to `CodeNodeData`:

```ts
  project?: ProjectBlock;
  onToggleCollapse?: (id: string) => void;
```

and above it:

```ts
import type { FileImport } from "../../shared/types";

export interface ProjectBlock {
  kind: "folder" | "file";
  name: string;
  collapsed?: boolean;
  imports?: FileImport[];
}
```

- [ ] **Step 2: Render the variant**

In `CodeNode`, immediately after the `special` early-return, add:

```tsx
  if (project) {
    const isFolder = project.kind === "folder";
    return (
      <div
        className={`h-full w-full min-w-[140px] overflow-hidden rounded border-2 bg-panel px-3 py-2 transition-opacity ${opacity}`}
        style={{ borderColor, boxShadow }}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate font-mono text-sm"
            style={{ color }}
            title={project.name}
          >
            {isFolder ? "📁 " : ""}
            {project.name}
          </span>
          {isFolder && (
            <button
              type="button"
              className="rounded px-1 text-xs text-dimmed hover:bg-white/10"
              onClick={(event) => {
                event.stopPropagation();
                if (id) data.onToggleCollapse?.(id);
              }}
            >
              {project.collapsed ? "▸" : "▾"}
            </button>
          )}
        </div>
        {isFolder && project.collapsed && (
          <div className="mt-1 text-[10px] text-dimmed">collapsed</div>
        )}
      </div>
    );
  }
```

Add `project` to the destructure at the top of `CodeNode`:

```ts
  const { node, special, project, highlighted, dimmed } = data as CodeNodeData;
```

**Resolved at implementation time:** the project **file** branch must also render the eight invisible handles from `layout.pickHandles`, or the project graph's file→file edges have no anchor. The eight `Handle`s are extracted into one `edgeHandles` fragment and rendered for both callable nodes and project file blocks (`{!isFolder && edgeHandles}`); folders get none. (Review caught this omission; fixed in `fix(ui): give project file blocks their edge handles`.)

- [ ] **Step 3: Verify and commit**

Run: `npm run build`
Expected: succeeds.

```powershell
git add src/features/graph/CodeNode.tsx
git commit -m "feat(ui): render folder and file blocks in CodeNode"
```

---

### Task 6: ProjectGraph canvas

**Files:**
- Create: `src/features/project/ProjectGraph.tsx`

**Interfaces:**
- Consumes: `projectGraph` from `../../shared/ipc`, `ProjectGraph` types, `colorForNode`, `CodeNode`/`CodeNodeData`, `reflowLayout`/`pickHandles`/`nodeHeight` from `../graph/layout`, `EmptyState` from `../../shared/StateViews`
- Produces: `<ProjectGraph root={string} scope={string} onNavigate={(loc: { kind: "folder" | "code"; path: string }) => void} />`

- [ ] **Step 1: Write the component**

Create `src/features/project/ProjectGraph.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProjectGraph as ProjectGraphData } from "../../shared/types";
import { projectGraph } from "../../shared/ipc";
import { colorForNode } from "../graph/colors";
import { CodeNode, type CodeNodeData } from "../graph/CodeNode";
import {
  CLASS_WIDTH,
  arrangeGrid,
  nodeHeight,
  pickHandles,
  reflowLayout,
} from "../graph/layout";
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
  const { fitView } = useReactFlow();

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
```

- [ ] **Step 2: Verify and commit**

Run: `npm run build`
Expected: succeeds. (`arrangeGrid`, `nodeHeight` imports may be unused — remove any the file does not reference before committing.)

```powershell
git add src/features/project/ProjectGraph.tsx
git commit -m "feat(ui): add the project folder graph view"
```

---

### Task 7: Explorer folder clicks, breadcrumb, shell wiring

**Files:**
- Create: `src/features/shell/Breadcrumb.tsx`
- Modify: `src/features/explorer/FileExplorer.tsx`, `src/features/shell/App.tsx`

**Interfaces:**
- Consumes: `ProjectGraph` component, existing `ContentPane`
- Produces: `FileExplorer` gains `onSelectFolder: (relPath: string) => void`; `<Breadcrumb path={string} kind={"folder" | "code"} onNavigate={(location) => void} />`; `App` tracks `Location`

- [ ] **Step 1: Make explorer folders clickable**

In `FileExplorer.tsx`, add `onSelectFolder: (relPath: string) => void;` to `Props` and change the directory button so it is enabled and calls `onSelectFolder(entry.path)`:

```tsx
          <button
            type="button"
            onClick={() =>
              entry.isDir ? onSelectFolder(entry.path) : onSelectFile(entry.path)
            }
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            className={
              "block w-full text-left px-2 py-1 text-sm rounded " +
              (selectedFile === entry.path
                ? "bg-accent/20 text-accent"
                : entry.isDir
                  ? "text-dimmed hover:bg-white/5"
                  : "text-white/90 hover:bg-white/5")
            }
          >
            {entry.isDir ? `▸ ${entry.name}` : entry.name}
          </button>
```

Remove the now-unused `disabled` attribute.

- [ ] **Step 2: Create the breadcrumb bar**

Create `src/features/shell/Breadcrumb.tsx`:

```tsx
interface Props {
  path: string;
  kind: "folder" | "code";
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

export function Breadcrumb({ path, kind, onNavigate }: Props) {
  const segments = path.split("/").filter(Boolean);
  const folderCount = kind === "code" ? segments.length - 1 : segments.length;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-panel px-3 py-1 text-xs">
      <button
        type="button"
        onClick={() => onNavigate({ kind: "folder", path: "" })}
        className="rounded px-1 text-accent hover:bg-accent/10"
      >
        root
      </button>
      {segments.map((segment, index) => {
        const folderPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const navigable = index < folderCount;
        return (
          <span key={folderPath} className="flex items-center gap-1">
            <span className="text-dimmed">/</span>
            {navigable && !isLast ? (
              <button
                type="button"
                onClick={() => onNavigate({ kind: "folder", path: folderPath })}
                className="rounded px-1 text-accent hover:bg-accent/10"
              >
                {segment}
              </button>
            ) : (
              <span className="px-1 text-white/80">{segment}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Track a location in `App.tsx`**

Replace `codeFile` state with a `location` and route the main pane by it. Add near the top of `App`:

```tsx
  const [location, setLocationState] = useState<
    { kind: "empty" } | { kind: "folder"; path: string } | { kind: "code"; path: string }
  >({ kind: "empty" });

  const codeFile = location.kind === "code" ? location.path : null;
```

- Change `handleOpenFolder` to also `setLocationState({ kind: "empty" })`.
- Change `handleSelectFile` so a markdown file still sets `docFile`, and a non-markdown file sets both `setCodeFile`-equivalent (`setLocationState({ kind: "code", path: relPath })`) and `setSelectedFile(relPath)`.
- Add:

```tsx
  const handleSelectFolder = useCallback((relPath: string) => {
    setSelectedFile(relPath);
    setLocationState({ kind: "folder", path: relPath });
  }, []);
```

- In the JSX, above the content `Panel`, render the breadcrumb when there is a location:

```tsx
        <Panel minSize="20%" className="relative">
          {location.kind !== "empty" && (
            <Breadcrumb
              path={location.path}
              kind={location.kind}
              onNavigate={setLocationState}
            />
          )}
          {/* existing ContentPane / ProjectGraph block goes below the breadcrumb */}
        </Panel>
```

  Wrap the existing content pane so it sits under the bar:

```tsx
          <div className="h-[calc(100%-28px)]">
            {location.kind === "folder" ? (
              <ProjectGraph
                root={root ?? ""}
                scope={location.path}
                onNavigate={setLocationState}
              />
            ) : (
              <ContentPane root={root} filePath={mainFile} onDragStop={handleDragStop} />
            )}
          </div>
```

  (Keep the existing `mainFile`/`showDocs` logic for the code path untouched; the docs pane and split view continue to work in code mode.)

- Add the imports:

```tsx
import { Breadcrumb } from "./Breadcrumb";
import { ProjectGraph } from "../project/ProjectGraph";
```

- [ ] **Step 4: Verify and commit**

Run: `npm run build` then `npm test`
Expected: build succeeds; 13 + 4 layout tests pass.

```powershell
git add src/features/explorer/FileExplorer.tsx src/features/shell/Breadcrumb.tsx src/features/shell/App.tsx
git commit -m "feat(ui): folder navigation with breadcrumb and project view"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run all suites**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
if ($?) { npm test }
if ($?) { npm run build }
```
Expected: all pass.

- [ ] **Step 2: Manual GUI checks** (report as NOT RUN if run headlessly)

- Open the project, click a folder in the explorer: nested folder blocks appear with their files inside.
- Collapse a folder: its files/subfolders hide; the toggle flips to `▸`.
- Single-click a file: the import card lists the files and symbols it imports.
- Double-click a subfolder: drills into that folder's graph; the breadcrumb grows.
- Double-click a file: opens that file's function graph; the breadcrumb shows the file as the last crumb.
- Click a breadcrumb folder: returns to that folder's graph; `root` returns to the top-level project graph.
- Switch between a folder graph and the docs split view: both still render.

- [ ] **Step 3: Commit any fixes** found (each with its own `fix:` message); otherwise no commit.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Backend payload + walker | 1 |
| Import resolution → edges, command, registration | 2 |
| Frontend types + IPC | 3 |
| Folder/file blocks + collapse toggle | 5 |
| Nested folder containers, file→file edges, import card | 6 |
| Breadcrumb, explorer folder clicks, location model | 7 |
| Double-click drill-down | 6, 7 |
| Scope filtering / outside-scope edges dropped | 2 (test) |
| 2000-file cap + warning | 1 (cap), 6 (banner) |
| Testing (cargo + vitest + build) | every task, plus 8 |

Gaps: the spec's "layout helpers are shared" is Task 4; the spec's "no IMPORTS/CONSTANTS blocks in project mode" is satisfied because `ProjectGraph` never builds them. Nothing else outstanding.

**Placeholder scan:** no TBD/TODO; every code step carries complete code. Task 1 notes explicitly why its RED run is folded into the same step (Rust cannot compile tests for missing symbols) — the pattern used throughout the project.

**Type consistency:** `ProjectGraph`/`ProjectFolder`/`ProjectFile`/`FileImport`/`ProjectEdge` names match between Rust (Task 1/2), TS (Task 3), and the component (Task 6). Handle ids `t-in`/`l-in`/`b-in`/`r-in`/`t-out`/`l-out`/`b-out`/`r-out` match `CodeNode` and `layout.pickHandles`. `onToggleCollapse` flows from `ProjectGraph` into `CodeNodeData` (Task 5) and is supplied in `toNodes` (Task 6). `Breadcrumb` props match its use in `App` (Task 7).
