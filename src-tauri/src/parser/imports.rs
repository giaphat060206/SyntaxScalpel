use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntry {
    pub specifier: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImporterEntry {
    pub path: String,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalysis {
    pub imports: Vec<ImportEntry>,
    pub imported_by: Vec<ImporterEntry>,
}

const CODE_EXTENSIONS: [&str; 5] = ["py", "ts", "tsx", "js", "jsx"];
const SKIPPED_DIRS: [&str; 8] = [
    ".git", "node_modules", "target", "dist", ".scalpel", "__pycache__", ".venv", "venv",
];

fn grammar_for(file_path: &str) -> Option<tree_sitter::Language> {
    let ext = file_path.rsplit_once('.').map(|(_, e)| e)?;
    match ext {
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        "ts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "js" | "jsx" => Some(tree_sitter_javascript::LANGUAGE.into()),
        _ => None,
    }
}

fn is_python(file_path: &str) -> bool {
    file_path.ends_with(".py")
}

fn node_text(node: Node, source: &str) -> String {
    node.utf8_text(source.as_bytes()).unwrap_or("").to_string()
}

fn strip_quotes(text: &str) -> String {
    text.trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .to_string()
}

fn push_unique(out: &mut Vec<String>, value: String) {
    if !value.is_empty() && !out.iter().any(|existing| existing == &value) {
        out.push(value);
    }
}

fn parse(source: &str, file_path: &str) -> Option<tree_sitter::Tree> {
    let mut parser = Parser::new();
    parser.set_language(&grammar_for(file_path)?).ok()?;
    parser.parse(source, None)
}

/// Import specifiers plus the names pulled from them, for one file's source.
pub fn extract_imports(source: &str, file_path: &str) -> Vec<ImportEntry> {
    let Some(tree) = parse(source, file_path) else {
        return Vec::new();
    };
    if is_python(file_path) {
        extract_python(tree.root_node(), source)
    } else {
        extract_js(tree.root_node(), source)
    }
}

fn extract_python(root: Node, source: &str) -> Vec<ImportEntry> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "import_statement" => {
                    let mut c2 = child.walk();
                    for item in child.named_children(&mut c2) {
                        match item.kind() {
                            "dotted_name" => out.push(ImportEntry {
                                specifier: node_text(item, source),
                                names: Vec::new(),
                            }),
                            "aliased_import" => {
                                if let Some(name) = item.child_by_field_name("name") {
                                    out.push(ImportEntry {
                                        specifier: node_text(name, source),
                                        names: Vec::new(),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "import_from_statement" => {
                    let module = child
                        .child_by_field_name("module_name")
                        .map(|n| node_text(n, source))
                        .unwrap_or_default();
                    let module_id = child.child_by_field_name("module_name").map(|n| n.id());
                    let mut names = Vec::new();
                    let mut c2 = child.walk();
                    for item in child.named_children(&mut c2) {
                        if Some(item.id()) == module_id {
                            continue;
                        }
                        match item.kind() {
                            "dotted_name" => push_unique(&mut names, node_text(item, source)),
                            "aliased_import" => {
                                if let Some(name) = item.child_by_field_name("name") {
                                    push_unique(&mut names, node_text(name, source));
                                }
                            }
                            "wildcard_import" => push_unique(&mut names, "*".to_string()),
                            _ => {}
                        }
                    }
                    out.push(ImportEntry { specifier: module, names });
                }
                _ => stack.push(child),
            }
        }
    }
    out
}

fn extract_js(root: Node, source: &str) -> Vec<ImportEntry> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() != "import_statement" {
                stack.push(child);
                continue;
            }
            let specifier = child
                .child_by_field_name("source")
                .map(|n| strip_quotes(&node_text(n, source)))
                .unwrap_or_default();
            let mut names = Vec::new();
            let mut c2 = child.walk();
            for item in child.named_children(&mut c2) {
                if item.kind() == "string" {
                    continue;
                }
                collect_js_names(item, source, &mut names);
            }
            out.push(ImportEntry { specifier, names });
        }
    }
    out
}

fn collect_js_names(node: Node, source: &str, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "identifier" | "shorthand_property_identifier" | "type_identifier" => {
                push_unique(out, node_text(child, source));
            }
            "string" => {}
            _ => collect_js_names(child, source, out),
        }
    }
}

