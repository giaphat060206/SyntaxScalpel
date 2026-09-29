use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::parser::imports::{extract_imports, resolve_import_targets, stem_index};

const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 12;
const CODE_EXTENSIONS: [&str; 5] = ["py", "js", "jsx", "ts", "tsx"];
const DOC_EXTENSIONS: [&str; 12] = [
    "md", "txt", "json", "yaml", "yml", "toml", "ini", "css", "scss", "html",
    "sql", "sh",
];
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
    /// `"code"` for parsed languages, `"doc"` for markdown/config/text files.
    pub kind: String,
    pub imports: Vec<FileImport>,
    /// True for a file outside the scope that some in-scope file imports; shown
    /// so the import can still be drawn as an edge.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub external: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<String>,
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
        entry: None,
        entries: Vec::new(),
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
            let ext = ext.to_lowercase();
            let kind = if CODE_EXTENSIONS.contains(&ext.as_str()) {
                "code"
            } else if DOC_EXTENSIONS.contains(&ext.as_str()) {
                "doc"
            } else {
                continue;
            };
            if collected.len() >= MAX_FILES {
                graph.truncated = true;
                return;
            }
            let id = id_of(root, &path, scope_id);
            graph.files.push(ProjectFile {
                id: id.clone(),
                name,
                folder_id: folder_id.to_string(),
                kind: kind.to_string(),
                imports: Vec::new(),
                external: false,
            });
            collected.push((path, folder_id.to_string()));
        }
    }
}

