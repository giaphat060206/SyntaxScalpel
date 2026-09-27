use std::collections::HashMap;

use tree_sitter::{Node, Parser};

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult, Position};

struct Def<'a> {
    id: String,
    kind: NodeKind,
    name: String,
    params: Vec<String>,
    returns: Vec<String>,
    uses: Vec<String>,
    value: Option<String>,
    parent: Option<String>,
    body: Option<Node<'a>>,
}

fn grammar_for(file_path: &str) -> tree_sitter::Language {
    if file_path.ends_with(".tsx") {
        tree_sitter_typescript::LANGUAGE_TSX.into()
    } else if file_path.ends_with(".ts") {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    } else {
        tree_sitter_javascript::LANGUAGE.into()
    }
}

pub fn parse_source(
    source: &str,
    file_path: &str,
    layout: &HashMap<String, Position>,
) -> Result<ParseResult, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&grammar_for(file_path))
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let imported = imported_names(source, file_path);
    let defs = collect_defs(tree.root_node(), source, &imported);
    let nodes = defs.iter().map(|def| to_node(def, layout)).collect();
    let edges = collect_edges(&defs, source);

    Ok(ParseResult {
        nodes,
        edges,
        file_path: file_path.to_string(),
    })
}

fn collect_edges(defs: &[Def], source: &str) -> Vec<GraphEdge> {
    let mut targets: HashMap<&str, &str> = HashMap::new();
    for def in defs {
        if def.kind != NodeKind::Class && def.kind != NodeKind::Variable {
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
            if !edges
                .iter()
                .any(|e| e.source == edge.source && e.target == edge.target)
            {
                edges.push(edge);
            }
        }
    }
    edges
}

fn collect_calls(node: Node, source: &str, out: &mut Vec<String>) {
    if node.kind() == "call_expression" || node.kind() == "new_expression" {
        if let Some(callee) = node
            .child_by_field_name("function")
            .or_else(|| node.child_by_field_name("constructor"))
        {
            match callee.kind() {
                "identifier" => {
                    let text = node_text(Some(callee), source);
                    if !text.is_empty() {
                        out.push(text);
                    }
                }
                "member_expression" => {
                    if let Some(prop) = callee.child_by_field_name("property") {
                        let text = node_text(Some(prop), source);
                        if !text.is_empty() {
                            out.push(text);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "function_declaration" | "function" | "arrow_function" | "class_declaration"
        ) {
            continue;
        }
        collect_calls(child, source, out);
    }
}

fn collect_defs<'a>(root: Node<'a>, source: &str, imported: &[String]) -> Vec<Def<'a>> {
    let mut defs = Vec::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(def) = declared_function(child, source, None, imported) {
                    defs.push(def);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                collect_declarators(child, source, None, &mut defs, imported);
            }
            "class_declaration" => {
                let class_name = node_text(child.child_by_field_name("name"), source);
                let mut class_uses = Vec::new();
                if let Some(body) = child.child_by_field_name("body") {
                    class_uses = uses_in(body, source, imported);
                    let mut inner = body.walk();
                    for member in body.children(&mut inner) {
                        if member.kind() == "method_definition" {
                            if let Some(def) = declared_function(
                                member,
                                source,
                                Some(class_name.clone()),
                                imported,
                            ) {
                                defs.push(def);
                            }
                        }
                    }
                }
                if !class_name.is_empty() {
                    defs.push(Def {
                        id: class_name.clone(),
                        kind: NodeKind::Class,
                        name: class_name,
                        params: Vec::new(),
                        returns: Vec::new(),
                        uses: class_uses,
                        value: None,
                        parent: None,
                        body: None,
                    });
                }
            }
            _ => {}
        }
    }
    collect_object_methods(root, source, imported, &mut defs);
    defs
}

fn collect_declarators<'a>(
    declaration: Node<'a>,
    source: &str,
    parent: Option<String>,
    defs: &mut Vec<Def<'a>>,
    imported: &[String],
) {
    let mut cursor = declaration.walk();
    for declarator in declaration.children(&mut cursor) {
        if declarator.kind() != "variable_declarator" {
            continue;
        }
        let name = node_text(declarator.child_by_field_name("name"), source);
        let Some(value) = declarator.child_by_field_name("value") else {
            continue;
        };
        if matches!(
            value.kind(),
            "arrow_function" | "function" | "function_expression"
        ) {
            let mut def = declared_function(value, source, parent.clone(), imported);
            if let Some(def) = def.as_mut() {
                if !name.is_empty() {
                    def.name = name.clone();
                    def.id = match &parent {
                        Some(p) => format!("{p}.{name}"),
                        None => name.clone(),
                    };
                    def.kind = if parent.is_some() {
                        NodeKind::Method
                    } else {
                        NodeKind::Function
                    };
                }
            }
            if let Some(def) = def {
                defs.push(def);
            }
        } else if value.kind() != "object" {
            // Plain constant/variable: `const MAX = 10;`
            let name_node = declarator.child_by_field_name("name");
            if name_node.map(|n| n.kind()) == Some("identifier") && !name.is_empty() {
                defs.push(Def {
                    id: name.clone(),
                    kind: NodeKind::Variable,
                    name,
                    params: Vec::new(),
                    returns: Vec::new(),
                    uses: uses_in_text(&node_text(Some(value), source), imported),
                    value: Some(collapse_whitespace(&node_text(Some(value), source))),
                    parent: None,
                    body: None,
                });
            }
        }
    }
}

