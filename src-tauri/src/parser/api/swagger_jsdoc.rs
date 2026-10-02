use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{Map, Number, Value};
use tree_sitter::{Node, Parser};

use super::openapi::extract_endpoints;
use super::{
    node_text, relative_id, ApiInventory, ApiSource, FIDELITY_FULL, METHODS, SOURCE_SWAGGER_JSDOC,
};
use crate::parser::imports::{AliasMap, ImportEntry, Resolver};

const MAX_EVAL_DEPTH: usize = 24;

struct JsContext {
    root: PathBuf,
    resolver: Resolver,
}

#[derive(Clone, Debug)]
enum ExportKind {
    Default,
    Named(String),
    Namespace,
}

struct EvalEnv<'a> {
    source: &'a str,
    module_rel: &'a str,
    module_root: Node<'a>,
    js: &'a JsContext,
}

struct CommentBlock {
    yaml: String,
    line: usize,
}

struct RouterCall {
    method: String,
    handler: Option<String>,
    line: usize,
    used: bool,
}

pub fn collect(root: &Path, collected: &[(PathBuf, String)], inventory: &mut ApiInventory) {
    let files: Vec<PathBuf> = collected.iter().map(|(path, _)| path.clone()).collect();
    let ctx = JsContext {
        root: root.to_path_buf(),
        resolver: Resolver::new(root, &files, AliasMap::load(root)),
    };
    let components = assemble_components(&ctx, collected);
    for (path, _) in collected {
        if !is_js_ts(path) {
            continue;
        }
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let Some(tree) = parse_js(&source, path) else {
            continue;
        };
        let blocks = extract_blocks(tree.root_node(), &source);
        if blocks.is_empty() {
            continue;
        }
        let file = relative_id(root, path);
        let mut calls = extract_router_calls(tree.root_node(), &source);
        let mut endpoints = Vec::new();
        for block in &blocks {
            match block_document(&block.yaml, &components) {
                Some(document) => {
                    for mut endpoint in extract_endpoints(&document, &file) {
                        endpoint.source_kind = SOURCE_SWAGGER_JSDOC.to_string();
                        endpoint.fidelity = FIDELITY_FULL.to_string();
                        endpoint.line = block.line;
                        endpoint.handler = take_handler(&mut calls, &endpoint.method, block.line);
                        endpoint.handler_file = endpoint.handler.as_deref().and_then(|handler| {
                            resolve_handler_file(
                                &ctx,
                                tree.root_node(),
                                &source,
                                &file,
                                handler,
                            )
                        });
                        endpoints.push(endpoint);
                    }
                }
                None => inventory.warnings.push(format!(
                    "{file}: could not parse @openapi block at line {}",
                    block.line
                )),
            }
        }
        if !endpoints.is_empty() {
            inventory.sources.push(ApiSource {
                kind: SOURCE_SWAGGER_JSDOC.to_string(),
                file,
            });
            inventory.endpoints.extend(endpoints);
        }
    }
}

fn is_js_ts(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .map(|ext| matches!(ext.as_str(), "js" | "jsx" | "ts" | "tsx"))
        .unwrap_or(false)
}

fn parse_js(source: &str, path: &Path) -> Option<tree_sitter::Tree> {
    let mut parser = Parser::new();
    let file = path.to_string_lossy();
    parser
        .set_language(&crate::parser::jsts::grammar_for(&file))
        .ok()?;
    parser.parse(source, None)
}

fn extract_blocks(root: Node, source: &str) -> Vec<CommentBlock> {
    let mut blocks = Vec::new();
    collect_comments(root, source, &mut blocks);
    blocks.sort_by_key(|block| block.line);
    blocks
}

