use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use tree_sitter::{Node, Tree};

use super::{
    ApiEndpoint, ApiInventory, ApiParameter, ApiResponse, ApiSource, FIDELITY_HEURISTIC, SOURCE_NEXT,
};

const METHODS: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

pub fn collect(root: &Path, collected: &[(PathBuf, String)], inventory: &mut ApiInventory) {
    for (path, _folder) in collected {
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_route_file(file_name) {
            continue;
        }
        let file = relative_id(root, path);
        let Some(api_path) = derive_path(&file) else {
            continue;
        };
        let Ok(source) = std::fs::read_to_string(path) else {
            continue;
        };
        let endpoints = extract_endpoints(&source, &file, &api_path);
        if endpoints.is_empty() {
            continue;
        }
        inventory.sources.push(ApiSource {
            kind: SOURCE_NEXT.to_string(),
            file,
        });
        inventory.endpoints.extend(endpoints);
    }
}

fn relative_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn is_route_file(file_name: &str) -> bool {
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    stem == "route" && matches!(extension.to_lowercase().as_str(), "ts" | "js" | "tsx" | "jsx")
}

fn derive_path(file: &str) -> Option<String> {
    let segments: Vec<&str> = file.split('/').collect();
    let api_index = segments.iter().position(|segment| *segment == "api")?;
    let mut rendered: Vec<String> = Vec::new();
    for segment in &segments[api_index..segments.len().saturating_sub(1)] {
        if let Some(part) = render_segment(segment) {
            rendered.push(part);
        }
    }
    Some(format!("/{}", rendered.join("/")))
}

fn render_segment(segment: &str) -> Option<String> {
    if segment.is_empty() {
        return None;
    }
    if segment.starts_with('@') {
        return None;
    }
    if segment.starts_with('(') && segment.ends_with(')') {
        return None;
    }
    if segment.starts_with('[') && segment.ends_with(']') {
        let mut inner = &segment[1..segment.len() - 1];
        if inner.starts_with('[') && inner.ends_with(']') && inner.len() >= 2 {
            inner = &inner[1..inner.len() - 1];
        }
        return Some(format!("{{{inner}}}"));
    }
    Some(segment.to_string())
}

fn extract_endpoints(source: &str, file: &str, api_path: &str) -> Vec<ApiEndpoint> {
    let Some(tree) = parse(source, file) else {
        return Vec::new();
    };
    let mut endpoints = Vec::new();
    let mut cursor = tree.root_node().walk();
    for child in tree.root_node().children(&mut cursor) {
        if child.kind() != "export_statement" {
            continue;
        }
        for (method, handler) in exported_handlers(child, source) {
            endpoints.push(build_endpoint(&method, handler, source, file, api_path));
        }
    }
    endpoints
}