fn collect_object_methods<'a>(
    root: Node<'a>,
    source: &str,
    imported: &[String],
    defs: &mut Vec<Def<'a>>,
) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "object" {
                collect_methods_in_object(child, source, None, imported, defs);
            }
            stack.push(child);
        }
    }
}

fn collect_methods_in_object<'a>(
    object: Node<'a>,
    source: &str,
    owner_override: Option<String>,
    imported: &[String],
    defs: &mut Vec<Def<'a>>,
) {
    let owner = owner_override.or_else(|| ancestor_variable_name(object, source));
    let mut cursor = object.walk();
    for member in object.children(&mut cursor) {
        if member.kind() == "method_definition" {
            if let Some(mut def) = declared_function(member, source, owner.clone(), imported) {
                def.id = match &owner {
                    Some(o) => format!("{o}.{}", def.name),
                    None => def.name.clone(),
                };
                def.kind = if owner.is_some() {
                    NodeKind::Method
                } else {
                    NodeKind::Function
                };
                if !defs.iter().any(|existing| existing.id == def.id) {
                    defs.push(def);
                }
            }
        }
    }
}

fn ancestor_variable_name(node: Node, source: &str) -> Option<String> {
    let mut current = node.parent();
    while let Some(parent) = current {
        if parent.kind() == "variable_declarator" {
            let name = node_text(parent.child_by_field_name("name"), source);
            if !name.is_empty() {
                return Some(name);
            }
        }
        current = parent.parent();
    }
    None
}

fn declared_function<'a>(
    node: Node<'a>,
    source: &str,
    parent: Option<String>,
    imported: &[String],
) -> Option<Def<'a>> {
    let name = node_text(node.child_by_field_name("name"), source);
    if name.is_empty() && node.kind() != "arrow_function" && node.kind() != "function_expression" {
        return None;
    }
    let id = match &parent {
        Some(p) if !name.is_empty() => format!("{p}.{name}"),
        _ => name.clone(),
    };
    let kind = if parent.is_some() {
        NodeKind::Method
    } else {
        NodeKind::Function
    };
    let params = parameter_names(node, source);
    let body = node.child_by_field_name("body");
    let returns = match body {
        Some(b) if b.kind() == "statement_block" => return_names(b, source),
        Some(b) => vec![node_text(Some(b), source)],
        None => Vec::new(),
    };
    let uses = match body {
        Some(b) if b.kind() == "statement_block" => uses_in(b, source, imported),
        Some(b) => uses_in_text(&node_text(Some(b), source), imported),
        None => Vec::new(),
    };

    Some(Def {
        id,
        kind,
        name,
        params,
        returns,
        uses,
        value: None,
        parent,
        body: node.child_by_field_name("body"),
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
            "identifier" | "type_identifier" | "property_identifier" => {
                let text = node_text(Some(child), source);
                if imported.iter().any(|name| name == &text) && !out.contains(&text) {
                    out.push(text);
                }
            }
            "function_declaration"
            | "function"
            | "arrow_function"
            | "class_declaration"
            | "method_definition" => continue,
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
        let text = node_text(Some(param), source).trim().to_string();
        if !text.is_empty() {
            names.push(text);
        }
    }
    names
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
            "function_declaration" | "function" | "arrow_function" | "class_declaration" => {
                continue
            }
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
            "member_expression" => {
                if let Some(prop) = child.child_by_field_name("property") {
                    push_unique(out, prop, source);
                }
            }
            "function_declaration" | "function" | "arrow_function" | "class_declaration" => {
                continue
            }
            _ => collect_expr_names(child, source, out),
        }
    }
}

fn push_unique(out: &mut Vec<String>, node: Node, source: &str) {
    let text = node_text(Some(node), source);
    if !text.is_empty() && !out.iter().any(|existing| existing == &text) {
        out.push(text);
    }
}

fn node_text(node: Option<Node>, source: &str) -> String {
    node.and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("")
        .to_string()
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn to_node(def: &Def, layout: &HashMap<String, Position>) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        uses: def.uses.clone(),
        value: def.value.clone(),
        parent: def.parent.clone(),
        position: layout.get(&def.id).cloned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "\
function add(a, b) {
  return a + b;
}

const mul = (a, b) => {
  return a * b;
};

class Calc {
  double(n) {
    return add(n, n);
  }
}

const utils = {
  helper(x) {
    return x;
  }
};