fn collect_comments(node: Node, source: &str, out: &mut Vec<CommentBlock>) {
    if node.kind() == "comment" {
        if let Some(block) = comment_block(node, source) {
            out.push(block);
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_comments(child, source, out);
    }
}

fn comment_block(node: Node, source: &str) -> Option<CommentBlock> {
    let text = node_text(node, source);
    let marker = text.find("@openapi")?;
    let start_row = node.start_position().row;
    let line = start_row + text[..marker].matches('\n').count() + 1;
    let yaml = strip_comment_yaml(&text[marker + "@openapi".len()..]);
    if yaml.trim().is_empty() {
        return None;
    }
    Some(CommentBlock { yaml, line })
}

fn strip_comment_yaml(body: &str) -> String {
    let mut lines = Vec::new();
    for raw in body.lines() {
        let trimmed = match raw.rfind("*/") {
            Some(index) => &raw[..index],
            None => raw,
        };
        let mut line = trimmed.trim();
        if let Some(rest) = line.strip_prefix('*') {
            line = rest.strip_prefix(' ').unwrap_or(rest);
        }
        lines.push(line.to_string());
    }
    lines.join("\n")
}

fn extract_router_calls(root: Node, source: &str) -> Vec<RouterCall> {
    let mut calls = Vec::new();
    collect_router_calls(root, source, &mut calls);
    calls.sort_by_key(|call| call.line);
    calls
}

fn collect_router_calls(node: Node, source: &str, out: &mut Vec<RouterCall>) {
    if node.kind() == "call_expression" {
        if let Some(call) = router_call(node, source) {
            out.push(call);
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_router_calls(child, source, out);
    }
}

fn router_call(node: Node, source: &str) -> Option<RouterCall> {
    let function = node.child_by_field_name("function")?;
    if function.kind() != "member_expression" {
        return None;
    }
    let object = function.child_by_field_name("object")?;
    if object.kind() != "identifier" {
        return None;
    }
    let object_text = node_text(object, source);
    if object_text != "router" && object_text != "app" {
        return None;
    }
    let property = function.child_by_field_name("property")?;
    let method = node_text(property, source).to_lowercase();
    if !METHODS.contains(&method.as_str()) {
        return None;
    }
    let arguments = node.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    let handler = arguments
        .named_children(&mut cursor)
        .last()
        .and_then(|last| handler_from_expr(last, source));
    Some(RouterCall {
        method,
        handler,
        line: node.start_position().row + 1,
        used: false,
    })
}

fn handler_from_expr(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "identifier" | "member_expression" => {
            let text = node_text(node, source);
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        "call_expression" => {
            let arguments = node.child_by_field_name("arguments")?;
            let mut cursor = arguments.walk();
            let last = arguments.named_children(&mut cursor).last();
            last.and_then(|last| handler_from_expr(last, source))
        }
        _ => None,
    }
}

fn take_handler(calls: &mut [RouterCall], method: &str, after_line: usize) -> Option<String> {
    let wanted = method.to_lowercase();
    for call in calls.iter_mut() {
        if !call.used && call.method == wanted && call.line > after_line {
            call.used = true;
            return call.handler.clone();
        }
    }
    None
}

fn resolve_handler_file(
    ctx: &JsContext,
    root: Node,
    source: &str,
    module_rel: &str,
    handler: &str,
) -> Option<String> {
    let receiver = handler.split('.').next()?;
    let specifier = receiver_specifier(root, source, receiver)?;
    let target = resolve_module(ctx, &specifier, module_rel)?;
    Some(relative_id(&ctx.root, &target))
}

fn receiver_specifier(root: Node, source: &str, name: &str) -> Option<String> {
    if let Some(value) = find_declarator_value(root, source, name) {
        if let Some(specifier) = require_specifier(value, source) {
            return Some(specifier);
        }
    }
    find_import(root, source, name).map(|(specifier, _)| specifier)
}

fn require_specifier(node: Node, source: &str) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let function = node.child_by_field_name("function")?;
    if function.kind() != "identifier" || node_text(function, source) != "require" {
        return None;
    }
    let argument = first_argument(node)?;
    Some(parse_string(argument, source))
}

fn block_document(yaml: &str, components: &Value) -> Option<Value> {
    let parsed: Value = serde_norway::from_str(yaml).ok()?;
    let mut paths = match parsed {
        Value::Object(map) => map,
        _ => return None,
    };
    if !paths.keys().any(|key| key.starts_with('/')) {
        return None;
    }
    let merged = match paths.remove("components") {
        Some(block_components) => merge_components(components, &block_components),
        None => components.clone(),
    };
    let mut document = Map::new();
    document.insert("paths".to_string(), Value::Object(paths));
    document.insert("components".to_string(), merged);
    Some(Value::Object(document))
}

fn merge_components(base: &Value, overlay: &Value) -> Value {
    let mut merged = match base {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };
    if let Value::Object(overlay) = overlay {
        for (key, value) in overlay {
            let combined = match merged.get(key) {
                Some(existing) => merge_components(existing, value),
                None => value.clone(),
            };
            merged.insert(key.clone(), combined);
        }
    }
    Value::Object(merged)
}

fn assemble_components(ctx: &JsContext, collected: &[(PathBuf, String)]) -> Value {
    for (path, _) in collected {
        if !is_js_ts(path) {
            continue;
        }
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let Some(tree) = parse_js(&source, path) else {
            continue;
        };
        let relative = relative_id(&ctx.root, path);
        if let Some(components) =
            find_components(tree.root_node(), &source, &relative, ctx)
        {
            return components;
        }
    }
    Value::Object(Map::new())
}

fn find_components(root: Node, source: &str, module_rel: &str, ctx: &JsContext) -> Option<Value> {
    let mut active = HashSet::new();
    if let Some(config) = find_swagger_config(root, source, module_rel, ctx, &mut active) {
        if let Some(components) = config.pointer("/definition/components") {
            return Some(components.clone());
        }
    }
    find_definition_components(root, source, module_rel, ctx)
}

fn find_swagger_config(
    root: Node,
    source: &str,
    module_rel: &str,
    ctx: &JsContext,
    active: &mut HashSet<String>,
) -> Option<Value> {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "call_expression" {
            if let Some(function) = node.child_by_field_name("function") {
                if function.kind() == "identifier" && node_text(function, source) == "swaggerJsdoc" {
                    if let Some(argument) = first_argument(node) {
                        let env = EvalEnv {
                            source,
                            module_rel,
                            module_root: root,
                            js: ctx,
                        };
                        if let Some(value) = eval_expr(argument, &env, 0, active) {
                            return Some(value);
                        }
                    }
                }
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }
    None
}

fn find_definition_components(
    root: Node,
    source: &str,
    module_rel: &str,
    ctx: &JsContext,
) -> Option<Value> {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "object" {
            if let Some(definition) = object_property(node, source, "definition") {
                let mut active = HashSet::new();
                let env = EvalEnv {
                    source,
                    module_rel,
                    module_root: root,
                    js: ctx,
                };
                if let Some(Value::Object(map)) = eval_expr(definition, &env, 0, &mut active) {
                    if let Some(components) = map.get("components") {
                        return Some(components.clone());
                    }
                }
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }
    None
}

fn first_argument(call: Node) -> Option<Node> {
    let arguments = call.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    let first = arguments.named_children(&mut cursor).next();
    first
}

fn object_property<'a>(object: Node<'a>, source: &str, name: &str) -> Option<Node<'a>> {
    let mut cursor = object.walk();
    for child in object.named_children(&mut cursor) {
        if child.kind() == "pair" {
            let key = child.child_by_field_name("key")?;
            if object_key(key, source).as_deref() == Some(name) {
                return child.child_by_field_name("value");
            }
        }
    }
    None
}

fn eval_expr(
    node: Node,
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if depth > MAX_EVAL_DEPTH {
        return None;
    }
    match node.kind() {
        "object" => eval_object(node, env, depth, active),
        "array" => {
            let mut values = Vec::new();
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                values.push(eval_expr(child, env, depth + 1, active).unwrap_or(Value::Null));
            }
            Some(Value::Array(values))
        }
        "string" | "template_string" => Some(Value::String(parse_string(node, env.source))),
        "number" => parse_number(&node_text(node, env.source)),
        "true" => Some(Value::Bool(true)),
        "false" => Some(Value::Bool(false)),
        "null" | "undefined" => Some(Value::Null),
        "identifier" | "property_identifier" | "shorthand_property_identifier"
        | "shorthand_property_identifier_pattern" => {
            eval_identifier(&node_text(node, env.source), env, depth, active)
        }
        "member_expression" => eval_member(node, env, depth, active),
        "call_expression" => {
            let function = node.child_by_field_name("function")?;
            if function.kind() == "identifier" && node_text(function, env.source) == "require" {
                let argument = first_argument(node)?;
                let specifier = parse_string(argument, env.source);
                let target = resolve_module(env.js, &specifier, env.module_rel)?;
                return eval_module_export(env.js, &target, ExportKind::Default, depth + 1, active);
            }
            None
        }
        "parenthesized_expression" => {
            let mut cursor = node.walk();
            let inner = node.named_children(&mut cursor).next()?;
            eval_expr(inner, env, depth, active)
        }
        _ => None,
    }
}

