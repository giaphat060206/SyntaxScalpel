use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::parser::imports::{extract_imports, resolve_specifier, stem_index};

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

/// Project graph for `scope_rel` inside `root`, including resolved fileâ†’file edges.
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
