use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult};
use crate::parser::function_graph::{assemble, to_node, Def};
use crate::parser::imports::{self, ImportAnalysis, Resolver};

/// Joins an external file path to a Definition id declared inside it.
pub const EXTERNAL_SEPARATOR: &str = "::";

const MAX_EXTERNAL_FILES: usize = 12;
const MAX_EXTERNAL_DEFS: usize = 40;

/// Definitions of another file that this file's Function Graph shows, because a
/// Call Edge reaches them. `path` is also the id the frontend gives the block
/// that holds them, and the `parent` of every Definition listed here.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFile {
    pub path: String,
    pub nodes: Vec<GraphNode>,
}

/// One file's Function Graph plus the one-hop neighbourhood that reaches into
/// other files, and the Import Analysis the frontend would otherwise fetch
/// separately.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionGraph {
    pub file: ParseResult,
    pub imports: ImportAnalysis,
    pub externals: Vec<ExternalFile>,
    pub cross_edges: Vec<GraphEdge>,
    /// True when the neighbourhood caps dropped something.
    pub truncated: bool,
}

/// The id a Definition from `path` gets in this file's graph.
pub fn external_id(path: &str, def_id: &str) -> String {
    format!("{path}{EXTERNAL_SEPARATOR}{def_id}")
}

/// A file's Definitions plus the id/name lookup a call is matched against.
struct FileDefs {
    defs: Vec<Def>,
    by_name: BTreeMap<String, usize>,
}

/// Definition ids and names a call could name, mirroring `collect_edges`:
/// Containers and Variables are never Call Edge endpoints.
fn call_targets(defs: &[Def]) -> BTreeMap<String, usize> {
    let mut by_name = BTreeMap::new();
    for (index, def) in defs.iter().enumerate() {
        if def.kind == NodeKind::Class || def.kind == NodeKind::Variable {
            continue;
        }
        by_name.entry(def.id.clone()).or_insert(index);
        by_name.entry(def.name.clone()).or_insert(index);
    }
    by_name
}

/// The Definition `path` declares for `call`, if this file may reach it.
///
/// A file-level Definition must itself have been imported. A Method is reached
/// through its Container, so the importing Definition only has to reference the
/// Container's name — that is what makes `from file2 import Thing` followed by
/// `Thing().run()` a Call Edge to `Thing.run`.
fn reachable(def: &Def, call: &str, imported: &BTreeSet<String>, used: &BTreeSet<&str>) -> bool {
    match &def.parent {
        None => imported.contains(call),
        Some(container) => used.contains(container.as_str()),
    }
}

struct Neighborhood {
    root: PathBuf,
    resolver: Resolver,
    cache: BTreeMap<String, FileDefs>,
    externals: BTreeMap<String, Vec<GraphNode>>,
    edges: BTreeSet<(String, String)>,
    truncated: bool,
}

impl Neighborhood {
    /// A file's Definitions, parsed once and remembered.
    fn file(&mut self, path: &str) -> Option<&FileDefs> {
        if !self.cache.contains_key(path) {
            let source = std::fs::read_to_string(self.root.join(path)).ok()?;
            let defs = crate::parser::definitions(&source, path).ok()?;
            let by_name = call_targets(&defs);
            self.cache.insert(path.to_string(), FileDefs { defs, by_name });
        }
        self.cache.get(path)
    }

    /// Specifiers this file imports, grouped by the file they resolve to.
    fn import_targets(&self, analysis: &ImportAnalysis, rel: &str) -> Vec<(String, BTreeSet<String>)> {
        let mut targets: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for entry in &analysis.imports {
            if entry.names.is_empty() {
                continue;
            }
            for resolved in self.resolver.resolve(entry, rel) {
                let target = imports::relative(&self.root, &resolved.target);
                if target == rel {
                    continue;
                }
                targets
                    .entry(target)
                    .or_default()
                    .extend(resolved.names.iter().cloned());
            }
        }
        targets.into_iter().collect()
    }

    /// The Definition in `target` that `call` reaches, as a node for this graph.
    fn external_node(
        &mut self,
        target: &str,
        call: &str,
        imported: &BTreeSet<String>,
        used: &BTreeSet<&str>,
    ) -> Option<GraphNode> {
        let file = self.file(target)?;
        let index = *file.by_name.get(call)?;
        let def = &file.defs[index];
        if !reachable(def, call, imported, used) {
            return None;
        }
        let mut node = to_node(def);
        node.id = external_id(target, &def.id);
        node.parent = Some(target.to_string());
        Some(node)
    }

