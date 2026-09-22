use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult, Position};

struct Def<'a> {
    id: String,
    kind: NodeKind,
    name: String,
    params: Vec<String>,
    returns: Vec<String>,
    parent: Option<String>,
    body: Option<Node<'a>>,
}

pub fn parse_source(
    source: &str,
    file_path: &str,
    _layout: &HashMap<String, Position>,
) -> Result<ParseResult, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_python::LANGUAGE.into())
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let defs = collect_defs(tree.root_node(), source);
    let nodes = defs.iter().map(to_node).collect();
    let edges = collect_edges(&defs, source);

    Ok(ParseResult {
        nodes,
        edges,
        file_path: file_path.to_string(),
    })
}

fn collect_defs<'a>(root: Node<'a>, source: &str) -> Vec<Def<'a>> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(def) = function_def(child, source, None) {
                    defs.push(def);
                }
            }
            "class_definition" => {
                let class_name = child
                    .child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .unwrap_or("")
                    .to_string();
                if let Some(body) = child.child_by_field_name("body") {
                    let mut inner_cursor = body.walk();
                    for inner in body.children(&mut inner_cursor) {
                        if inner.kind() == "function_definition" {
                            if let Some(def) =
                                function_def(inner, source, Some(class_name.clone()))
                            {
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
                    parent: None,
                    body: None,
                });
            }
            _ => {}
        }
    }
    defs
}

fn function_def<'a>(node: Node<'a>, source: &str, parent: Option<String>) -> Option<Def<'a>> {
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

    Some(Def {
        id,
        kind,
        name,
        params,
        returns,
        parent,
        body: Some(body),
    })
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

fn collect_edges(defs: &[Def], source: &str) -> Vec<GraphEdge> {
    let mut targets: HashMap<&str, &str> = HashMap::new();
    for def in defs {
        if def.kind != NodeKind::Class {
            targets.insert(def.id.as_str(), def.id.as_str());
            targets.insert(def.name.as_str(), def.id.as_str());
        }
    }

    let mut edges: Vec<GraphEdge> = Vec::new();
    for def in defs {
        let Some(body) = def.body else { continue };
        let mut calls = Vec::new();
        collect_calls(body, source, &mut calls);
        for name in calls {
            let Some(target) = targets.get(name.as_str()) else {
                continue;
            };
            if *target == def.id.as_str() {
                continue;
            }
            let edge = GraphEdge {
                source: def.id.clone(),
                target: target.to_string(),
            };
            if !edges.iter().any(|e| e.source == edge.source && e.target == edge.target) {
                edges.push(edge);
            }
        }
    }
    edges
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

fn to_node(def: &Def) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        parent: def.parent.clone(),
        position: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "\
def add(a, b):
    return a + b

def main():
    total = add(1, 2)
    return total
";

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/main.py", &HashMap::new()).unwrap()
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
