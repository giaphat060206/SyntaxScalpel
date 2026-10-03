use tree_sitter::{Node, Parser};

use crate::models::{NodeKind, ParseResult};
use crate::parser::function_graph::{self, collapse_whitespace, line_range, node_text, Def};

pub fn parse_source(source: &str, file_path: &str) -> Result<ParseResult, String> {
    Ok(function_graph::assemble(definitions(source, file_path)?, file_path))
}

/// Every Definition this source declares, each with the names it calls.
/// Shared with the cross-file neighbourhood builder.
pub(crate) fn definitions(source: &str, file_path: &str) -> Result<Vec<Def>, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_python::LANGUAGE.into())
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let imported = imported_names(source, file_path);
    Ok(collect_defs(tree.root_node(), source, &imported))
}

/// Decorated definitions (`@staticmethod`, `@app.route`) wrap the real
/// definition; unwrap so the definition can be extracted, while the outer node
/// keeps the decorators inside the reported line range.
fn unwrap_decorated(node: Node) -> Node {
    if node.kind() == "decorated_definition" {
        node.child_by_field_name("definition").unwrap_or(node)
    } else {
        node
    }
}

fn collect_defs(root: Node, source: &str, imported: &[String]) -> Vec<Def> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        let member = unwrap_decorated(child);
        match member.kind() {
            "function_definition" => {
                if let Some(def) = function_def(member, source, None, imported, Some(child)) {
                    defs.push(def);
                }
            }
            "class_definition" => {
                let class_name = member
                    .child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("")
                    .to_string();
                let mut class_uses = Vec::new();
                if let Some(body) = member.child_by_field_name("body") {
                    class_uses = uses_in(body, source, imported);
                    let mut inner_cursor = body.walk();
                    for inner in body.children(&mut inner_cursor) {
                        let method = unwrap_decorated(inner);
                        if method.kind() == "function_definition" {
                            if let Some(def) = function_def(
                                method,
                                source,
                                Some(class_name.clone()),
                                imported,
                                Some(inner),
                            ) {
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
                    uses: class_uses,
                    calls: Vec::new(),
                    value: None,
                    parent: None,
                    start_line: line_range(child).0,
                    end_line: line_range(child).1,
                });
            }
            "expression_statement" => {
                if let Some(def) = variable_def(child, source, imported) {
                    defs.push(def);
                }
            }
            _ => {}
        }
    }
    defs
}

fn function_def(
    node: Node,
    source: &str,
    parent: Option<String>,
    imported: &[String],
    range_node: Option<Node>,
) -> Option<Def> {
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
    let uses = uses_in(body, source, imported);
    let calls = calls_in(body, source);
    let span = range_node.unwrap_or(node);

    Some(Def {
        id,
        kind,
        name,
        params,
        returns,
        uses,
        calls,
        value: None,
        parent,
        start_line: line_range(span).0,
        end_line: line_range(span).1,
    })
}

fn variable_def(statement: Node, source: &str, imported: &[String]) -> Option<Def> {
    let mut cursor = statement.walk();
    let assignment = statement
        .named_children(&mut cursor)
        .find(|child| child.kind() == "assignment")?;
    let left = assignment.child_by_field_name("left")?;
    if left.kind() != "identifier" {
        return None;
    }
    let name = left.utf8_text(source.as_bytes()).ok()?.to_string();
    let raw_value = assignment
        .child_by_field_name("right")
        .map(|right| collapse_whitespace(&node_text(right, source)));
    let value = raw_value.clone();
    let uses = raw_value
        .as_deref()
        .map(|text| uses_in_text(text, imported))
        .unwrap_or_default();

    Some(Def {
        id: name.clone(),
        kind: NodeKind::Variable,
        name,
        params: Vec::new(),
        returns: Vec::new(),
        uses,
        calls: Vec::new(),
        value,
        parent: None,
        start_line: line_range(statement).0,
        end_line: line_range(statement).1,
    })
}

fn imported_names(source: &str, file_path: &str) -> Vec<String> {
    crate::parser::imports::extract_imports(source, file_path)
        .into_iter()
        .flat_map(|entry| entry.names)
        .collect()
}

fn uses_in(node: Node, source: &str, imported: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    collect_uses(node, source, imported, &mut out);
    out
}

