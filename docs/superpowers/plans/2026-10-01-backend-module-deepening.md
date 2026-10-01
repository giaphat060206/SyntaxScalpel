# Backend Module Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the Rust parser so Entry Point detection, import resolution, and the per-language Function Graph scaffolding each sit behind one narrow interface, and stop parsing through the layout module.

**Architecture:** `project::detect_entries` takes a narrow file/edge view plus an injected reader instead of the whole graph and direct disk access. `imports` splits into extraction and a `Resolver` built once per scan. A shared `function_graph` module owns edge/uses/returns assembly; each language supplies only its definition extractor and a `calls_in` reader. The command layer delegates to one parser-owned `parse_file`, and the layout plumbing is deleted.

**Tech Stack:** Rust (edition 2021), `tree-sitter` 0.25 (+ python/typescript/javascript grammars), `serde`/`serde_json`.

**Specs:** `GLOSSARY.md`, `docs/adr/0001-single-file-function-graphs.md`, `docs/adr/0002-no-layout-persistence.md` (amended: layout commands, `Position` field, and parser layout parameter removed).

## Global Constraints

- Windows, PowerShell 5.1: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- All IPC payload structs derive `Serialize` with `#[serde(rename_all = "camelCase")]`; commands return `Result<T, String>` and never panic.
- Edges are in-file only; class ids are never edge targets; no self-edges (ADR-0001).
- No layout persistence; no parse path reads `.scalpel/metadata.json` (ADR-0002).
- `cargo test --manifest-path src-tauri/Cargo.toml` must pass before each commit.
- Tell the user to restart `npm run tauri dev` after each Rust change.

### File Structure

```
src-tauri/src/parser/
  project.rs          (modify) narrow detect_entries, ScopeTree, promote_primary_entry, tier fns
  imports/mod.rs      (new) re-exports; ImportEntry/ImporterEntry/ImportAnalysis
  imports/extract.rs  (new) tree-sitter extraction (from imports.rs)
  imports/resolve.rs  (new) Resolver, AliasMap, resolve_specifier, try_candidates, stem_index
  function_graph.rs   (new) Def, to_node, collect_edges, text/traversal helpers, assemble
  python.rs           (modify) extractor + calls_in; parse_source delegates
  jsts.rs             (modify) extractor + calls_in; parse_source delegates
src-tauri/src/commands/
  parse.rs            (modify) parser-owned parse_file; one-liner commands
  layout.rs           (delete)
src-tauri/src/lib.rs  (modify) drop layout registrations
src-tauri/src/models.rs (modify) drop Position + GraphNode.position
```

---

### Task 1: Narrow Entry Point detection

**Files:**
- Modify: `src-tauri/src/parser/project.rs`

**Interfaces:**
- Produces:

```rust
pub struct ScopeTree { pub graph: ProjectGraph, pub collected: Vec<(PathBuf, String)> }
pub struct EntryFile { pub id: String, pub folder_id: String }
pub fn build_tree(root: &Path, scope_rel: &str) -> Result<ScopeTree, String>;
pub fn detect_entries(
    files: &[EntryFile],
    folders: &[&str],
    edges: &[ProjectEdge],
    read: &dyn Fn(&str) -> Option<String>,
) -> Vec<String>;
pub fn promote_primary_entry(graph: &mut ProjectGraph);
```

- [ ] **Step 1: Write the failing test**

Add to `project.rs`'s test module:

```rust
#[test]
fn detects_entry_by_guard_from_injected_reader() {
    let files = vec![
        EntryFile { id: "helpers.py".into(), folder_id: ".".into() },
        EntryFile { id: "main.py".into(), folder_id: ".".into() },
    ];
    let read = |path: &str| match path {
        "main.py" => Some("if __name__ == \"__main__\":\n    pass\n".to_string()),
        _ => Some(String::new()),
    };
    let entries = detect_entries(&files, &["."], &[], &read);
    assert_eq!(entries, vec!["main.py".to_string()]);
}

#[test]
fn detects_name_entry_without_reading_files() {
    let files = vec![
        EntryFile { id: "zeta.py".into(), folder_id: ".".into() },
        EntryFile { id: "app.py".into(), folder_id: ".".into() },
    ];
    let read = |_: &str| None;
    let entries = detect_entries(&files, &["."], &[], &read);
    assert_eq!(entries, vec!["app.py".to_string()]);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml detect_entry -- --nocapture`
Expected: FAIL — `EntryFile`/`detect_entries` signature mismatch.

- [ ] **Step 3: Introduce `ScopeTree`, `EntryFile`, and the reader-based tiers**