fn exported_handlers<'a>(export: Node<'a>, source: &str) -> Vec<(String, Node<'a>)> {
    let mut handlers = Vec::new();
    let Some(declaration) = export.child_by_field_name("declaration") else {
        return handlers;
    };
    match declaration.kind() {
        "function_declaration" | "generator_function_declaration" => {
            if let Some(name) = declaration.child_by_field_name("name") {
                let name = node_text(name, source);
                if is_method(&name) {
                    handlers.push((name, declaration));
                }
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            let mut cursor = declaration.walk();
            for child in declaration.named_children(&mut cursor) {
                if child.kind() != "variable_declarator" {
                    continue;
                }
                let Some(name) = child.child_by_field_name("name") else {
                    continue;
                };
                let name = node_text(name, source);
                if !is_method(&name) {
                    continue;
                }
                let handler = child.child_by_field_name("value").unwrap_or(child);
                handlers.push((name, handler));
            }
        }
        _ => {}
    }
    handlers
}

fn is_method(name: &str) -> bool {
    METHODS.contains(&name)
}

fn build_endpoint(
    method: &str,
    handler: Node,
    source: &str,
    file: &str,
    api_path: &str,
) -> ApiEndpoint {
    let (parameters, request_body) = infer_request(handler, source);
    ApiEndpoint {
        method: method.to_string(),
        path: api_path.to_string(),
        tags: Vec::new(),
        summary: None,
        description: None,
        parameters,
        request_body,
        responses: infer_responses(handler, source),
        handler: Some(method.to_string()),
        file: file.to_string(),
        line: handler.start_position().row + 1,
        source_kind: SOURCE_NEXT.to_string(),
        fidelity: FIDELITY_HEURISTIC.to_string(),
    }
}

fn infer_request(handler: Node, source: &str) -> (Vec<ApiParameter>, Option<Value>) {
    let mut parameters: Vec<ApiParameter> = Vec::new();
    let mut properties = Map::new();
    let mut saw_body = false;
    for node in descendants(handler) {
        if is_json_call(node, source) {
            saw_body = true;
            collect_json_fields(node, source, handler, &mut properties);
        } else if let Some(name) = search_params_name(node, source) {
            if !parameters.iter().any(|parameter| parameter.name == name) {
                parameters.push(ApiParameter {
                    name,
                    location: "query".to_string(),
                    required: None,
                    description: None,
                    schema: None,
                });
            }
        }
    }
    let request_body = if saw_body {
        Some(json!({ "type": "object", "properties": Value::Object(properties) }))
    } else {
        None
    };
    (parameters, request_body)
}

fn is_json_call(call: Node, source: &str) -> bool {
    if call.kind() != "call_expression" {
        return false;
    }
    let Some(function) = call.child_by_field_name("function") else {
        return false;
    };
    if function.kind() != "member_expression" {
        return false;
    }
    if function
        .child_by_field_name("property")
        .map(|property| node_text(property, source))
        .as_deref()
        != Some("json")
    {
        return false;
    }
    matches!(
        function
            .child_by_field_name("object")
            .map(|object| node_text(object, source))
            .as_deref(),
        Some("req") | Some("request")
    )
}

fn search_params_name(call: Node, source: &str) -> Option<String> {
    if call.kind() != "call_expression" {
        return None;
    }
    let function = call.child_by_field_name("function")?;
    if function.kind() != "member_expression" {
        return None;
    }
    let property = function.child_by_field_name("property")?;
    if node_text(property, source) != "get" {
        return None;
    }
    let object = function.child_by_field_name("object")?;
    if !node_text(object, source).ends_with("searchParams") {
        return None;
    }
    first_string_argument(call, source)
}

fn collect_json_fields(call: Node, source: &str, handler: Node, properties: &mut Map<String, Value>) {
    let Some(declarator) = ancestor_declarator(call) else {
        return;
    };
    let Some(name) = declarator.child_by_field_name("name") else {
        return;
    };
    match name.kind() {
        "object_pattern" => {
            let mut prefix = Vec::new();
            collect_pattern(name, source, &mut prefix, properties);
        }
        "identifier" => {
            let target = node_text(name, source);
            for node in descendants(handler) {
                if let Some((base, path)) = member_chain(node, source) {
                    if base == target {
                        insert_field(properties, &path, json!({}));
                    }
                }
            }
        }
        _ => {}
    }
}

fn ancestor_declarator(node: Node) -> Option<Node> {
    let mut current = node.parent();
    while let Some(parent) = current {
        match parent.kind() {
            "variable_declarator" => return Some(parent),
            "function_declaration"
            | "generator_function_declaration"
            | "function_expression"
            | "arrow_function"
            | "method_definition" => return None,
            _ => current = parent.parent(),
        }
    }
    None
}

fn collect_pattern(
    pattern: Node,
    source: &str,
    prefix: &mut Vec<String>,
    properties: &mut Map<String, Value>,
) {
    match pattern.kind() {
        "object_pattern" => {
            let mut cursor = pattern.walk();
            for child in pattern.named_children(&mut cursor) {
                match child.kind() {
                    "shorthand_property_identifier_pattern" => {
                        prefix.push(node_text(child, source));
                        insert_field(properties, prefix, json!({}));
                        prefix.pop();
                    }
                    "pair_pattern" => {
                        let Some(key) = child.child_by_field_name("key") else {
                            continue;
                        };
                        let Some(name) = property_name(key, source) else {
                            continue;
                        };
                        prefix.push(name);
                        match child.child_by_field_name("value") {
                            Some(value) if value.kind() == "object_pattern" => {
                                collect_pattern(value, source, prefix, properties);
                            }
                            _ => insert_field(properties, prefix, json!({})),
                        }
                        prefix.pop();
                    }
                    "object_assignment_pattern" => {
                        if let Some(left) = child.child_by_field_name("left") {
                            prefix.push(node_text(left, source));
                            insert_field(properties, prefix, json!({}));
                            prefix.pop();
                        }
                    }
                    _ => {}
                }
            }
        }
        "identifier" | "shorthand_property_identifier_pattern" => {
            prefix.push(node_text(pattern, source));
            insert_field(properties, prefix, json!({}));
            prefix.pop();
        }
        "assignment_pattern" => {
            if let Some(left) = pattern.child_by_field_name("left") {
                collect_pattern(left, source, prefix, properties);
            }
        }
        _ => {}
    }
}

fn member_chain(node: Node, source: &str) -> Option<(String, Vec<String>)> {
    if node.kind() != "member_expression" && node.kind() != "subscript_expression" {
        return None;
    }
    let mut properties: Vec<String> = Vec::new();
    let mut current = node;
    loop {
        match current.kind() {
            "member_expression" => {
                let property = current.child_by_field_name("property")?;
                properties.push(node_text(property, source));
                let object = current.child_by_field_name("object")?;
                if is_chain_node(object) {
                    current = object;
                } else {
                    return Some((node_text(object, source), properties.into_iter().rev().collect()));
                }
            }
            "subscript_expression" => {
                let index = current.child_by_field_name("index")?;
                properties.push(string_value(&node_text(index, source))?);
                let object = current.child_by_field_name("object")?;
                if is_chain_node(object) {
                    current = object;
                } else {
                    return Some((node_text(object, source), properties.into_iter().rev().collect()));
                }
            }
            _ => return None,
        }
    }
}

fn is_chain_node(node: Node) -> bool {
    node.kind() == "member_expression" || node.kind() == "subscript_expression"
}

fn insert_field(properties: &mut Map<String, Value>, path: &[String], schema: Value) {
    let Some((head, rest)) = path.split_first() else {
        return;
    };
    if rest.is_empty() {
        properties.entry(head.clone()).or_insert(schema);
        return;
    }
    let entry = properties
        .entry(head.clone())
        .or_insert_with(|| json!({ "type": "object", "properties": {} }));
    let Some(object) = entry.as_object_mut() else {
        return;
    };
    if !object.contains_key("type") {
        object.insert("type".to_string(), json!("object"));
    }
    let children = object
        .entry("properties".to_string())
        .or_insert_with(|| json!({}));
    if let Some(children) = children.as_object_mut() {
        insert_field(children, rest, schema);
    }
}

fn infer_responses(handler: Node, source: &str) -> Vec<ApiResponse> {
    let mut merged: Vec<ApiResponse> = Vec::new();
    for node in descendants(handler) {
        if !is_next_response_json(node, source) {
            continue;
        }
        let status = response_status(node, source);
        let schema = response_schema(node, source);
        if let Some(existing) = merged.iter_mut().find(|response| response.status == status) {
            existing.schema = merge_schema(existing.schema.take(), schema);
        } else {
            merged.push(ApiResponse { status, schema });
        }
    }
    merged.sort_by(|a, b| a.status.cmp(&b.status));
    merged
}

fn is_next_response_json(call: Node, source: &str) -> bool {
    if call.kind() != "call_expression" {
        return false;
    }
    let Some(function) = call.child_by_field_name("function") else {
        return false;
    };
    if function.kind() != "member_expression" {
        return false;
    }
    if function
        .child_by_field_name("property")
        .map(|property| node_text(property, source))
        .as_deref()
        != Some("json")
    {
        return false;
    }
    function
        .child_by_field_name("object")
        .map(|object| node_text(object, source))
        .map(|name| name.ends_with("NextResponse"))
        .unwrap_or(false)
}

fn response_status(call: Node, source: &str) -> String {
    let Some(arguments) = call.child_by_field_name("arguments") else {
        return "200".to_string();
    };
    let mut cursor = arguments.walk();
    let named: Vec<Node> = arguments.named_children(&mut cursor).collect();
    let Some(options) = named.get(1) else {
        return "200".to_string();
    };
    if options.kind() != "object" {
        return "200".to_string();
    }
    let mut walker = options.walk();
    for pair in options.named_children(&mut walker) {
        if pair.kind() != "pair" {
            continue;
        }
        let Some(key) = pair.child_by_field_name("key") else {
            continue;
        };
        if property_name(key, source).as_deref() != Some("status") {
            continue;
        }
        if let Some(value) = pair.child_by_field_name("value") {
            let text = node_text(value, source);
            if text.chars().all(|character| character.is_ascii_digit()) && !text.is_empty() {
                return text;
            }
        }
    }
    "200".to_string()
}

fn response_schema(call: Node, source: &str) -> Option<Value> {
    let arguments = call.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    let first = arguments.named_children(&mut cursor).next()?;
    if first.kind() == "object" {
        Some(literal_object_schema(first, source))
    } else {
        None
    }
}

fn literal_object_schema(object: Node, source: &str) -> Value {
    let mut properties = Map::new();
    let mut cursor = object.walk();
    for child in object.named_children(&mut cursor) {
        match child.kind() {
            "pair" => {
                let Some(key) = child.child_by_field_name("key") else {
                    continue;
                };
                let Some(name) = property_name(key, source) else {
                    continue;
                };
                let schema = child
                    .child_by_field_name("value")
                    .map(|value| value_schema(value, source))
                    .unwrap_or_else(|| json!({}));
                properties.insert(name, schema);
            }
            "shorthand_property_identifier" => {
                properties.insert(node_text(child, source), json!({}));
            }
            _ => {}
        }
    }
    json!({ "type": "object", "properties": Value::Object(properties) })
}

fn value_schema(node: Node, source: &str) -> Value {
    match node.kind() {
        "string" | "template_string" => json!({ "type": "string" }),
        "number" => json!({ "type": "number" }),
        "true" | "false" => json!({ "type": "boolean" }),
        "null" => json!({ "nullable": true }),
        "array" => json!({ "type": "array" }),
        "object" => literal_object_schema(node, source),
        _ => json!({}),
    }
}

fn merge_schema(existing: Option<Value>, incoming: Option<Value>) -> Option<Value> {
    match (existing, incoming) {
        (Some(Value::Object(mut left)), Some(Value::Object(right))) => {
            if let Some(right_properties) = right.get("properties").and_then(Value::as_object) {
                let properties = left
                    .entry("properties".to_string())
                    .or_insert_with(|| json!({}));
                if let Some(properties) = properties.as_object_mut() {
                    for (name, schema) in right_properties {
                        properties.entry(name.clone()).or_insert(schema.clone());
                    }
                }
            }
            Some(Value::Object(left))
        }
        (_, Some(schema)) => Some(schema),
        (existing, None) => existing,
    }
}

fn property_name(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "string" => string_value(&node_text(node, source)),
        "number" => Some(node_text(node, source)),
        _ => {
            let text = node_text(node, source);
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
    }
}

fn first_string_argument(call: Node, source: &str) -> Option<String> {
    let arguments = call.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    let first = arguments.named_children(&mut cursor).next()?;
    string_value(&node_text(first, source))
}

fn string_value(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.len() < 2 {
        return None;
    }
    let bytes = trimmed.as_bytes();
    let quote = bytes[0];
    if (quote == b'"' || quote == b'\'' || quote == b'`') && bytes[bytes.len() - 1] == quote {
        Some(trimmed[1..trimmed.len() - 1].to_string())
    } else {
        None
    }
}

fn descendants(node: Node) -> Vec<Node> {
    let mut out = Vec::new();
    collect_descendants(node, &mut out);
    out
}

fn collect_descendants<'a>(node: Node<'a>, out: &mut Vec<Node<'a>>) {
    out.push(node);
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_descendants(child, out);
    }
}