fn eval_object(
    node: Node,
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    let mut map = Map::new();
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        match child.kind() {
            "pair" => {
                let Some(key) = child.child_by_field_name("key") else {
                    continue;
                };
                let Some(value) = child.child_by_field_name("value") else {
                    continue;
                };
                let Some(name) = object_key(key, env.source) else {
                    continue;
                };
                if let Some(evaluated) = eval_expr(value, env, depth + 1, active) {
                    map.insert(name, evaluated);
                }
            }
            "shorthand_property_identifier" | "shorthand_property_identifier_pattern" => {
                let name = node_text(child, env.source);
                if let Some(evaluated) = eval_identifier(&name, env, depth + 1, active) {
                    map.insert(name, evaluated);
                }
            }
            "spread_element" => {
                let mut inner = child.walk();
                let Some(expression) = child.named_children(&mut inner).next() else {
                    continue;
                };
                if let Some(Value::Object(extra)) = eval_expr(expression, env, depth + 1, active) {
                    for (key, value) in extra {
                        map.insert(key, value);
                    }
                }
            }
            _ => {}
        }
    }
    Some(Value::Object(map))
}

fn eval_member(
    node: Node,
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    let object = node.child_by_field_name("object")?;
    let property = node.child_by_field_name("property")?;
    let name = object_key(property, env.source)?;
    if object.kind() == "identifier" {
        let object_name = node_text(object, env.source);
        if (object_name == "module" && name == "exports") || object_name == "exports" {
            return eval_default_export(env, depth + 1, active);
        }
    }
    let base = eval_expr(object, env, depth + 1, active)?;
    match base {
        Value::Object(map) => map.get(&name).cloned(),
        _ => None,
    }
}