- Change `build_tree` to return `Result<ScopeTree, String>`; update `project_graph` to `let ScopeTree { mut graph, collected } = build_tree(...)?;`.
- Add `pub struct EntryFile { pub id: String, pub folder_id: String }`; in `project_graph`, build `let entry_files: Vec<EntryFile> = graph.files.iter().filter(|f| f.kind == "code" && !f.external).map(|f| EntryFile { id: f.id.clone(), folder_id: f.folder_id.clone() }).collect();`.
- Split `detect_entries` into `entry_by_html`, `entry_by_main_guard`, `entry_by_name`, `entry_by_package`, `entry_by_graph_root`, each taking `files`/`folders`/`edges`/`read` as needed, and compose them in the current priority order. `read` is called with project-relative paths (`pkg/index.html`, `main.py`, `pkg/package.json`); join folder + file name with `/` (a root folder id `"."` contributes no prefix).
- In `project_graph`, call `detect_entries(&entry_files, &folders, &graph.edges, &|path| std::fs::read_to_string(root_path.join(path)).ok())`, then set `graph.entry`/`graph.entries`.
- Extract `promote_primary_entry(&mut ProjectGraph)` from lines 321–334 and call it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass (existing 17 entry tests now exercise the same rules through the new signature).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/parser/project.rs
git commit -m "refactor(rust): give Entry Point detection a narrow reader-based interface"
```

---

### Task 2: Split imports into extract and resolve

**Files:**
- Create: `src-tauri/src/parser/imports/mod.rs`, `imports/extract.rs`, `imports/resolve.rs` (move from `imports.rs`)
- Delete: `src-tauri/src/parser/imports.rs`

**Interfaces:**
- Consumes: `tree_sitter`, `serde_json`.
- Produces:

```rust
pub struct ResolvedImport { pub target: PathBuf, pub specifier: String, pub names: Vec<String> }
pub struct Resolver { /* root, index, aliases */ }
impl Resolver {
    pub fn new(root: &Path, files: &[PathBuf], aliases: AliasMap) -> Resolver;
    pub fn load(root: &Path) -> Resolver;
    pub fn resolve(&self, entry: &ImportEntry, importer_rel: &str) -> Vec<ResolvedImport>;
}
impl AliasMap {
    pub fn from_json(json: &serde_json::Value) -> AliasMap;
    pub fn candidates(&self, specifier: &str) -> Vec<PathBuf>;
    pub fn resolve(&self, specifier: &str, root: &Path) -> Option<PathBuf>;
}
```

- [ ] **Step 1: Write the failing tests**

Create `imports/resolve.rs`'s test module with:

```rust
#[test]
fn alias_candidates_are_pure() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#)
            .unwrap();
    let aliases = AliasMap::from_json(&json);
    let candidates = aliases.candidates("@/util");
    assert_eq!(candidates, vec![PathBuf::from("src/util")]);
}

