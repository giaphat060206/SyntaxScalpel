use serde::Serialize;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntry {
    pub specifier: String,
    pub names: Vec<String>,
}

/// Lower-cased extension, matching how the project graph classifies files.
fn extension_of(file_path: &str) -> Option<String> {
    file_path.rsplit_once('.').map(|(_, ext)| ext.to_lowercase())
}

fn grammar_for(file_path: &str) -> Option<tree_sitter::Language> {
    match extension_of(file_path)?.as_str() {
        "py" => Some(tree_sitter_python::LANGUAGE.into()),
        "ts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        "js" | "jsx" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        _ => None,
    }
}

fn language_of(file_path: &str) -> &'static str {
    match extension_of(file_path).as_deref() {
        Some("py") => "python",
        Some("rs") => "rust",
        _ => "js",
    }
}

fn node_text(node: Node, source: &str) -> String {
    node.utf8_text(source.as_bytes()).unwrap_or("").to_string()
}

fn strip_quotes(text: &str) -> String {
    text.trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .to_string()
}

pub(crate) fn push_unique(out: &mut Vec<String>, value: String) {
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
    match language_of(file_path) {
        "python" => extract_python(tree.root_node(), source),
        "rust" => extract_rust(tree.root_node(), source),
        _ => extract_js(tree.root_node(), source),
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
                            "dotted_name" | "identifier" => {
                                push_unique(&mut names, node_text(item, source))
                            }
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

/// Rust `use` trees and `mod` declarations, flattened to one entry per imported
/// path: `crate::a::{b, c}` becomes `crate::a::b` and `crate::a::c`.
fn extract_rust(root: Node, source: &str) -> Vec<ImportEntry> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            match child.kind() {
                "use_declaration" => {
                    if let Some(argument) = child.child_by_field_name("argument") {
                        collect_use(argument, "", source, &mut out);
                    }
                }
                // `mod foo;` pulls in a sibling module file; the inline form
                // defines its own items and so declares no dependency.
                "mod_item" => {
                    if child.child_by_field_name("body").is_none() {
                        if let Some(name) = child.child_by_field_name("name") {
                            let text = node_text(name, source);
                            if !text.is_empty() {
                                out.push(ImportEntry {
                                    specifier: format!("self::{text}"),
                                    names: Vec::new(),
                                });
                            }
                        }
                    }
                }
                _ => {}
            }
            stack.push(child);
        }
    }
    out
}

fn collect_use(argument: Node, prefix: &str, source: &str, out: &mut Vec<ImportEntry>) {
    match argument.kind() {
        "use_as_clause" => {
            let path = argument
                .child_by_field_name("path")
                .map(|path| join_use_path(prefix, &node_text(path, source)))
                .unwrap_or_else(|| prefix.to_string());
            let alias = argument
                .child_by_field_name("alias")
                .map(|alias| node_text(alias, source))
                .unwrap_or_default();
            let names = if alias.is_empty() {
                last_segment(&path)
            } else {
                vec![alias]
            };
            out.push(ImportEntry {
                specifier: path,
                names,
            });
        }
        "use_wildcard" => {
            let text = node_text(argument, source);
            let base = text.trim().trim_end_matches('*').trim_end_matches("::");
            out.push(ImportEntry {
                specifier: join_use_path(prefix, base),
                names: vec!["*".to_string()],
            });
        }
        "scoped_use_list" => {
            let path = argument
                .child_by_field_name("path")
                .map(|path| join_use_path(prefix, &node_text(path, source)))
                .unwrap_or_else(|| prefix.to_string());
            let Some(list) = argument.child_by_field_name("list") else {
                return;
            };
            let mut cursor = list.walk();
            for item in list.named_children(&mut cursor) {
                collect_use(item, &path, source, out);
            }
        }
        "use_list" => {
            let mut cursor = argument.walk();
            for item in argument.named_children(&mut cursor) {
                collect_use(item, prefix, source, out);
            }
        }
        // `use path::{self, other}`: `self` names the path itself.
        "self" => out.push(ImportEntry {
            specifier: prefix.to_string(),
            names: last_segment(prefix),
        }),
        _ => {
            let path = join_use_path(prefix, &node_text(argument, source));
            let names = last_segment(&path);
            out.push(ImportEntry { specifier: path, names });
        }
    }
}