fn eval_identifier(
    name: &str,
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if let Some(value) = find_declarator_value(env.module_root, env.source, name) {
        return eval_expr(value, env, depth, active);
    }
    if let Some((initializer, key)) = find_destructured(env.module_root, env.source, name) {
        let base = eval_expr(initializer, env, depth, active)?;
        if let Value::Object(map) = base {
            return map.get(&key).cloned();
        }
    }
    let import = find_import(env.module_root, env.source, name)?;
    let target = resolve_module(env.js, &import.0, env.module_rel)?;
    eval_module_export(env.js, &target, import.1, depth + 1, active)
}

fn find_declarator_value<'a>(root: Node<'a>, source: &str, name: &str) -> Option<Node<'a>> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        let declaration = if matches!(
            child.kind(),
            "lexical_declaration" | "variable_declaration"
        ) {
            Some(child)
        } else if child.kind() == "export_statement" {
            child
                .child_by_field_name("declaration")
                .filter(|declaration| {
                    matches!(
                        declaration.kind(),
                        "lexical_declaration" | "variable_declaration"
                    )
                })
        } else {
            None
        };
        let Some(declaration) = declaration else {
            continue;
        };
        let mut inner = declaration.walk();
        for declarator in declaration.named_children(&mut inner) {
            if declarator.kind() != "variable_declarator" {
                continue;
            }
            let Some(name_node) = declarator.child_by_field_name("name") else {
                continue;
            };
            if name_node.kind() == "identifier" && node_text(name_node, source) == name {
                return declarator.child_by_field_name("value");
            }
        }
    }
    None
}

fn find_destructured<'a>(
    root: Node<'a>,
    source: &str,
    name: &str,
) -> Option<(Node<'a>, String)> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if !matches!(
            child.kind(),
            "lexical_declaration" | "variable_declaration"
        ) {
            continue;
        }
        let mut inner = child.walk();
        for declarator in child.named_children(&mut inner) {
            if declarator.kind() != "variable_declarator" {
                continue;
            }
            let Some(pattern) = declarator.child_by_field_name("name") else {
                continue;
            };
            if pattern.kind() != "object_pattern" {
                continue;
            }
            let Some(value) = declarator.child_by_field_name("value") else {
                continue;
            };
            let mut entries = pattern.walk();
            for entry in pattern.named_children(&mut entries) {
                let key = match entry.kind() {
                    "shorthand_property_identifier_pattern"
                    | "shorthand_property_identifier" => node_text(entry, source),
                    "pair_pattern" => entry
                        .child_by_field_name("key")
                        .and_then(|key| object_key(key, source))
                        .unwrap_or_default(),
                    _ => continue,
                };
                if key == name {
                    return Some((value, key));
                }
            }
        }
    }
    None
}

fn find_import(root: Node, source: &str, name: &str) -> Option<(String, ExportKind)> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() != "import_statement" {
            continue;
        }
        let specifier = child
            .child_by_field_name("source")
            .map(|node| parse_string(node, source))?;
        let mut inner = child.walk();
        for clause in child.named_children(&mut inner) {
            if clause.kind() == "string" {
                continue;
            }
            if let Some(kind) = import_binding(clause, source, name) {
                return Some((specifier, kind));
            }
        }
    }
    None
}