fn node_text(node: Node, source: &str) -> String {
    source
        .get(node.byte_range())
        .unwrap_or("")
        .to_string()
}

fn parse(source: &str, file_path: &str) -> Option<Tree> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&crate::parser::jsts::grammar_for(file_path))
        .ok()?;
    parser.parse(source, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::api::analyze_api;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scalpel-next-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_route(root: &Path, rel: &str, source: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    }

    #[test]
    fn detects_route_handler_and_derives_path() {
        let root = temp_project("basic");
        write_route(
            &root,
            "app/api/users/[id]/route.ts",
            "export async function GET(req) {\n  return NextResponse.json({ id: \"1\", name: \"Ada\" });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(
            inventory.sources,
            vec![ApiSource {
                kind: "next-app-router".into(),
                file: "app/api/users/[id]/route.ts".into(),
            }]
        );
        assert_eq!(inventory.endpoints.len(), 1);
        let endpoint = &inventory.endpoints[0];
        assert_eq!(endpoint.method, "GET");
        assert_eq!(endpoint.path, "/api/users/{id}");
        assert_eq!(endpoint.handler.as_deref(), Some("GET"));
        assert_eq!(endpoint.file, "app/api/users/[id]/route.ts");
        assert_eq!(endpoint.source_kind, "next-app-router");
        assert_eq!(endpoint.fidelity, "heuristic");
        assert_eq!(endpoint.responses.len(), 1);
        assert_eq!(endpoint.responses[0].status, "200");
        let schema = endpoint.responses[0].schema.as_ref().unwrap();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["id"]["type"], "string");
        assert_eq!(schema["properties"]["name"]["type"], "string");
    }

    #[test]
    fn ignores_route_files_outside_an_api_directory() {
        let root = temp_project("outside-api");
        write_route(
            &root,
            "app/dashboard/route.ts",
            "export async function GET() {\n  return NextResponse.json({ ok: true });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert!(inventory.sources.is_empty());
        assert!(inventory.endpoints.is_empty());
    }

    #[test]
    fn maps_multiple_methods_and_unwraps_wrappers() {
        let root = temp_project("methods");
        write_route(
            &root,
            "app/api/items/route.ts",
            "export const GET = withRBAC(async (req) => {\n  return NextResponse.json({ items: [] });\n});\n\nexport const POST = async (req) => {\n  return NextResponse.json({ ok: true });\n};\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let methods: Vec<&str> = inventory
            .endpoints
            .iter()
            .map(|endpoint| endpoint.method.as_str())
            .collect();
        assert_eq!(methods, vec!["GET", "POST"]);
        assert!(inventory
            .endpoints
            .iter()
            .all(|endpoint| endpoint.handler.as_deref() == Some(endpoint.method.as_str())));
    }

    #[test]
    fn infers_query_parameters_from_search_params() {
        let root = temp_project("query");
        write_route(
            &root,
            "app/api/search/route.js",
            "export async function GET(request) {\n  const q = request.nextUrl.searchParams.get(\"q\");\n  const page = request.nextUrl.searchParams.get(\"page\");\n  return NextResponse.json({ items: [] });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let endpoint = &inventory.endpoints[0];
        assert_eq!(endpoint.parameters.len(), 2);
        assert_eq!(endpoint.parameters[0].name, "q");
        assert_eq!(endpoint.parameters[0].location, "query");
        assert_eq!(endpoint.parameters[1].name, "page");
        assert!(endpoint.request_body.is_none());
    }

    #[test]
    fn infers_request_fields_merged_across_shapes() {
        let root = temp_project("body");
        write_route(
            &root,
            "app/api/users/route.ts",
            "export async function POST(req) {\n  const { name, address } = await req.json();\n  const body = await req.json();\n  const email = body.email;\n  const userId = body.user.id;\n  return NextResponse.json({ ok: true });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let body = inventory.endpoints[0].request_body.as_ref().unwrap();
        assert_eq!(body["type"], "object");
        assert!(body["properties"]["name"].is_object());
        assert!(body["properties"]["address"].is_object());
        assert!(body["properties"]["email"].is_object());
        assert_eq!(body["properties"]["user"]["type"], "object");
        assert!(body["properties"]["user"]["properties"]["id"].is_object());
    }

    #[test]
    fn infers_responses_and_statuses_merged_by_status() {
        let root = temp_project("responses");
        write_route(
            &root,
            "app/api/items/route.ts",
            "export async function GET() {\n  if (cached) {\n    return NextResponse.json({ cached: true });\n  }\n  return NextResponse.json({ items: [], total: 0 }, { status: 200 });\n}\n\nexport async function POST(req) {\n  return NextResponse.json({ error: \"bad\" }, { status: 400 });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let get = inventory
            .endpoints
            .iter()
            .find(|endpoint| endpoint.method == "GET")
            .unwrap();
        assert_eq!(get.responses.len(), 1);
        assert_eq!(get.responses[0].status, "200");
        let schema = get.responses[0].schema.as_ref().unwrap();
        assert!(schema["properties"]["cached"].is_object());
        assert!(schema["properties"]["items"].is_object());
        assert!(schema["properties"]["total"].is_object());

        let post = inventory
            .endpoints
            .iter()
            .find(|endpoint| endpoint.method == "POST")
            .unwrap();
        assert_eq!(post.responses.len(), 1);
        assert_eq!(post.responses[0].status, "400");
    }

    #[test]
    fn renders_catch_all_segments_and_js_routes() {
        let root = temp_project("catch-all");
        write_route(
            &root,
            "app/api/files/[...path]/route.js",
            "export async function DELETE() {\n  return NextResponse.json({ ok: true });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(inventory.endpoints[0].method, "DELETE");
        assert_eq!(inventory.endpoints[0].path, "/api/files/{...path}");
    }

    #[test]
    fn records_only_recognized_http_methods() {
        let root = temp_project("helper-export");
        write_route(
            &root,
            "app/api/things/route.ts",
            "export function helper() {\n  return 1;\n}\n\nexport async function GET() {\n  return NextResponse.json({ ok: true });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(inventory.endpoints.len(), 1);
        assert_eq!(inventory.endpoints[0].method, "GET");
    }

    #[test]
    fn coexists_with_openapi_sources() {
        let root = temp_project("mixed");
        std::fs::write(
            root.join("openapi.json"),
            "{\"openapi\":\"3.0.0\",\"paths\":{\"/pets\":{\"get\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}",
        )
        .unwrap();
        write_route(
            &root,
            "app/api/pets/route.ts",
            "export async function POST() {\n  return NextResponse.json({ ok: true });\n}\n",
        );

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(inventory.sources.len(), 2);
        assert_eq!(inventory.endpoints.len(), 2);
    }
}
