use tree_sitter::{Node, Parser};

use crate::models::{NodeKind, ParseResult};
use crate::parser::function_graph::{self, collapse_whitespace, line_range, node_text, Def};

pub fn parse_source(source: &str, file_path: &str) -> Result<ParseResult, String> {
    let defs = definitions(source, file_path)?;
    Ok(function_graph::assemble(&defs, file_path))
}

/// Every Definition this source declares, each with the names it calls.
/// Shared with the cross-file neighbourhood builder.
pub(crate) fn definitions(source: &str, file_path: &str) -> Result<Vec<Def>, String> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_rust::LANGUAGE.into())
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "failed to parse source".to_string())?;

    let imported = imported_names(source, file_path);
    let ctx = Ctx {
        source,
        imported: &imported,
    };
    let mut defs = Vec::new();
    let mut containers = Vec::new();
    collect_items(tree.root_node(), &ctx, None, "", &mut defs, &mut containers);
    Ok(defs)
}

struct Ctx<'s> {
    source: &'s str,
    imported: &'s [String],
}

fn imported_names(source: &str, file_path: &str) -> Vec<String> {
    crate::parser::imports::extract_imports(source, file_path)
        .into_iter()
        .flat_map(|entry| entry.names)
        .collect()
}

/// `impl Foo` methods are `Foo.method`; module items are `module.method`.
fn join_id(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}.{name}")
    }
}

/// Outermost `#[attribute]` directly above a definition, so its reported line
/// range includes the attributes (Rust's equivalent of Python decorators).
fn attribute_span(node: Node) -> Node {
    let mut span = node;
    while let Some(previous) = span.prev_named_sibling() {
        if previous.kind() != "attribute_item" {
            break;
        }
        span = previous;
    }
    span
}

fn definition_lines(node: Node) -> (usize, usize) {
    (line_range(attribute_span(node)).0, line_range(node).1)
}

/// Items of one file, one container level deep.
///
/// Only root-level items open a container (`struct`/`enum`/`union`/`trait`,
/// an `impl` target, or an inline `mod`); definitions inside an inline module
/// stay children of that module, with the impl target folded into their id.
fn collect_items(
    node: Node,
    ctx: &Ctx,
    parent: Option<&str>,
    prefix: &str,
    defs: &mut Vec<Def>,
    containers: &mut Vec<String>,
) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        match child.kind() {
            "function_item" | "function_signature_item" => {
                if let Some(def) = function_def(child, ctx, parent, prefix) {
                    defs.push(def);
                }
            }
            "struct_item" | "enum_item" | "union_item" | "trait_item" => {
                let name = item_name(child, ctx);
                if name.is_empty() {
                    continue;
                }
                let id = join_id(prefix, &name);
                let owner = if prefix.is_empty() {
                    add_container(&id, &name, child, defs, containers);
                    id.clone()
                } else {
                    parent.unwrap_or(&id).to_string()
                };
                if child.kind() == "trait_item" {
                    if let Some(body) = child.child_by_field_name("body") {
                        collect_items(body, ctx, Some(&owner), &id, defs, containers);
                    }
                }
            }
            "impl_item" => {
                let Some(target) = child
                    .child_by_field_name("type")
                    .and_then(|node| base_type_name(node, ctx))
                else {
                    continue;
                };
                let id = join_id(prefix, &target);
                let owner = if prefix.is_empty() {
                    add_container(&id, &target, child, defs, containers);
                    id.clone()
                } else {
                    parent.unwrap_or(&id).to_string()
                };
                if let Some(body) = child.child_by_field_name("body") {
                    collect_items(body, ctx, Some(&owner), &id, defs, containers);
                }
            }
            "mod_item" => {
                let name = item_name(child, ctx);
                if name.is_empty() {
                    continue;
                }
                // `mod foo;` binds a sibling file instead of declaring items;
                // the import resolver owns that edge.
                let Some(body) = child.child_by_field_name("body") else {
                    continue;
                };
                let id = join_id(prefix, &name);
                let owner = if prefix.is_empty() {
                    add_container(&id, &name, child, defs, containers);
                    id.clone()
                } else {
                    parent.unwrap_or(&id).to_string()
                };
                collect_items(body, ctx, Some(&owner), &id, defs, containers);
            }
            "const_item" | "static_item" => {
                if let Some(def) = value_def(child, ctx, prefix) {
                    defs.push(def);
                }
            }
            _ => {}
        }
    }
}