    fn push_edge(&mut self, source: &str, target: &str) {
        if source != target {
            self.edges.insert((source.to_string(), target.to_string()));
        }
    }

    fn add_external(&mut self, path: &str, node: GraphNode) {
        let known = self.externals.contains_key(path);
        if !known && self.externals.len() >= MAX_EXTERNAL_FILES {
            self.truncated = true;
            return;
        }
        if self.externals.values().map(Vec::len).sum::<usize>() >= MAX_EXTERNAL_DEFS {
            self.truncated = true;
            return;
        }
        let nodes = self.externals.entry(path.to_string()).or_default();
        if !nodes.iter().any(|existing| existing.id == node.id) {
            nodes.push(node);
        }
    }

    /// A Definition here calls something another file declares.
    fn collect_outgoing(&mut self, analysis: &ImportAnalysis, rel: &str, local: &[Def]) {
        let targets = self.import_targets(analysis, rel);
        for def in local {
            if def.calls.is_empty() {
                continue;
            }
            let used: BTreeSet<&str> = def.uses.iter().map(String::as_str).collect();
            for (target, imported) in &targets {
                for call in &def.calls {
                    let Some(node) = self.external_node(target, call, imported, &used) else {
                        continue;
                    };
                    let external = node.id.clone();
                    self.push_edge(&def.id, &external);
                    self.add_external(target, node);
                }
            }
        }
    }

    /// A Definition in another file calls something this file declares.
    fn collect_incoming(
        &mut self,
        analysis: &ImportAnalysis,
        local: &[Def],
        local_by_name: &BTreeMap<String, usize>,
    ) {
        for importer in &analysis.imported_by {
            let imported: BTreeSet<String> = importer.names.iter().cloned().collect();
            let reached = {
                let Some(file) = self.file(&importer.path) else {
                    continue;
                };
                let mut reached: Vec<(GraphNode, String)> = Vec::new();
                for caller in &file.defs {
                    if caller.calls.is_empty() {
                        continue;
                    }
                    let used: BTreeSet<&str> = caller.uses.iter().map(String::as_str).collect();
                    for call in &caller.calls {
                        let Some(&index) = local_by_name.get(call) else {
                            continue;
                        };
                        let target = &local[index];
                        if !reachable(target, call, &imported, &used) {
                            continue;
                        }
                        let mut node = to_node(caller);
                        node.id = external_id(&importer.path, &caller.id);
                        node.parent = Some(importer.path.clone());
                        reached.push((node, target.id.clone()));
                    }
                }
                reached
            };
            for (node, target_id) in reached {
                let source = node.id.clone();
                self.push_edge(&source, &target_id);
                self.add_external(&importer.path, node);
            }
        }
    }
}

