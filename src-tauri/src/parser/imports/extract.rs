use serde::Serialize;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntry {
    pub specifier: String,
    pub names: Vec<String>,
}

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
}