fn import_binding(clause: Node, source: &str, name: &str) -> Option<ExportKind> {
    match clause.kind() {
        "identifier" => {
            if node_text(clause, source) == name {
                Some(ExportKind::Default)
            } else {
                None
            }
        }
        "namespace_import" => {
            let mut cursor = clause.walk();
            let identifier = clause.named_children(&mut cursor).next()?;
            (node_text(identifier, source) == name).then_some(ExportKind::Namespace)
        }
        "named_imports" => {
            let mut cursor = clause.walk();
            for specifier in clause.named_children(&mut cursor) {
                if specifier.kind() != "import_specifier" {
                    continue;
                }
                let imported = specifier
                    .child_by_field_name("name")
                    .map(|node| node_text(node, source))
                    .unwrap_or_default();
                let local = specifier
                    .child_by_field_name("alias")
                    .map(|node| node_text(node, source))
                    .unwrap_or_else(|| imported.clone());
                if local == name {
                    return Some(ExportKind::Named(imported));
                }
            }
            None
        }
        "import_clause" => {
            let mut cursor = clause.walk();
            for inner in clause.named_children(&mut cursor) {
                if let Some(kind) = import_binding(inner, source, name) {
                    return Some(kind);
                }
            }
            None
        }
        _ => None,
    }
}

fn eval_default_export(
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if let Some(value) = find_export_default(env.module_root, env.source) {
        return eval_expr(value, env, depth, active);
    }
    let value = find_module_exports(env.module_root, env.source)?;
    eval_expr(value, env, depth, active)
}

fn eval_namespace_export(
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if let Some(value) = eval_default_export(env, depth, active) {
        if value.is_object() {
            return Some(value);
        }
    }
    let mut map = Map::new();
    collect_named_exports(env, depth + 1, active, &mut map);
    if map.is_empty() {
        None
    } else {
        Some(Value::Object(map))
    }
}

fn collect_named_exports(
    env: &EvalEnv,
    depth: usize,
    active: &mut HashSet<String>,
    map: &mut Map<String, Value>,
) {
    let mut cursor = env.module_root.walk();
    for child in env.module_root.children(&mut cursor) {
        if child.kind() != "export_statement" {
            continue;
        }
        if let Some(declaration) = child.child_by_field_name("declaration") {
            match declaration.kind() {
                "function_declaration" | "class_declaration"
                | "generator_function_declaration" => {
                    if let Some(name) = declaration.child_by_field_name("name") {
                        let name = node_text(name, env.source);
                        if let Some(value) = eval_named_export(env, &name, depth, active) {
                            map.insert(name, value);
                        }
                    }
                }
                "lexical_declaration" | "variable_declaration" => {
                    let mut inner = declaration.walk();
                    for declarator in declaration.named_children(&mut inner) {
                        if declarator.kind() != "variable_declarator" {
                            continue;
                        }
                        let Some(name) = declarator.child_by_field_name("name") else {
                            continue;
                        };
                        if name.kind() != "identifier" {
                            continue;
                        }
                        let name = node_text(name, env.source);
                        if let Some(value) = eval_named_export(env, &name, depth, active) {
                            map.insert(name, value);
                        }
                    }
                }
                _ => {}
            }
        }
        let mut inner = child.walk();
        for clause in child.named_children(&mut inner) {
            if clause.kind() != "export_clause" {
                continue;
            }
            let mut spec = clause.walk();
            for entry in clause.named_children(&mut spec) {
                if entry.kind() != "export_specifier" {
                    continue;
                }
                let exported = entry
                    .child_by_field_name("alias")
                    .or_else(|| entry.child_by_field_name("name"));
                let Some(exported) = exported else {
                    continue;
                };
                let name = node_text(exported, env.source);
                if let Some(value) = eval_named_export(env, &name, depth, active) {
                    map.insert(name, value);
                }
            }
        }
    }
}

fn find_export_default<'a>(root: Node<'a>, source: &str) -> Option<Node<'a>> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() != "export_statement" {
            continue;
        }
        if !node_text(child, source).trim_start().starts_with("export default") {
            continue;
        }
        if let Some(value) = child.child_by_field_name("value") {
            return Some(value);
        }
        let mut inner = child.walk();
        if let Some(value) = child
            .named_children(&mut inner)
            .filter(|node| node.kind() != "default")
            .last()
        {
            return Some(value);
        }
    }
    None
}