fn code_extension(path: &Path) -> bool {
    path.extension()
        .map(|ext| CODE_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false)
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

/// Project graph for `scope_rel` inside `root`, including resolved fileâ†’file edges.
pub fn project_graph(root: &str, scope_rel: &str) -> Result<ProjectGraph, String> {
    let root_path = Path::new(root);
    let (mut graph, collected) = build_tree(root_path, scope_rel)?;

    // Only parsed languages contribute import relationships; docs/config files
    // are shown but never parsed for imports, and imports resolve to code.
    let code_paths: Vec<PathBuf> = graph
        .files
        .iter()
        .filter(|file| file.kind == "code")
        .map(|file| root_path.join(&file.id))
        .collect();
    let index = stem_index(&code_paths);
    let ids: std::collections::HashSet<String> =
        graph.files.iter().map(|file| file.id.clone()).collect();
    let mut external_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (path, _) in &collected {
        let id = id_of(root_path, path, &graph.root);
        let Some(kind) = graph
            .files
            .iter()
            .find(|file| file.id == id)
            .map(|file| file.kind.clone())
        else {
            continue;
        };
        if kind != "code" {
            continue;
        }
        let source = std::fs::read_to_string(path).unwrap_or_default();
        let mut imports = Vec::new();
        let mut edges = Vec::new();
        for entry in extract_imports(&source, &id) {
            let targets =
                resolve_import_targets(&entry.specifier, &entry.names, &id, root_path, &index);
            if targets.is_empty() {
                imports.push(FileImport {
                    target_id: String::new(),
                    specifier: entry.specifier,
                    names: entry.names,
                });
                continue;
            }
            for (target_path, specifier, names) in targets {
                let target_id = id_of(root_path, &target_path, &graph.root);
                if target_id != id {
                    if !ids.contains(&target_id) {
                        // A file outside the scope: surface it as an external node
                        // so the import still draws as an edge.
                        if external_files.insert(target_id.clone()) {
                            let external_kind = if code_extension(&target_path) {
                                "code"
                            } else {
                                "doc"
                            };
                            graph.files.push(ProjectFile {
                                id: target_id.clone(),
                                name: target_path
                                    .file_name()
                                    .map(|name| name.to_string_lossy().to_string())
                                    .unwrap_or_else(|| target_id.clone()),
                                folder_id: graph.root.clone(),
                                kind: external_kind.to_string(),
                                imports: Vec::new(),
                                external: true,
                            });
                        }
                    }
                    edges.push(ProjectEdge {
                        source: id.clone(),
                        target: target_id.clone(),
                    });
                }
                imports.push(FileImport {
                    target_id,
                    specifier,
                    names,
                });
            }
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

    // External files were appended while scanning imports; restore id order.
    graph.files.sort_by(|a, b| a.id.cmp(&b.id));

    let entries = detect_entries(root_path, scope_rel, &graph);
    graph.entry = entries.first().cloned();
    graph.entries = entries;

    // Show the primary entry file first inside its own folder so it is easy to spot.
    if let Some(entry) = graph.entry.clone() {
        graph.files.sort_by(|a, b| a.id.cmp(&b.id));
        if let Some(index) = graph.files.iter().position(|file| file.id == entry) {
            let file = graph.files.remove(index);
            let folder = file.folder_id.clone();
            let insert_at = graph
                .files
                .iter()
                .position(|other| other.folder_id == folder)
                .unwrap_or(graph.files.len());
            graph.files.insert(insert_at, file);
        }
    }
    Ok(graph)
}

/// Modules referenced by a web entry HTML (`index.html`'s module scripts).
fn html_entry_points(root: &Path, scope_rel: &str, code: &[&ProjectFile]) -> Vec<String> {
    let Ok(html) = std::fs::read_to_string(root.join(scope_rel).join("index.html")) else {
        return Vec::new();
    };
    let prefix = if scope_rel.is_empty() {
        String::new()
    } else {
        format!("{}/", scope_rel.replace('\\', "/"))
    };
    let mut found = Vec::new();
    for chunk in html.split("src=") {
        let rest = chunk.trim_start();
        let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            continue;
        };
        let Some(end) = rest[1..].find(quote) else {
            continue;
        };
        let raw = &rest[1..1 + end];
        if !(raw.ends_with(".js")
            || raw.ends_with(".jsx")
            || raw.ends_with(".ts")
            || raw.ends_with(".tsx"))
        {
            continue;
        }
        let cleaned = raw.trim_start_matches("./").trim_start_matches('/');
        let id = format!("{prefix}{cleaned}");
        if code.iter().any(|file| file.id == id) {
            found.push(id);
        }
    }
    found
}

/// Entry-point candidates: conventions first (every match), then graph roots.
/// The first candidate is treated as the primary entry point.
fn detect_entries(root: &Path, scope_rel: &str, graph: &ProjectGraph) -> Vec<String> {
    let code: Vec<&ProjectFile> = graph
        .files
        .iter()
        .filter(|f| f.kind == "code" && !f.external)
        .collect();
    let finish = |mut found: Vec<String>| -> Vec<String> {
        found.sort();
        found.dedup();
        found
    };

    // 1. A web entry HTML (`index.html`) points at its real module, which beats
    //    any file-name convention (`index.js` is often just a barrel file).
    let html_entries = html_entry_points(root, scope_rel, &code);
    if !html_entries.is_empty() {
        return finish(html_entries);
    }

    // 2. Python `if __name__ == "__main__":` guard (may be several scripts).
    let mut guarded = Vec::new();
    for file in &code {
        if let Ok(source) = std::fs::read_to_string(root.join(&file.id)) {
            if source.contains("__name__") && source.contains("__main__") {
                guarded.push(file.id.clone());
            }
        }
    }
    if !guarded.is_empty() {
        return finish(guarded);
    }

    // 3. Conventional file names, highest priority group first.
    const NAMES: [&str; 16] = [
        "main.py", "main.js", "main.jsx", "main.ts", "main.tsx", "__main__.py", "app.py",
        "manage.py", "run.py", "cli.py", "index.ts", "index.tsx", "index.js", "index.jsx",
        "server.ts", "server.js",
    ];
    for name in NAMES {
        let matches: Vec<String> = code
            .iter()
            .filter(|file| file.id.rsplit('/').next() == Some(name))
            .map(|file| file.id.clone())
            .collect();
        if !matches.is_empty() {
            return finish(matches);
        }
    }

    // 4. package.json main / module / scripts.start.
    let scope_dir = root.join(scope_rel);
    if let Ok(text) = std::fs::read_to_string(scope_dir.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let mut pointers: Vec<String> = Vec::new();
            for key in ["main", "module"] {
                if let Some(value) = json.get(key).and_then(|v| v.as_str()) {
                    pointers.push(value.to_string());
                }
            }
            if let Some(start) = json
                .get("scripts")
                .and_then(|scripts| scripts.get("start"))
                .and_then(|value| value.as_str())
            {
                pointers.push(start.to_string());
            }
            let prefix = if scope_rel.is_empty() {
                String::new()
            } else {
                format!("{}/", scope_rel.replace('\\', "/"))
            };
            let mut found = Vec::new();
            for pointer in pointers {
                let cleaned = pointer
                    .split_whitespace()
                    .last()
                    .unwrap_or("")
                    .trim_start_matches("./");
                for candidate in [
                    format!("{prefix}{cleaned}"),
                    format!("{prefix}{cleaned}.js"),
                    format!("{prefix}{cleaned}.ts"),
                    format!("{prefix}{cleaned}.tsx"),
                ] {
                    if let Some(file) = code.iter().find(|file| file.id == candidate) {
                        found.push(file.id.clone());
                    }
                }
            }
            if !found.is_empty() {
                return finish(found);
            }
        }
    }

    // 4. Graph roots: nothing imports them, but they import something.
    let mut imported = std::collections::HashSet::new();
    for edge in &graph.edges {
        imported.insert(edge.target.clone());
    }
    let mut candidates: Vec<String> = code
        .iter()
        .filter(|file| {
            !imported.contains(&file.id)
                && graph.edges.iter().any(|edge| edge.source == file.id)
        })
        .map(|file| file.id.clone())
        .collect();
    candidates.sort();
    candidates.into_iter().take(1).collect()
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
            vec![
                "data/loader.py",
                "data/loaders/io.py",
                "data/notes.txt",
                "main.py"
            ]
        );
        assert_eq!(graph.files[0].folder_id, "data");
        assert_eq!(graph.files[2].kind, "doc");
        assert_eq!(graph.files[3].folder_id, ".");
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
    fn keeps_edges_to_outside_scope_targets_as_external_nodes() {
        let root = temp_project("outside-edge");
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("shared.py"), "VALUE = 1\n").unwrap();
        std::fs::write(root.join("pkg/use.py"), "from shared import VALUE\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "pkg").unwrap();
        let external = graph
            .files
            .iter()
            .find(|file| file.id == "shared.py")
            .expect("outside-scope target is surfaced");
        assert!(external.external);
        let use_file = graph
            .files
            .iter()
            .find(|file| file.id == "pkg/use.py")
            .unwrap();
        assert!(!use_file.external);
        assert_eq!(use_file.imports[0].target_id, "shared.py");
        assert_eq!(
            graph.edges,
            vec![ProjectEdge {
                source: "pkg/use.py".into(),
                target: "shared.py".into(),
            }]
        );
    }

    #[test]
    fn prefers_the_html_referenced_module_over_a_barrel_file() {
        let root = temp_project("entry-html");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("index.html"),
            "<div id=\"root\"></div>\n<script type=\"module\" src=\"./src/main.jsx\"></script>\n",
        )
        .unwrap();
        std::fs::write(root.join("src/main.jsx"), "import App from './App.jsx'\n").unwrap();
        std::fs::write(root.join("src/App.jsx"), "export default function App() {}\n").unwrap();
        std::fs::write(
            root.join("src/index.js"),
            "export { default as LoadingScreen } from './LoadingScreen';\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(graph.entries, vec!["src/main.jsx".to_string()]);
        assert_eq!(graph.entry.as_deref(), Some("src/main.jsx"));
    }

    #[test]
    fn prefers_main_over_index_for_js_projects() {
        let root = temp_project("entry-main-js");
        std::fs::write(root.join("main.jsx"), "console.log('boot')\n").unwrap();
        std::fs::write(root.join("index.js"), "export default 1\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(graph.entry.as_deref(), Some("main.jsx"));
    }

    #[test]
    fn detects_every_guarded_script_as_an_entry() {
        let root = temp_project("entry-multi");
        std::fs::write(
            root.join("beta_script.py"),
            "if __name__ == \"__main__\":\n    pass\n",
        )
        .unwrap();
        std::fs::write(
            root.join("alpha_script.py"),
            "if __name__ == \"__main__\":\n    pass\n",
        )
        .unwrap();
        std::fs::write(root.join("helpers.py"), "def h():\n    return 1\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(
            graph.entries,
            vec!["alpha_script.py".to_string(), "beta_script.py".to_string()]
        );
        // Primary (first) entry is the lexicographically smallest match.
        assert_eq!(graph.entry.as_deref(), Some("alpha_script.py"));
        assert_eq!(graph.files[0].id, "alpha_script.py");
    }

    #[test]
    fn resolves_parent_directory_imports_with_dotted_file_names() {
        let root = temp_project("parent-dir");
        std::fs::create_dir_all(root.join("pkg/lib")).unwrap();
        std::fs::create_dir_all(root.join("pkg/app")).unwrap();
        std::fs::write(
            root.join("pkg/lib/util.helpers.js"),
            "export const util = {};\n",
        )
        .unwrap();
        std::fs::write(
            root.join("pkg/app/main.entry.js"),
            "import { util } from '../lib/util.helpers.js';\nexport const entry = util;\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert!(graph.edges.iter().any(|edge| {
            edge.source == "pkg/app/main.entry.js"
                && edge.target == "pkg/lib/util.helpers.js"
        }));
    }

    #[test]
    fn resolves_any_dotted_file_name_not_just_one_example() {
        let root = temp_project("dotted-generic");
        std::fs::write(root.join("theme.dark.css"), "body {}\n").unwrap();
        std::fs::write(root.join("settings.app.js"), "export const s = 1;\n").unwrap();
        std::fs::write(root.join("data.min.js"), "export const d = 1;\n").unwrap();
        std::fs::write(root.join("utils.js"), "export const u = 1;\n").unwrap();
        std::fs::write(
            root.join("entry.js"),
            "import './theme.dark';\nimport './settings.app';\nimport './data.min';\nimport './utils';\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let targets: Vec<&str> = graph
            .edges
            .iter()
            .filter(|edge| edge.source == "entry.js")
            .map(|edge| edge.target.as_str())
            .collect();
        assert!(targets.contains(&"theme.dark.css"));
        assert!(targets.contains(&"settings.app.js"));
        assert!(targets.contains(&"data.min.js"));
        // Ordinary names keep resolving by extension replacement.
        assert!(targets.contains(&"utils.js"));
    }

    #[test]
    fn detects_entry_by_guard_and_sorts_it_first() {
        let root = temp_project("entry-guard");
        std::fs::write(root.join("helpers.py"), "def h():\n    return 1\n").unwrap();
        std::fs::write(root.join("zeta.py"), "def z():\n    return 2\n").unwrap();
        std::fs::write(
            root.join("main.py"),
            "from helpers import h\n\nif __name__ == \"__main__\":\n    h()\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(graph.entry.as_deref(), Some("main.py"));
        assert_eq!(graph.files[0].id, "main.py");
    }

    #[test]
    fn detects_entry_by_graph_root_when_no_convention() {
        let root = temp_project("entry-root");
        std::fs::write(root.join("b.py"), "def b():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("a.py"),
            "from b import b\n\ndef run():\n    return b()\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(graph.entry.as_deref(), Some("a.py"));
    }

    #[test]
    fn detects_entry_by_conventional_name() {
        let root = temp_project("entry-name");
        std::fs::write(root.join("app.py"), "def run():\n    return 1\n").unwrap();
        std::fs::write(root.join("zzz.py"), "def z():\n    return 1\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert_eq!(graph.entry.as_deref(), Some("app.py"));
    }

    #[test]
    fn resolves_package_relative_submodule_imports() {
        let root = temp_project("pkg-relative");
        std::fs::create_dir_all(root.join("utils")).unwrap();
        std::fs::write(
            root.join("utils/__init__.py"),
            "from . import constants\nfrom . import helpers\n",
        )
        .unwrap();
        std::fs::write(root.join("utils/constants.py"), "VALUE = 1\n").unwrap();
        std::fs::write(root.join("utils/helpers.py"), "def h():\n    return 1\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let init = graph
            .files
            .iter()
            .find(|file| file.id == "utils/__init__.py")
            .unwrap();
        let targets: Vec<&str> = init
            .imports
            .iter()
            .map(|imp| imp.target_id.as_str())
            .collect();
        assert!(targets.contains(&"utils/constants.py"));
        assert!(targets.contains(&"utils/helpers.py"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "utils/__init__.py" && edge.target == "utils/constants.py"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "utils/__init__.py" && edge.target == "utils/helpers.py"));
    }

    #[test]
    fn includes_docs_but_not_unknown_types() {
        let root = temp_project("docs");
        std::fs::write(root.join("README.md"), "# hi\n").unwrap();
        std::fs::write(root.join("settings.json"), "{}\n").unwrap();
        std::fs::write(root.join("styles.css"), "body {}\n").unwrap();
        std::fs::write(root.join("app.py"), "def run():\n    return 1\n").unwrap();
        std::fs::write(root.join("notes.xyz"), "x\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let kinds: Vec<(&str, &str)> = graph
            .files
            .iter()
            .map(|file| (file.id.as_str(), file.kind.as_str()))
            .collect();
        assert!(kinds.contains(&("README.md", "doc")));
        assert!(kinds.contains(&("settings.json", "doc")));
        assert!(kinds.contains(&("styles.css", "doc")));
        assert!(kinds.contains(&("app.py", "code")));
        assert!(!kinds.iter().any(|(id, _)| *id == "notes.xyz"));
    }

    #[test]
    fn edges_can_target_config_files() {
        let root = temp_project("config-edge");
        std::fs::write(root.join("settings.json"), "{}\n").unwrap();
        std::fs::write(
            root.join("cfg.py"),
            "from settings import value\n",
        )
        .unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "cfg.py" && edge.target == "settings.json"));
    }

    #[test]
    fn resolves_cross_folder_edge() {
        let root = temp_project("cross-folder");
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("helpers.py"), "thing = 1\n").unwrap();
        std::fs::write(root.join("pkg/a.py"), "from helpers import thing\n").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let folder_ids: Vec<&str> = graph.folders.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(folder_ids, vec![".", "pkg"]);
        let file_ids: Vec<&str> = graph.files.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(file_ids, vec!["helpers.py", "pkg/a.py"]);
        assert_eq!(
            graph.edges,
            vec![ProjectEdge {
                source: "pkg/a.py".into(),
                target: "helpers.py".into(),
            }]
        );
    }

    #[test]
    fn sorts_files_deterministically() {
        let root = temp_project("ordering");
        std::fs::write(root.join("zeta.py"), "").unwrap();
        std::fs::write(root.join("alpha.py"), "").unwrap();
        std::fs::write(root.join("mid.py"), "").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let ids: Vec<&str> = graph.files.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["alpha.py", "mid.py", "zeta.py"]);
    }

    #[test]
    fn includes_empty_folders_and_no_files_when_scoped() {
        let root = temp_project("empty-folder");
        std::fs::create_dir_all(root.join("empty")).unwrap();

        let graph = project_graph(&root.to_string_lossy(), "empty").unwrap();
        let folder_ids: Vec<&str> = graph.folders.iter().map(|f| f.id.as_str()).collect();
        assert!(folder_ids.contains(&"empty"));
        assert!(graph.files.is_empty());
    }

    #[test]
    fn skips_node_modules() {
        let root = temp_project("skip-dirs");
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/junk.py"), "").unwrap();
        std::fs::write(root.join("main.py"), "").unwrap();

        let graph = project_graph(&root.to_string_lossy(), "").unwrap();
        let ids: Vec<&str> = graph.files.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["main.py"]);
    }
}