#[test]
fn resolver_matches_an_import_to_a_target() {
    let root = temp_project("resolver");
    std::fs::write(root.join("utils.py"), "VALUE = 1\n").unwrap();
    let files = vec![root.join("utils.py")];
    let resolver = Resolver::new(&root, &files, AliasMap::default());
    let entry = ImportEntry { specifier: "utils".into(), names: vec!["VALUE".into()] };
    let resolved = resolver.resolve(&entry, "main.py");
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].target, root.join("utils.py"));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml alias_candidates resolver_matches`
Expected: FAIL — `AliasMap::from_json`/`Resolver` undefined.

- [ ] **Step 3: Move and deepen**

- Create `imports/` and move: extraction (`grammar_for`, `is_python`, `parse`, `extract_imports`, `extract_python`, `extract_js`, `collect_js_names`, `node_text`, `strip_quotes`, `push_unique`) → `extract.rs`; the payload structs + `Resolver` + `AliasMap` + `resolve_specifier` + `try_candidates` + `stem_index` + `project_files` + `relative` + `same_file` + `analyze` → `resolve.rs`; `mod.rs` re-exports `ImportEntry`, `ImporterEntry`, `ImportAnalysis`, `extract_imports`, `AliasMap`, `Resolver`, `analyze` so existing paths (`crate::parser::imports::…`) keep working.
- Add `AliasMap::from_json` and `AliasMap::candidates`; make `load` read the file and delegate to `from_json`; make `resolve` = first existing candidate via `try_candidates`.
- Add `Resolver::new` (stores root, `stem_index(files)`), `Resolver::load` (`project_files` + `AliasMap::load`), and `resolve` (the body of `resolve_import_targets_with_aliases`, returning `ResolvedImport` values).
- Delete `resolve_import_targets` (the `#[allow(dead_code)]` twin) and `resolve_import_targets_with_aliases`.
- Rewrite `project_graph`'s import loop to `let resolver = Resolver::new(root_path, &code_paths, AliasMap::load(root_path));` and `resolver.resolve(&entry, &id)`. Rewrite `analyze` to `let resolver = Resolver::load(root_path);` and `resolver.resolve(&entry, &other_rel)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -A src-tauri/src/parser/imports
git commit -m "refactor(rust): split import extraction from a deep Resolver, delete dead twin"
```

---

### Task 3: Share the Function Graph scaffolding

**Files:**
- Create: `src-tauri/src/parser/function_graph.rs`
- Modify: `src-tauri/src/parser/python.rs`, `src-tauri/src/parser/jsts.rs`, `src-tauri/src/parser/mod.rs`

**Interfaces:**
- Produces:

```rust
pub struct Def<'a> {
    pub id: String, pub kind: NodeKind, pub name: String,
    pub params: Vec<String>, pub returns: Vec<String>, pub uses: Vec<String>,
    pub value: Option<String>, pub parent: Option<String>,
    pub start_line: usize, pub end_line: usize, pub body: Option<tree_sitter::Node<'a>>,
}
pub fn line_range(node: tree_sitter::Node) -> (usize, usize);
pub fn node_text(node: tree_sitter::Node, source: &str) -> String;
pub fn collapse_whitespace(text: &str) -> String;
pub fn to_node(def: &Def, layout: &HashMap<String, Position>) -> GraphNode;
pub fn collect_edges(defs: &[Def], source: &str, calls_in: fn(tree_sitter::Node, &str) -> Vec<String>) -> Vec<GraphEdge>;
pub fn assemble(defs: Vec<Def>, source: &str, file_path: &str, layout: &HashMap<String, Position>, calls_in: fn(tree_sitter::Node, &str) -> Vec<String>) -> ParseResult;
```

- [ ] **Step 1: Write the failing test**

Create `function_graph.rs`'s test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NodeKind;

    fn def(id: &str, kind: NodeKind) -> Def<'static> {
        Def { id: id.into(), kind, name: id.into(), params: vec![], returns: vec![],
              uses: vec![], value: None, parent: None, start_line: 1, end_line: 1, body: None }
    }

    #[test]
    fn collect_edges_dedups_and_skips_self_edges() {
        let mut caller = def("caller", NodeKind::Function);
        caller.body = None;
        let defs = vec![caller, def("callee", NodeKind::Function)];
        let edges = collect_edges(&defs, "", |_, _| vec!["callee".into(), "callee".into()]);
        assert_eq!(edges, vec![]); // no body => no edges
    }

    #[test]
    fn class_ids_are_never_edge_targets() {
        let defs = vec![def("C", NodeKind::Class)];
        let edges = collect_edges(&defs, "", |_, _| vec!["C".into()]);
        assert!(edges.is_empty());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml function_graph`
Expected: FAIL — module undefined.

- [ ] **Step 3: Create the shared module and rewire both languages**