fn find_module_exports<'a>(root: Node<'a>, source: &str) -> Option<Node<'a>> {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "assignment_expression" {
            if let Some(left) = node.child_by_field_name("left") {
                let text = node_text(left, source);
                if text == "module.exports" || text == "exports" {
                    return node.child_by_field_name("right");
                }
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }
    None
}

fn eval_named_export(
    env: &EvalEnv,
    name: &str,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if let Some(value) = find_declarator_value(env.module_root, env.source, name) {
        return eval_expr(value, env, depth, active);
    }
    if let Some((specifier, original)) = find_reexport(env.module_root, env.source, name) {
        let target = resolve_module(env.js, &specifier, env.module_rel)?;
        return eval_module_export(
            env.js,
            &target,
            ExportKind::Named(original),
            depth + 1,
            active,
        );
    }
    if let Some(Value::Object(map)) = eval_default_export(env, depth, active) {
        return map.get(name).cloned();
    }
    None
}

fn find_reexport(root: Node, source: &str, name: &str) -> Option<(String, String)> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() != "export_statement" {
            continue;
        }
        let Some(specifier) = child
            .child_by_field_name("source")
            .map(|node| parse_string(node, source))
        else {
            continue;
        };
        let mut inner = child.walk();
        for clause in child.named_children(&mut inner) {
            let mut spec = clause.walk();
            for entry in clause.named_children(&mut spec) {
                if entry.kind() != "export_specifier" {
                    continue;
                }
                let original = entry
                    .child_by_field_name("name")
                    .map(|node| node_text(node, source))
                    .unwrap_or_default();
                let local = entry
                    .child_by_field_name("alias")
                    .map(|node| node_text(node, source))
                    .unwrap_or_else(|| original.clone());
                if local == name {
                    return Some((specifier.clone(), original));
                }
            }
        }
    }
    None
}

fn eval_module_export(
    ctx: &JsContext,
    path: &Path,
    export: ExportKind,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    if depth > MAX_EVAL_DEPTH {
        return None;
    }
    let key = format!("{}::{export:?}", path.display());
    if !active.insert(key.clone()) {
        return None;
    }
    let result = eval_module_export_inner(ctx, path, &export, depth, active);
    active.remove(&key);
    result
}

fn eval_module_export_inner(
    ctx: &JsContext,
    path: &Path,
    export: &ExportKind,
    depth: usize,
    active: &mut HashSet<String>,
) -> Option<Value> {
    let source = std::fs::read_to_string(path).ok()?;
    let tree = parse_js(&source, path)?;
    let root = tree.root_node();
    let relative = relative_id(&ctx.root, path);
    let env = EvalEnv {
        source: &source,
        module_rel: &relative,
        module_root: root,
        js: ctx,
    };
    match export {
        ExportKind::Default => eval_default_export(&env, depth, active),
        ExportKind::Namespace => eval_namespace_export(&env, depth, active),
        ExportKind::Named(name) => eval_named_export(&env, name, depth, active),
    }
}

fn resolve_module(ctx: &JsContext, specifier: &str, importer_rel: &str) -> Option<PathBuf> {
    let entry = ImportEntry {
        specifier: specifier.to_string(),
        names: Vec::new(),
    };
    ctx.resolver
        .resolve(&entry, importer_rel)
        .into_iter()
        .next()
        .map(|resolved| resolved.target)
}

fn object_key(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "property_identifier" | "identifier" | "shorthand_property_identifier" => {
            Some(node_text(node, source))
        }
        "string" => Some(parse_string(node, source)),
        "number" => Some(node_text(node, source)),
        "computed_property_name" => {
            let mut cursor = node.walk();
            let inner = node.named_children(&mut cursor).next()?;
            match inner.kind() {
                "string" => Some(parse_string(inner, source)),
                _ => None,
            }
        }
        _ => None,
    }
}

fn parse_string(node: Node, source: &str) -> String {
    let text = node_text(node, source);
    let trimmed = text.trim();
    let inner = trimmed
        .strip_prefix('`')
        .and_then(|rest| rest.strip_suffix('`'))
        .or_else(|| trimmed.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')))
        .or_else(|| trimmed.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')))
        .unwrap_or(trimmed);
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('0') => out.push('\0'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn parse_number(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Ok(integer) = trimmed.parse::<i64>() {
        return Some(Value::Number(Number::from(integer)));
    }
    trimmed
        .parse::<f64>()
        .ok()
        .and_then(Number::from_f64)
        .map(Value::Number)
}