fn collect_uses(node: Node, source: &str, imported: &[String], out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "identifier" => {
                let text = node_text(child, source);
                if imported.iter().any(|name| name == &text) && !out.contains(&text) {
                    out.push(text);
                }
            }
            "function_definition" | "class_definition" | "lambda" => continue,
            _ => collect_uses(child, source, imported, out),
        }
    }
}

fn uses_in_text(text: &str, imported: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for name in imported {
        if text.contains(name.as_str()) && !out.contains(name) {
            out.push(name.clone());
        }
    }
    out
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

fn calls_in(node: Node, source: &str) -> Vec<String> {
    let mut calls = Vec::new();
    collect_calls(node, source, &mut calls);
    calls
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::GraphEdge;

    const SOURCE: &str = "\
def add(a, b):
    return a + b

def main():
    total = add(1, 2)
    return total
";

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/main.py").unwrap()
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
    fn extracts_module_level_variables() {
        let result = parse("DEFAULT_NODES = 4900\nPATH_SEPARATOR = \" -> \"\n");
        let nodes: Vec<(&str, &Option<String>)> = result
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Variable)
            .map(|n| (n.name.as_str(), &n.value))
            .collect();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].0, "DEFAULT_NODES");
        assert_eq!(nodes[0].1.as_deref(), Some("4900"));
        assert_eq!(nodes[1].1.as_deref(), Some("\" -> \""));
        assert!(result.edges.is_empty());
    }

    #[test]
    fn records_which_imports_a_function_uses() {
        let source = "\
from os import getpid
from utils.constants import DEFAULT_NODES

def build():
    return DEFAULT_NODES + getpid()
";
        let result = parse(source);
        let build = result.nodes.iter().find(|n| n.name == "build").unwrap();
        assert!(build.uses.contains(&"DEFAULT_NODES".to_string()));
        assert!(build.uses.contains(&"getpid".to_string()));
    }

    #[test]
    fn records_the_names_each_definition_calls() {
        let defs = definitions(SOURCE, "src/main.py").unwrap();
        let main = defs.iter().find(|def| def.name == "main").unwrap();
        assert_eq!(main.calls, vec!["add".to_string()]);

        let add = defs.iter().find(|def| def.name == "add").unwrap();
        assert!(add.calls.is_empty());
    }

    #[test]
    fn a_module_level_assignment_exposes_value_but_calls_nothing() {
        let defs = definitions("TOTAL = compute(1)\n", "src/main.py").unwrap();
        assert_eq!(defs[0].value.as_deref(), Some("compute(1)"));
        assert!(defs[0].calls.is_empty());
    }

    #[test]
    fn keeps_long_variable_values_untruncated() {
        let long = "a".repeat(150);
        let source = format!("LONG_VALUE = \"{long}\"\n");
        let result = parse(&source);
        let node = result
            .nodes
            .iter()
            .find(|n| n.name == "LONG_VALUE")
            .unwrap();
        let expected = format!("\"{long}\"");
        assert_eq!(node.value.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn docstrings_are_not_variables() {
        let result = parse("\"\"\"Module docstring.\"\"\"\n\nX = 1\n");
        let variables: Vec<&str> = result
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Variable)
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(variables, vec!["X"]);
    }

    #[test]
    fn extracts_decorated_methods_and_top_level_functions() {
        let source = "\
class C:
    @staticmethod
    def a():
        return 1

@app.route('/')
def handler():
    return 2
";
        let result = parse(source);
        let method = result.nodes.iter().find(|n| n.id == "C.a").unwrap();
        assert_eq!(method.kind, NodeKind::Method);
        // The range includes the decorator line.
        assert_eq!(method.start_line, 2);
        assert_eq!(method.end_line, 4);

        let handler = result.nodes.iter().find(|n| n.name == "handler").unwrap();
        assert_eq!(handler.kind, NodeKind::Function);
        assert_eq!(handler.start_line, 6);
        assert_eq!(handler.end_line, 8);
    }

    #[test]
    fn records_the_line_range_of_each_definition() {
        let source = "\n\ndef add(a, b):\n    return a + b\n";
        let result = parse(source);
        let add = result.nodes.iter().find(|n| n.name == "add").unwrap();
        assert_eq!(add.start_line, 3);
        assert_eq!(add.end_line, 4);
    }

    #[test]
    fn sets_file_path() {
        let result = parse(SOURCE);
        assert_eq!(result.file_path, "src/main.py");
    }

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
}