/// One file's Function Graph, plus the Definitions its imports reach in other
/// files and the Call Edges between them.
pub fn function_graph(root: &str, path: &str) -> Result<FunctionGraph, String> {
    let rel = path.replace('\\', "/");
    let root_path = Path::new(root);
    let full = root_path.join(&rel);
    let source = std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;

    let defs = crate::parser::definitions(&source, &rel)?;
    let file = assemble(&defs, &rel);
    let analysis = imports::analyze(&rel, root)?;
    let local_by_name = call_targets(&defs);

    let mut builder = Neighborhood {
        root: root_path.to_path_buf(),
        resolver: imports::resolver_for(root_path),
        cache: BTreeMap::new(),
        externals: BTreeMap::new(),
        edges: BTreeSet::new(),
        truncated: false,
    };
    builder.collect_outgoing(&analysis, &rel, &defs);
    builder.collect_incoming(&analysis, &defs, &local_by_name);

    let externals = builder
        .externals
        .into_iter()
        .map(|(path, mut nodes)| {
            nodes.sort_by(|a, b| a.id.cmp(&b.id));
            ExternalFile { path, nodes }
        })
        .collect();
    let cross_edges = builder
        .edges
        .into_iter()
        .map(|(source, target)| GraphEdge { source, target })
        .collect();

    Ok(FunctionGraph {
        file,
        imports: analysis,
        externals,
        cross_edges,
        truncated: builder.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scalpel-neighborhood-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn external<'a>(graph: &'a FunctionGraph, path: &str) -> &'a ExternalFile {
        graph
            .externals
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("no external block for {path}"))
    }

    #[test]
    fn an_imported_function_shows_up_in_the_importing_graph() {
        let root = temp_project("outgoing");
        std::fs::write(root.join("file2.py"), "def func2():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("file1.py"),
            "from file2 import func2\n\ndef func1():\n    return func2()\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();

        assert_eq!(graph.cross_edges.len(), 1);
        assert_eq!(graph.cross_edges[0].source, "func1");
        assert_eq!(graph.cross_edges[0].target, "file2.py::func2");

        let block = external(&graph, "file2.py");
        assert_eq!(block.nodes.len(), 1);
        assert_eq!(block.nodes[0].id, "file2.py::func2");
        assert_eq!(block.nodes[0].name, "func2");
        // The block holding it is the file itself, one container level deep.
        assert_eq!(block.nodes[0].parent.as_deref(), Some("file2.py"));
        assert_eq!(block.nodes[0].kind, NodeKind::Function);
    }

    #[test]
    fn the_arrow_points_back_when_another_file_calls_into_this_one() {
        let root = temp_project("incoming");
        std::fs::write(root.join("file1.py"), "def func1():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("file2.py"),
            "from file1 import func1\n\ndef func2():\n    return func1()\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();

        assert!(graph.imports.imported_by.iter().any(|entry| entry.path == "file2.py"));
        assert_eq!(graph.cross_edges.len(), 1);
        assert_eq!(graph.cross_edges[0].source, "file2.py::func2");
        assert_eq!(graph.cross_edges[0].target, "func1");

        let block = external(&graph, "file2.py");
        assert_eq!(block.nodes[0].id, "file2.py::func2");
        assert_eq!(block.nodes[0].parent.as_deref(), Some("file2.py"));
    }

    #[test]
    fn a_method_is_reached_through_its_imported_container() {
        let root = temp_project("method");
        std::fs::write(
            root.join("file2.py"),
            "class Thing:\n    def run(self):\n        return 1\n",
        )
        .unwrap();
        std::fs::write(
            root.join("file1.py"),
            "from file2 import Thing\n\ndef go():\n    return Thing().run()\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();

        assert_eq!(
            graph.cross_edges,
            vec![GraphEdge {
                source: "go".into(),
                target: "file2.py::Thing.run".into(),
            }]
        );
        let block = external(&graph, "file2.py");
        assert_eq!(block.nodes.len(), 1);
        assert_eq!(block.nodes[0].kind, NodeKind::Method);
        // Flat: the file block is the only container, never a nested one.
        assert_eq!(block.nodes[0].parent.as_deref(), Some("file2.py"));
    }

    #[test]
    fn a_rust_impl_method_resolves_across_files() {
        let root = temp_project("rust");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("src/store.rs"),
            "pub struct Store;\n\nimpl Store {\n    pub fn flush(&self) {}\n}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("src/lib.rs"),
            "mod store;\nuse crate::store::Store;\n\nfn run() {\n    let s = Store;\n    s.flush();\n}\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "src/lib.rs").unwrap();

        assert!(graph.cross_edges.contains(&GraphEdge {
            source: "run".into(),
            target: "src/store.rs::Store.flush".into(),
        }));
        let block = external(&graph, "src/store.rs");
        assert_eq!(block.nodes.len(), 1);
        assert_eq!(block.nodes[0].name, "flush");
    }

    #[test]
    fn unrelated_calls_and_unresolved_imports_add_nothing() {
        let root = temp_project("noise");
        std::fs::write(
            root.join("file2.py"),
            "def func2():\n    return 1\n\ndef helper():\n    return 2\n",
        )
        .unwrap();
        std::fs::write(
            root.join("file1.py"),
            "import os\nfrom file2 import func2\n\ndef func1():\n    print(os.getcwd())\n    return 1\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();

        // `func2` is imported but never called, `helper` is never imported, and
        // `os` resolves to nothing: no block, no edge.
        assert!(graph.cross_edges.is_empty());
        assert!(graph.externals.is_empty());
    }

    #[test]
    fn a_call_in_another_file_that_does_not_reach_this_one_is_ignored() {
        let root = temp_project("importer-other-call");
        std::fs::write(root.join("file1.py"), "def func1():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("file2.py"),
            "from file1 import func1\n\ndef func2():\n    return func1()\n",
        )
        .unwrap();
        // A third file that imports nothing still gets no block.
        std::fs::write(root.join("file3.py"), "def lonely():\n    return 1\n").unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();
        assert_eq!(graph.externals.len(), 1);
        assert_eq!(graph.externals[0].path, "file2.py");
    }

    #[test]
    fn a_file_never_lists_itself_as_external() {
        let root = temp_project("self");
        std::fs::write(
            root.join("solo.py"),
            "def one():\n    return 1\n\ndef two():\n    return one()\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "solo.py").unwrap();
        assert!(graph.externals.is_empty());
        assert!(graph.cross_edges.is_empty());
        // The in-file edge is still there.
        assert_eq!(
            graph.file.edges,
            vec![GraphEdge {
                source: "two".into(),
                target: "one".into(),
            }]
        );
    }

    #[test]
    fn a_javascript_named_import_resolves() {
        let root = temp_project("js");
        std::fs::write(
            root.join("math.js"),
            "export function add(a, b) {\n  return a + b;\n}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("app.js"),
            "import { add } from './math';\n\nexport function run(a) {\n  return add(a, 1);\n}\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "app.js").unwrap();
        assert_eq!(
            graph.cross_edges,
            vec![GraphEdge {
                source: "run".into(),
                target: "math.js::add".into(),
            }]
        );
    }

    #[test]
    fn the_file_payload_and_import_analysis_come_back_together() {
        let root = temp_project("payload");
        std::fs::write(root.join("file2.py"), "def func2():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("file1.py"),
            "from file2 import func2\n\ndef func1():\n    return func2()\n",
        )
        .unwrap();

        let graph = function_graph(&root.to_string_lossy(), "file1.py").unwrap();
        assert_eq!(graph.file.file_path, "file1.py");
        assert_eq!(graph.file.nodes.len(), 1);
        assert_eq!(graph.imports.imports.len(), 1);
        assert_eq!(graph.imports.imports[0].specifier, "file2");
        assert!(!graph.truncated);
    }

    #[test]
    fn caps_mark_the_neighbourhood_truncated() {
        let root = temp_project("caps");
        // More files than the cap allows, each with one imported function.
        let mut imports = String::new();
        let mut body = String::new();
        for index in 0..(MAX_EXTERNAL_FILES + 4) {
            let name = format!("mod{index}");
            std::fs::write(
                root.join(format!("{name}.py")),
                format!("def target{index}():\n    return {index}\n"),
            )
            .unwrap();
            imports.push_str(&format!("from {name} import target{index}\n"));
            body.push_str(&format!("    target{index}()\n"));
        }
        std::fs::write(root.join("main.py"), format!("{imports}\ndef run():\n{body}")).unwrap();

        let graph = function_graph(&root.to_string_lossy(), "main.py").unwrap();
        assert!(graph.truncated);
        assert_eq!(graph.externals.len(), MAX_EXTERNAL_FILES);
    }

    #[test]
    fn an_unreadable_file_is_tolerated() {
        let root = temp_project("missing");
        std::fs::write(root.join("file1.py"), "def one():\n    return 1\n").unwrap();
        assert!(function_graph(&root.to_string_lossy(), "nope.py").is_err());
    }

    /// End-to-end over this crate's own source: `parser/rust.rs` imports
    /// `collapse_whitespace` by name from `parser/function_graph.rs` and calls
    /// it, so the cross-file Call Edge must resolve without any fixture.
    #[test]
    fn resolves_a_real_cross_file_call_edge_in_this_crate() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let graph = function_graph(&root.to_string_lossy(), "src/parser/rust.rs").unwrap();

        let block = external(&graph, "src/parser/function_graph.rs");
        assert!(block
            .nodes
            .iter()
            .any(|node| node.id == "src/parser/function_graph.rs::collapse_whitespace"));
        assert!(graph.cross_edges.iter().any(|edge| {
            edge.source == "value_def"
                && edge.target == "src/parser/function_graph.rs::collapse_whitespace"
        }));
    }
}