fn project_files(root: &Path, depth: usize) -> Vec<PathBuf> {
    if depth >= 12 {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut files = Vec::new();
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
            files.extend(project_files(&path, depth + 1));
        } else if let Some((_, ext)) = name.rsplit_once('.') {
            if CODE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                files.push(path);
            }
        }
    }
    files
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Match an import specifier to a project file by path and filename stem.
pub fn resolve_specifier(
    specifier: &str,
    importer_rel: &str,
    root: &Path,
    stem_index: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    if specifier.is_empty() {
        return None;
    }

    if let Some(rest) = specifier.strip_prefix('.') {
        // Relative import: join against the importing file's directory.
        let base_dir = Path::new(importer_rel)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        let joined = base_dir.join(rest.trim_start_matches('/'));
        return try_candidates(root, &joined);
    }

    // Python dotted module path (e.g. `utils.helpers`).
    if !specifier.contains('/') {
        let as_path = specifier.replace('.', "/");
        if let Some(found) = try_candidates(root, Path::new(&as_path)) {
            return Some(found);
        }
    }

    // Bare specifier: fall back to matching a project file by its stem.
    let last = specifier.rsplit(['/', '.']).next().unwrap_or(specifier);
    stem_index.get(last).cloned()
}

fn try_candidates(root: &Path, relative_base: &Path) -> Option<PathBuf> {
    let base = root.join(relative_base);
    const EXTS: [&str; 17] = [
        "py", "ts", "tsx", "js", "jsx", "md", "json", "css", "scss", "html", "yaml", "yml",
        "toml", "ini", "txt", "sql", "sh",
    ];
    for ext in EXTS {
        let candidate = base.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if base.is_dir() {
        for ext in EXTS {
            let index = base.join(format!("index.{ext}"));
            if index.is_file() {
                return Some(index);
            }
        }
        let init = base.join("__init__.py");
        if init.is_file() {
            return Some(init);
        }
    }
    None
}

pub fn stem_index(files: &[PathBuf]) -> HashMap<String, PathBuf> {
    let mut index = HashMap::new();
    for file in files {
        if let Some(stem) = file.file_stem().and_then(|s| s.to_str()) {
            index.entry(stem.to_string()).or_insert_with(|| file.clone());
        }
    }
    index
}

/// Imports of `path`, plus every project file whose imports resolve to `path`.
/// `path` may be absolute or project-relative; reads are anchored to `root`.
pub fn analyze(path: &str, root: &str) -> Result<ImportAnalysis, String> {
    let root_path = Path::new(root);
    let full = root_path.join(path);
    let current_rel = relative(root_path, &full);
    let source =
        std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    let imports = extract_imports(&source, &current_rel);

    let files = project_files(root_path, 0);
    let index = stem_index(&files);

    let mut imported_by = Vec::new();
    for file in &files {
        if same_file(file, &full) {
            continue;
        }
        let Ok(other_source) = std::fs::read_to_string(file) else {
            continue;
        };
        let other_rel = relative(root_path, file);
        let mut names: Vec<String> = Vec::new();
        let mut matched = false;
        for entry in extract_imports(&other_source, &other_rel) {
            let Some(target) = resolve_specifier(&entry.specifier, &other_rel, root_path, &index)
            else {
                continue;
            };
            if same_file(&target, &full) {
                matched = true;
                for name in entry.names {
                    push_unique(&mut names, name);
                }
            }
        }
        if matched {
            imported_by.push(ImporterEntry {
                path: other_rel,
                names,
            });
        }
    }
    imported_by.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(ImportAnalysis {
        imports,
        imported_by,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scalpel-imports-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn extracts_python_imports() {
        let source = "\
import os
from utils.helpers import add, Thing
from . import sibling
";
        let entries = extract_imports(source, "main.py");
        assert!(entries
            .iter()
            .any(|e| e.specifier == "os" && e.names.is_empty()));
        assert!(entries.iter().any(|e| e.specifier == "utils.helpers"
            && e.names == vec!["add".to_string(), "Thing".to_string()]));
    }

    #[test]
    fn extracts_js_imports() {
        let source = "\
import React from 'react';
import { add, sub as minus } from './math';
import * as utils from './utils';
";
        let entries = extract_imports(source, "app.tsx");
        assert!(entries
            .iter()
            .any(|e| e.specifier == "react" && e.names == vec!["React".to_string()]));
        let math = entries
            .iter()
            .find(|e| e.specifier == "./math")
            .expect("math import");
        assert!(math.names.contains(&"add".to_string()));
        assert!(utils_names(&entries).contains(&"utils".to_string()));
    }

    fn utils_names(entries: &[ImportEntry]) -> Vec<String> {
        entries
            .iter()
            .find(|e| e.specifier == "./utils")
            .map(|e| e.names.clone())
            .unwrap_or_default()
    }

    #[test]
    fn resolves_relative_and_dotted_specifiers() {
        let root = temp_project("resolve");
        std::fs::create_dir_all(root.join("utils")).unwrap();
        std::fs::write(root.join("utils/helpers.py"), "").unwrap();
        std::fs::write(root.join("utils/index.ts"), "").unwrap();
        let files = project_files(&root, 0);
        let index = stem_index(&files);

        let dotted =
            resolve_specifier("utils.helpers", "main.py", &root, &index).expect("dotted resolves");
        assert_eq!(relative(&root, &dotted), "utils/helpers.py");

        let relative_hit =
            resolve_specifier("./helpers", "utils/caller.py", &root, &index).expect("relative");
        assert_eq!(relative(&root, &relative_hit), "utils/helpers.py");

        let bare = resolve_specifier("Button", "app.tsx", &root, &index);
        assert!(bare.is_none());
    }

    #[test]
    fn analyze_accepts_a_project_relative_path() {
        let root = temp_project("relative");
        std::fs::write(root.join("b.py"), "def thing():\n    return 1\n").unwrap();
        std::fs::write(root.join("a.py"), "from b import thing\n").unwrap();

        let analysis = analyze("b.py", &root.to_string_lossy()).unwrap();
        assert_eq!(analysis.imported_by.len(), 1);
        assert_eq!(analysis.imported_by[0].path, "a.py");
    }

    #[test]
    fn analyze_reports_importers_with_names() {
        let root = temp_project("analyze");
        std::fs::write(root.join("b.py"), "def thing():\n    return 1\n").unwrap();
        std::fs::write(
            root.join("a.py"),
            "from b import thing\n\ndef use():\n    return thing()\n",
        )
        .unwrap();

        let target = root.join("b.py");
        let analysis = analyze(&target.to_string_lossy(), &root.to_string_lossy()).unwrap();
        assert!(analysis.imports.is_empty());
        assert_eq!(analysis.imported_by.len(), 1);
        assert_eq!(analysis.imported_by[0].path, "a.py");
        assert_eq!(analysis.imported_by[0].names, vec!["thing".to_string()]);
    }

    #[test]
    fn analyze_reports_the_files_own_imports() {
        let root = temp_project("own");
        std::fs::write(root.join("c.py"), "def c():\n    return 1\n").unwrap();
        std::fs::write(root.join("d.py"), "from c import c\n").unwrap();

        let target = root.join("d.py");
        let analysis = analyze(&target.to_string_lossy(), &root.to_string_lossy()).unwrap();
        assert_eq!(analysis.imports.len(), 1);
        assert_eq!(analysis.imports[0].specifier, "c");
        assert_eq!(analysis.imports[0].names, vec!["c".to_string()]);
    }
}