fn item_name(node: Node, ctx: &Ctx) -> String {
    node.child_by_field_name("name")
        .map(|name| node_text(name, ctx.source))
        .unwrap_or_default()
}

/// Base identifier of an impl target: `Foo<T>` and `a::Foo` both yield `Foo`.
fn base_type_name(node: Node, ctx: &Ctx) -> Option<String> {
    match node.kind() {
        "type_identifier" | "identifier" => Some(node_text(node, ctx.source)),
        "generic_type" | "scoped_type_identifier" | "scoped_identifier" | "reference_type" => node
            .child_by_field_name("name")
            .or_else(|| node.child_by_field_name("type"))
            .and_then(|inner| base_type_name(inner, ctx)),
        _ => {
            let text = collapse_whitespace(&node_text(node, ctx.source));
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
    }
}

fn add_container(
    id: &str,
    name: &str,
    node: Node,
    defs: &mut Vec<Def>,
    containers: &mut Vec<String>,
) {
    if containers.iter().any(|existing| existing == id) {
        return;
    }
    containers.push(id.to_string());
    let (start_line, end_line) = definition_lines(node);
    defs.push(Def {
        id: id.to_string(),
        kind: NodeKind::Class,
        name: name.to_string(),
        params: Vec::new(),
        returns: Vec::new(),
        uses: Vec::new(),
        calls: Vec::new(),
        value: None,
        parent: None,
        start_line,
        end_line,
    });
}

fn function_def(node: Node, ctx: &Ctx, parent: Option<&str>, prefix: &str) -> Option<Def> {
    let name = node.child_by_field_name("name").map(|name| node_text(name, ctx.source))?;
    if name.is_empty() {
        return None;
    }
    let body = node.child_by_field_name("body");
    let returns = body.map(|body| return_names(body, ctx)).unwrap_or_default();
    let uses = body.map(|body| uses_in(body, ctx)).unwrap_or_default();
    let calls = body.map(|body| calls_in(body, ctx.source)).unwrap_or_default();
    let (start_line, end_line) = definition_lines(node);

    Some(Def {
        id: join_id(prefix, &name),
        kind: if parent.is_some() {
            NodeKind::Method
        } else {
            NodeKind::Function
        },
        name,
        params: parameter_names(node, ctx),
        returns,
        uses,
        calls,
        value: None,
        parent: parent.map(str::to_string),
        start_line,
        end_line,
    })
}

fn value_def(node: Node, ctx: &Ctx, prefix: &str) -> Option<Def> {
    let name = item_name(node, ctx);
    if name.is_empty() {
        return None;
    }
    let value = node
        .child_by_field_name("value")
        .map(|value| collapse_whitespace(&node_text(value, ctx.source)));
    let uses = value
        .as_deref()
        .map(|text| uses_in_text(text, ctx.imported))
        .unwrap_or_default();
    let (start_line, end_line) = definition_lines(node);

    Some(Def {
        id: join_id(prefix, &name),
        kind: NodeKind::Variable,
        name,
        params: Vec::new(),
        returns: Vec::new(),
        uses,
        calls: Vec::new(),
        value,
        parent: None,
        start_line,
        end_line,
    })
}

fn parameter_names(node: Node, ctx: &Ctx) -> Vec<String> {
    let Some(list) = node.child_by_field_name("parameters") else {
        return Vec::new();
    };
    let mut names = Vec::new();
    let mut cursor = list.walk();
    for param in list.named_children(&mut cursor) {
        let text = collapse_whitespace(&node_text(param, ctx.source));
        if !text.is_empty() {
            names.push(text);
        }
    }
    names
}

fn return_names(body: Node, ctx: &Ctx) -> Vec<String> {
    let mut names = Vec::new();
    collect_returns(body, ctx, &mut names);
    if names.is_empty() {
        if let Some(tail) = tail_expression(body) {
            record_expr(tail, ctx, &mut names);
        }
    }
    names
}

fn collect_returns(node: Node, ctx: &Ctx, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_item" | "function_signature_item" | "closure_expression" => {}
            "return_expression" => {
                if let Some(value) = child.named_child(0) {
                    record_expr(value, ctx, out);
                }
            }
            _ => collect_returns(child, ctx, out),
        }
    }
}