/// Splice a nested `use` item onto the path it was nested under.
fn join_use_path(prefix: &str, raw: &str) -> String {
    let raw = raw.trim();
    if prefix.is_empty() || raw.is_empty() {
        return format!("{prefix}{raw}");
    }
    let absolute = ["crate", "self", "super"]
        .iter()
        .any(|root| raw == *root || raw.starts_with(&format!("{root}::")));
    if absolute {
        raw.to_string()
    } else {
        format!("{prefix}::{raw}")
    }
}

fn last_segment(path: &str) -> Vec<String> {
    path.rsplit("::")
        .next()
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(|segment| vec![segment.to_string()])
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn rust_specifiers(entries: &[ImportEntry]) -> Vec<String> {
        entries.iter().map(|e| e.specifier.clone()).collect()
    }

    #[test]
    fn extracts_rust_use_paths() {
        let source = "\
use crate::parser::python;
use super::util;
use std::collections::HashMap;
";
        let entries = extract_imports(source, "src/lib.rs");
        assert_eq!(
            rust_specifiers(&entries),
            vec!["crate::parser::python", "super::util", "std::collections::HashMap"]
        );
        assert_eq!(entries[0].names, vec!["python".to_string()]);
        assert_eq!(entries[1].names, vec!["util".to_string()]);
        assert_eq!(entries[2].names, vec!["HashMap".to_string()]);
    }

    #[test]
    fn flattens_braced_rust_use_trees() {
        let source = "use crate::parser::{python, jsts};\nuse serde::{Serialize, Deserialize};\n";
        let entries = extract_imports(source, "src/lib.rs");
        assert_eq!(
            rust_specifiers(&entries),
            vec![
                "crate::parser::python",
                "crate::parser::jsts",
                "serde::Serialize",
                "serde::Deserialize",
            ]
        );
    }

    #[test]
    fn expands_rust_nested_use_trees_and_self() {
        let source = "use crate::a::{self, b::{c, d}};\n";
        let entries = extract_imports(source, "src/lib.rs");
        assert_eq!(
            rust_specifiers(&entries),
            vec!["crate::a", "crate::a::b::c", "crate::a::b::d"]
        );
        assert_eq!(entries[0].names, vec!["a".to_string()]);
    }

    #[test]
    fn records_rust_aliases_and_wildcards() {
        let source = "use std::collections::HashMap as Map;\nuse self::inner::*;\nuse super::*;\n";
        let entries = extract_imports(source, "src/lib.rs");
        assert_eq!(entries[0].specifier, "std::collections::HashMap");
        assert_eq!(entries[0].names, vec!["Map".to_string()]);
        assert_eq!(entries[1].specifier, "self::inner");
        assert_eq!(entries[1].names, vec!["*".to_string()]);
        assert_eq!(entries[2].specifier, "super");
        assert_eq!(entries[2].names, vec!["*".to_string()]);
    }

    #[test]
    fn mod_declarations_import_a_module_file() {
        let source = "mod parser;\nmod inline { fn inner() {} }\n";
        let entries = extract_imports(source, "src/lib.rs");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].specifier, "self::parser");
        assert!(entries[0].names.is_empty());
    }

    #[test]
    fn extension_matching_ignores_case() {
        let rust = extract_imports("use crate::math;\n", "SRC/LIB.RS");
        assert_eq!(rust.len(), 1);
        assert_eq!(rust[0].specifier, "crate::math");

        let python = extract_imports("from utils import add\n", "MAIN.PY");
        assert_eq!(python.len(), 1);
        assert_eq!(python[0].specifier, "utils");
    }
}