- Move `Def`, `line_range`, `to_node`, `node_text`, `collapse_whitespace` into `function_graph.rs` (make `Def` fields `pub`, `Def` `pub`).
- Move `collect_edges` in, replacing its `collect_calls(body, source, &mut calls)` with `let calls = calls_in(body, source);`. Keep the target map, self-edge, and dedup rules verbatim (ADR-0001).
- Add `assemble`: `let nodes = defs.iter().map(|d| to_node(d, layout)).collect(); let edges = collect_edges(&defs, source, calls_in); Ok(ParseResult { nodes, edges, file_path: file_path.to_string() })`.
- In `python.rs`: keep `def`-building (`collect_defs`, `function_def`, `variable_def`, `unwrap_decorated`, `parameter_names`, `param_name`) and the node-kind traversals (`collect_uses`, `uses_in`, `uses_in_text`, `collect_returns`, `collect_expr_names`, `push_unique`); add `pub fn calls_in(node: Node, source: &str) -> Vec<String>` wrapping the current `collect_calls`; `parse_source` becomes: parse the tree, `let defs = collect_defs(...)`, then `Ok(function_graph::assemble(defs, source, file_path, layout, calls_in))`.
- In `jsts.rs`: same shape — keep `collect_defs`, `collect_declarators`, `collect_object_methods`, `collect_methods_in_object`, `ancestor_variable_name`, `declared_function`, `parameter_names`, `collect_uses`, `uses_in`, `uses_in_text`, `collect_returns`, `collect_expr_names`, `push_unique`, and add `calls_in` from its `collect_calls`.
- Add `pub mod function_graph;` to `parser/mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass — the language suites still assert extraction + edges through `parse_source`.

- [ ] **Step 5: Commit**

```powershell
git add -A src-tauri/src/parser
git commit -m "refactor(rust): share the Function Graph assembler across languages"
```

---

### Task 4: Thin the command layer and drop layout

**Files:**
- Modify: `src-tauri/src/commands/parse.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models.rs`
- Modify: `src-tauri/src/parser/function_graph.rs` (`assemble` drops `layout`), `python.rs`, `jsts.rs`
- Modify: `src/features/...` frontend payload types
- Delete: `src-tauri/src/commands/layout.rs`

**Interfaces:**
- Produces: `pub fn parse_file(root: &str, rel: &str, language: Language) -> Result<ParseResult, String>` in `parser/mod.rs`; `parse_source(source, file_path)` without `layout`; `GraphNode` without `position`.

- [ ] **Step 1: Write the failing test**

Add to `commands/parse.rs`'s test module:

```rust
#[test]
fn parse_file_anchors_to_root() {
    let dir = std::env::temp_dir().join(format!("scalpel-parse-file-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("nested")).unwrap();
    std::fs::write(dir.join("nested/b.py"), "def two():\n    return 2\n").unwrap();

    let result = crate::parser::parse_file(
        &dir.to_string_lossy(),
        "nested/b.py",
        crate::parser::Language::Python,
    )
    .unwrap();
    assert_eq!(result.nodes[0].name, "two");
    assert_eq!(result.file_path, "nested/b.py");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_file_anchors`
Expected: FAIL — `parse_file`/`Language` undefined.

- [ ] **Step 3: Implement and delete**

- In `parser/mod.rs` add:

```rust
pub enum Language { Python, JsTs }
pub fn parse_file(root: &str, rel: &str, language: Language) -> Result<ParseResult, String> {
    let full = std::path::Path::new(root).join(rel);
    let source = std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    match language {
        Language::Python => python::parse_source(&source, rel, &Default::default()),
        Language::JsTs => jsts::parse_source(&source, rel, &Default::default()),
    }
}
```

(This bridge keeps the `layout` parameter for one task; Step 4 removes it.)

- Replace `commands/parse.rs`'s `parse_with` with delegations: `parse_python` → `parser::parse_file(&root, &path, Language::Python)`, `parse_js_ts` → `Language::JsTs`; `analyze_imports`/`project_graph` unchanged one-liners. Remove the `relative_path`, `load_layout`, `Position`, and `HashMap` imports.
- In `function_graph.rs` drop the `layout` parameter from `assemble`/`to_node`, and in `python.rs`/`jsts.rs` drop `layout` from `parse_source`/`to_node`; update `parser::parse_file` accordingly and remove `Default::default()`.
- In `models.rs` delete `Position` and `GraphNode.position`; update the serialization test (lines ~94) that sets `position`.
- Delete `commands/layout.rs`; remove the two `commands::layout::…` lines from `lib.rs`.
- Frontend: in `src/shared/types.ts` delete `Position` from `GraphNode` (keep `Position` as the canvas coordinate type); in `src/features/graph/flow.ts` remove the `GraphNode.position` fallback; in `GraphView.tsx`'s `toFlowNode` set `pinned: false` and delete the now-unused `pinned` branch in `layout.ts` + `CodeNode.tsx`'s `pinned?` field.

- [ ] **Step 4: Run all suites and search for stragglers**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`; then `rg -n "load_layout|save_layout|Position|position" src-tauri/src`
Expected: Rust tests pass; no `load_layout`/`save_layout` matches; `Position`/`position` only where a canvas coordinate is genuinely needed.

Run: `npm test` then `npm run build`
Expected: all pass (delete `applies_saved_positions_by_node_id` and `leaves_position_none_when_not_in_layout`).

- [ ] **Step 5: Commit**

```powershell
git add -A src-tauri src
git commit -m "refactor: parse through one parser seam and delete layout persistence plumbing"
```

---

## Self-Review

**Spec coverage:**

| Deepening | Task |
|---|---|
| #5 Entry Point seam | 1 |
| #6 Resolver | 2 |
| #7 Shared scaffolding | 3 |
| #8 Command layer / drop layout | 4 |

**Placeholder scan:** no TBD/TODO. Large code moves (Tasks 2, 3) are specified as exact symbol lists to relocate plus the new signatures, because the moved bodies are unchanged.

**Type consistency:** `ScopeTree`/`EntryFile`/`detect_entries` defined in Task 1 and consumed by `project_graph` in the same task. `ResolvedImport`/`Resolver`/`AliasMap` defined in Task 2 and consumed by `project_graph` and `analyze`. `Def`/`collect_edges`/`assemble` defined in Task 3; `assemble`'s `layout` parameter is removed in Task 4 alongside `parse_source`. `Language`/`parse_file` defined in Task 4 and used by `commands/parse.rs`.

## Ordering and checkpoints

- Backend Tasks 1–4 are independent of the frontend plan except Task 4's frontend payload edits; run the frontend plan's Tasks 3–4 before Task 4 here if working in parallel, or accept the small conflict.
- After each Rust task: restart `npm run tauri dev` before manual GUI checks.
- Every task ends green on `cargo test` (and `npm test`/`npm run build` for Task 4).