/// Trailing expression of a block is the implicit return value; the last named
/// child counts only when it is an expression rather than a statement or item.
fn tail_expression(block: Node) -> Option<Node> {
    let last = block.named_child(block.named_child_count().checked_sub(1)?)?;
    let kind = last.kind();
    let is_statement = kind.ends_with("_item")
        || kind.ends_with("_declaration")
        || kind.ends_with("_statement")
        || matches!(
            kind,
            "line_comment"
                | "block_comment"
                | "attribute_item"
                | "inner_attribute_item"
                | "macro_definition"
        );
    if is_statement {
        None
    } else {
        Some(last)
    }
}

fn record_expr(node: Node, ctx: &Ctx, out: &mut Vec<String>) {
    match node.kind() {
        "identifier" | "type_identifier" => push_unique(out, node, ctx.source),
        "field_expression" => {
            if let Some(field) = node.child_by_field_name("field") {
                push_unique(out, field, ctx.source);
            }
        }
        "scoped_identifier" => {
            if let Some(name) = node.child_by_field_name("name") {
                push_unique(out, name, ctx.source);
            }
        }
        "function_item"
        | "function_signature_item"
        | "closure_expression"
        | "macro_invocation" => {}
        _ => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                record_expr(child, ctx, out);
            }
        }
    }
}

fn uses_in(node: Node, ctx: &Ctx) -> Vec<String> {
    let mut out = Vec::new();
    collect_uses(node, ctx, &mut out);
    out
}