function run() {
  const c = new Calc();
  return mul(c.double(2), 3);
}
";

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/app.js", &HashMap::new()).unwrap()
    }

    #[test]
    fn extracts_function_declarations() {
        let result = parse(SOURCE);
        let add = result.nodes.iter().find(|n| n.name == "add").unwrap();
        assert_eq!(add.kind, NodeKind::Function);
        assert_eq!(add.params, vec!["a", "b"]);
    }

    #[test]
    fn extracts_arrow_function_assigned_to_variable() {
        let result = parse(SOURCE);
        let mul = result.nodes.iter().find(|n| n.id == "mul").unwrap();
        assert_eq!(mul.kind, NodeKind::Function);
        assert_eq!(mul.params, vec!["a", "b"]);
        assert_eq!(mul.returns, vec!["a", "b"]);
    }

    #[test]
    fn extracts_classes_and_methods() {
        let result = parse(SOURCE);
        let calc = result.nodes.iter().find(|n| n.id == "Calc").unwrap();
        assert_eq!(calc.kind, NodeKind::Class);
        let double = result.nodes.iter().find(|n| n.id == "Calc.double").unwrap();
        assert_eq!(double.kind, NodeKind::Method);
        assert_eq!(double.parent.as_deref(), Some("Calc"));
    }

    #[test]
    fn extracts_object_literal_methods_with_variable_parent() {
        let result = parse(SOURCE);
        let helper = result.nodes.iter().find(|n| n.id == "utils.helper").unwrap();
        assert_eq!(helper.kind, NodeKind::Method);
        assert_eq!(helper.parent.as_deref(), Some("utils"));
        assert_eq!(helper.params, vec!["x"]);
    }

    #[test]
    fn extracts_top_level_constants() {
        let result = parse("const MAX_NODES = 4900;\nconst NAME = \"grid\";\n");
        let vars: Vec<(&str, Option<&str>)> = result
            .nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Variable)
            .map(|n| (n.name.as_str(), n.value.as_deref()))
            .collect();
        assert_eq!(
            vars,
            vec![
                ("MAX_NODES", Some("4900")),
                ("NAME", Some("\"grid\""))
            ]
        );
        assert!(result.edges.is_empty());
    }

    #[test]
    fn records_which_imports_a_function_uses() {
        let source =
            "import { MAX_NODES } from \"./constants\";\n\nfunction pick() {\n  return MAX_NODES;\n}\n";
        let result = parse(source);
        let pick = result.nodes.iter().find(|n| n.name == "pick").unwrap();
        assert_eq!(pick.uses, vec!["MAX_NODES".to_string()]);
    }

    #[test]
    fn keeps_long_constant_values_untruncated() {
        let long = "b".repeat(150);
        let source = format!("const LONG_VALUE = \"{long}\";\n");
        let result = parse_source(&source, "src/app.js", &HashMap::new()).unwrap();
        let node = result
            .nodes
            .iter()
            .find(|n| n.name == "LONG_VALUE")
            .unwrap();
        let expected = format!("\"{long}\"");
        assert_eq!(node.value.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn handles_typescript_grammar() {
        const TS: &str = "\
interface Point {
  x: number;
}

function magnitude(p: Point): number {
  return p.x;
}
";
        let result = parse_source(TS, "src/math.ts", &HashMap::new()).unwrap();
        let names: Vec<&str> = result.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, vec!["magnitude"]);
    }

    #[test]
    fn parses_tsx_with_jsx() {
        let source =
            "function Greeting({ name }: { name: string }) {\n  return <div>{name}</div>;\n}\n";
        let result = parse_source(source, "src/app.tsx", &HashMap::new()).unwrap();
        assert!(result.nodes.iter().any(|n| n.name == "Greeting"));
    }

    #[test]
    fn destructured_params_render_as_written() {
        let result = parse("function dist({ x, y }) {\n  return x;\n}\n");
        assert_eq!(result.nodes[0].params, vec!["{ x, y }"]);
    }

    #[test]
    fn unowned_object_method_is_a_function() {
        let result = parse("export default {\n  handler() {\n    return 1;\n  }\n};\n");
        let handler = result.nodes.iter().find(|n| n.id == "handler").unwrap();
        assert_eq!(handler.kind, NodeKind::Function);
        assert!(handler.parent.is_none());
    }

    #[test]
    fn links_function_and_method_calls() {
        let result = parse(SOURCE);
        assert!(result.edges.contains(&GraphEdge {
            source: "run".into(),
            target: "mul".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "run".into(),
            target: "Calc.double".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "Calc.double".into(),
            target: "add".into(),
        }));
    }

    #[test]
    fn constructor_is_not_an_edge() {
        let result = parse(SOURCE);
        assert!(!result.edges.iter().any(|e| e.target == "Calc"));
    }

    #[test]
    fn ignores_callbacks_imports_and_builtins() {
        let source = "\
import { readFile } from \"fs\";

function run(items) {
  return items.map((x) => x).concat(console.log(items));
}
";
        let result = parse(source);
        assert!(result.edges.is_empty());
    }
}