fn collect_uses(node: Node, ctx: &Ctx, out: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "identifier" | "type_identifier" => {
                let text = node_text(child, ctx.source);
                if ctx.imported.iter().any(|name| name == &text) && !out.contains(&text) {
                    out.push(text);
                }
            }
            "function_item" | "function_signature_item" | "closure_expression" => {}
            _ => collect_uses(child, ctx, out),
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

fn push_unique(out: &mut Vec<String>, node: Node, source: &str) {
    let text = node_text(node, source);
    if !text.is_empty() && !out.iter().any(|existing| existing == &text) {
        out.push(text);
    }
}

fn calls_in(node: Node, source: &str) -> Vec<String> {
    let mut calls = Vec::new();
    collect_calls(node, source, &mut calls);
    calls
}

fn collect_calls(node: Node, source: &str, out: &mut Vec<String>) {
    if node.kind() == "call_expression" {
        if let Some(callee) = node.child_by_field_name("function") {
            push_callee(callee, source, out);
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_item"
            | "function_signature_item"
            | "impl_item"
            | "trait_item"
            | "mod_item"
            | "struct_item"
            | "enum_item"
            | "union_item" => continue,
            _ => collect_calls(child, source, out),
        }
    }
}

fn push_callee(node: Node, source: &str, out: &mut Vec<String>) {
    let name = match node.kind() {
        "identifier" => Some(node_text(node, source)),
        "scoped_identifier" | "field_expression" => node
            .child_by_field_name("name")
            .or_else(|| node.child_by_field_name("field"))
            .map(|inner| node_text(inner, source)),
        "generic_function" => {
            if let Some(inner) = node.child_by_field_name("function") {
                push_callee(inner, source, out);
            }
            None
        }
        _ => None,
    };
    if let Some(name) = name {
        if !name.is_empty() {
            out.push(name);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::GraphEdge;

    const SOURCE: &str = r#"
use crate::math::add;

const SCALE: i32 = 2;

struct Point {
    x: i32,
}

enum Color {
    Red,
}

trait Shape {
    fn area(&self) -> f64;
    fn label(&self) -> String {
        String::from("shape")
    }
}

impl Point {
    fn scaled(&self, factor: i32) -> i32 {
        self.x * factor
    }

    fn doubled(&self) -> i32 {
        double(self.x)
    }
}

impl Shape for Point {
    fn area(&self) -> f64 {
        helper(self.x) as f64
    }
}

fn helper(value: i32) -> i32 {
    let doubled = double(value);
    if doubled > 0 {
        return doubled;
    }
    fallback(value)
}

fn double(value: i32) -> i32 {
    value * SCALE
}

fn fallback(value: i32) -> i32 {
    add(value, SCALE)
}
"#;

    fn parse(source: &str) -> ParseResult {
        parse_source(source, "src/lib.rs").unwrap()
    }

    fn node<'a>(result: &'a ParseResult, id: &str) -> &'a crate::models::GraphNode {
        result
            .nodes
            .iter()
            .find(|node| node.id == id)
            .unwrap_or_else(|| panic!("missing node {id}"))
    }

    fn ids(result: &ParseResult) -> Vec<&str> {
        result.nodes.iter().map(|node| node.id.as_str()).collect()
    }

    #[test]
    fn extracts_top_level_functions() {
        let result = parse(SOURCE);
        let helper = node(&result, "helper");
        assert_eq!(helper.kind, NodeKind::Function);
        assert!(helper.parent.is_none());
        assert!(ids(&result).contains(&"double"));
        assert!(ids(&result).contains(&"fallback"));
    }

    #[test]
    fn types_and_modules_become_containers() {
        let result = parse(SOURCE);
        for id in ["Point", "Color", "Shape"] {
            assert_eq!(node(&result, id).kind, NodeKind::Class);
        }
    }

    #[test]
    fn an_impl_target_is_one_container_however_many_impls_exist() {
        let result = parse(SOURCE);
        let points = result.nodes.iter().filter(|node| node.id == "Point").count();
        assert_eq!(points, 1);
    }

    #[test]
    fn groups_methods_under_their_type_or_trait() {
        let result = parse(SOURCE);
        let scaled = node(&result, "Point.scaled");
        assert_eq!(scaled.kind, NodeKind::Method);
        assert_eq!(scaled.parent.as_deref(), Some("Point"));
        assert_eq!(scaled.name, "scaled");

        // `impl Shape for Point` groups under the type, not the trait.
        let area = node(&result, "Point.area");
        assert_eq!(area.parent.as_deref(), Some("Point"));

        // Trait methods are definitions too, declared or defaulted.
        assert_eq!(node(&result, "Shape.area").kind, NodeKind::Method);
        assert_eq!(node(&result, "Shape.label").parent.as_deref(), Some("Shape"));
    }

    #[test]
    fn renders_parameters_as_written() {
        let result = parse(SOURCE);
        assert_eq!(node(&result, "Point.scaled").params, vec!["&self", "factor: i32"]);
        assert_eq!(node(&result, "double").params, vec!["value: i32"]);
        assert!(node(&result, "Shape.area").params == vec!["&self"]);
    }

    #[test]
    fn extracts_constants_and_statics() {
        let result = parse("const MAX: usize = 10;\nstatic NAME: &str = \"x\";\n");
        let variables: Vec<(&str, Option<&str>)> = result
            .nodes
            .iter()
            .filter(|node| node.kind == NodeKind::Variable)
            .map(|node| (node.name.as_str(), node.value.as_deref()))
            .collect();
        assert_eq!(
            variables,
            vec![("MAX", Some("10")), ("NAME", Some("\"x\""))]
        );
    }

    #[test]
    fn collects_returns_from_return_statements() {
        let result = parse(SOURCE);
        assert_eq!(node(&result, "helper").returns, vec!["doubled"]);
    }

    #[test]
    fn falls_back_to_the_trailing_expression() {
        let result = parse(SOURCE);
        let returns = &node(&result, "double").returns;
        assert!(returns.contains(&"value".to_string()));
        assert!(returns.contains(&"SCALE".to_string()));
    }

    #[test]
    fn returns_are_empty_when_a_body_returns_nothing() {
        let result = parse("fn nothing() {\n    let x = 1;\n}\n");
        assert!(node(&result, "nothing").returns.is_empty());
    }

    #[test]
    fn records_the_names_each_definition_calls() {
        let defs = definitions(SOURCE, "src/lib.rs").unwrap();

        let helper = defs.iter().find(|def| def.id == "helper").unwrap();
        assert!(helper.calls.contains(&"double".to_string()));
        assert!(helper.calls.contains(&"fallback".to_string()));

        // A trait method with no body has nothing to call.
        let declared = defs.iter().find(|def| def.id == "Shape.area").unwrap();
        assert!(declared.calls.is_empty());
    }

    #[test]
    fn records_which_imports_a_body_uses() {
        let result = parse(SOURCE);
        assert_eq!(node(&result, "fallback").uses, vec!["add"]);
        assert!(node(&result, "double").uses.is_empty());
    }

    #[test]
    fn links_function_calls_within_the_file() {
        let result = parse(SOURCE);
        assert!(result.edges.contains(&GraphEdge {
            source: "helper".into(),
            target: "double".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "helper".into(),
            target: "fallback".into(),
        }));
    }

    #[test]
    fn links_calls_from_methods() {
        let result = parse(SOURCE);
        assert!(result.edges.contains(&GraphEdge {
            source: "Point.doubled".into(),
            target: "double".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "Point.area".into(),
            target: "helper".into(),
        }));
    }

    #[test]
    fn links_scoped_and_self_method_calls() {
        let source = r#"
struct Worker;

impl Worker {
    fn run(&self) {
        self.step();
        Self::setup();
    }

    fn step(&self) {}

    fn setup() {}
}
"#;
        let result = parse(source);
        assert!(result.edges.contains(&GraphEdge {
            source: "Worker.run".into(),
            target: "Worker.step".into(),
        }));
        assert!(result.edges.contains(&GraphEdge {
            source: "Worker.run".into(),
            target: "Worker.setup".into(),
        }));
    }

    #[test]
    fn does_not_create_self_edges_or_duplicates() {
        let source = r#"
fn loop_forever() {
    loop_forever();
    loop_forever();
}
"#;
        let result = parse(source);
        assert!(result.edges.is_empty());
    }

    #[test]
    fn imported_calls_and_struct_literals_are_not_edges() {
        let source = r#"
use crate::math::add;

struct Point {
    x: i32,
}

impl Point {
    fn new(x: i32) -> Self {
        Self { x }
    }
}

fn run() -> i32 {
    let point = Point::new(1);
    add(point.x, 1)
}
"#;
        let result = parse(source);
        // `Point { .. }` constructor and the imported `add` produce no edge.
        assert_eq!(
            result.edges,
            vec![GraphEdge {
                source: "run".into(),
                target: "Point.new".into(),
            }]
        );
    }

    #[test]
    fn macro_invocations_are_neither_calls_nor_edge_sources() {
        let source = r#"
fn helper() {}

fn direct() -> i32 {
    helper()
}

fn shout(value: i32) {
    println!("{}", value);
}
"#;
        let result = parse(source);
        assert!(result.edges.contains(&GraphEdge {
            source: "direct".into(),
            target: "helper".into(),
        }));
        assert!(!result.edges.iter().any(|edge| edge.source == "shout"));
        assert!(!result.edges.iter().any(|edge| edge.target == "println"));
    }

    #[test]
    fn calls_inside_macro_arguments_are_not_seen() {
        // Macro arguments stay unexpanded token trees, so `helper()` below is
        // not a call_expression and yields no edge.
        let source = r#"
fn helper() {}

fn shout() {
    println!("{}", helper());
}
"#;
        let result = parse(source);
        assert!(result.edges.is_empty());
    }

    #[test]
    fn inline_modules_group_their_items() {
        let source = r#"
fn outside() {}

mod tests {
    fn inside() {
        checked();
    }

    fn checked() {}
}
"#;
        let result = parse(source);
        assert_eq!(node(&result, "tests").kind, NodeKind::Class);
        assert_eq!(node(&result, "tests.inside").parent.as_deref(), Some("tests"));
        assert_eq!(node(&result, "tests.inside").kind, NodeKind::Method);
        assert!(result.edges.contains(&GraphEdge {
            source: "tests.inside".into(),
            target: "tests.checked".into(),
        }));
    }

    #[test]
    fn every_parent_id_names_a_container_in_the_payload() {
        let result = parse(SOURCE);
        for definition in &result.nodes {
            let Some(parent) = &definition.parent else {
                continue;
            };
            let container = result
                .nodes
                .iter()
                .find(|node| &node.id == parent)
                .unwrap_or_else(|| panic!("orphan {parent}"));
            assert_eq!(container.kind, NodeKind::Class);
            assert!(container.parent.is_none());
        }
    }

    #[test]
    fn mod_declarations_without_a_body_declare_nothing() {
        let result = parse("mod files;\n\nuse files::thing;\n");
        assert!(result.nodes.is_empty());
    }

    #[test]
    fn generic_and_scoped_impl_targets_use_the_base_type() {
        let source = r#"
impl<T> MyVec<T> {
    fn push_item(&mut self, item: T) {}
}

impl crate::store::Store {
    fn flush(&self) {}
}
"#;
        let result = parse(source);
        assert_eq!(node(&result, "MyVec.push_item").parent.as_deref(), Some("MyVec"));
        assert_eq!(node(&result, "Store.flush").parent.as_deref(), Some("Store"));
    }

    #[test]
    fn line_ranges_include_attributes() {
        let source = "#[test]\nfn verified() {\n    assert!(true);\n}\n";
        let result = parse(source);
        let verified = node(&result, "verified");
        assert_eq!(verified.start_line, 1);
        assert_eq!(verified.end_line, 4);
    }

    #[test]
    fn records_the_line_range_of_each_definition() {
        let source = "\n\nfn add(a: i32) -> i32 {\n    a\n}\n";
        let result = parse(source);
        let add = node(&result, "add");
        assert_eq!(add.start_line, 3);
        assert_eq!(add.end_line, 5);
    }

    #[test]
    fn sets_file_path() {
        let result = parse(SOURCE);
        assert_eq!(result.file_path, "src/lib.rs");
    }

    #[test]
    fn parses_an_empty_file_as_an_empty_graph() {
        let result = parse("");
        assert!(result.nodes.is_empty());
        assert!(result.edges.is_empty());
    }

    fn crate_source_files() -> Vec<std::path::PathBuf> {
        let mut files = Vec::new();
        let mut stack = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().map(|ext| ext == "rs").unwrap_or(false) {
                    files.push(path);
                }
            }
        }
        files
    }

    /// The grammar is exercised against this crate's own source, which uses the
    /// real-world constructs (generics, traits, macros, attributes, closures).
    #[test]
    fn parses_this_crates_own_source_without_orphan_definitions() {
        let files = crate_source_files();
        assert!(files.len() > 10, "expected the crate source tree");

        let mut counts = (0, 0, 0, 0);
        for file in &files {
            let source = std::fs::read_to_string(file).unwrap();
            let result = parse_source(&source, &file.to_string_lossy()).unwrap();
            for node in &result.nodes {
                assert!(node.start_line >= 1, "{node:?} in {file:?}");
                assert!(node.end_line >= node.start_line, "{node:?} in {file:?}");
                let Some(parent) = &node.parent else {
                    continue;
                };
                let container = result
                    .nodes
                    .iter()
                    .find(|container| &container.id == parent)
                    .unwrap_or_else(|| panic!("orphan {parent} in {file:?}"));
                assert_eq!(container.kind, NodeKind::Class);
                assert!(container.parent.is_none());
            }
            counts.0 += result.nodes.iter().filter(|n| n.kind == NodeKind::Function).count();
            counts.1 += result.nodes.iter().filter(|n| n.kind == NodeKind::Method).count();
            counts.2 += result.nodes.iter().filter(|n| n.kind == NodeKind::Class).count();
            counts.3 += result.edges.len();
        }

        let (functions, methods, classes, edges) = counts;
        assert!(functions > 0 && methods > 0 && classes > 0 && edges > 0, "{counts:?}");
    }
}
