use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::{
    ApiEndpoint, ApiInventory, ApiParameter, ApiResponse, ApiSource, FIDELITY_FULL, SOURCE_OPENAPI,
};

const METHODS: [&str; 7] = ["get", "post", "put", "patch", "delete", "head", "options"];

pub fn collect(root: &Path, collected: &[(PathBuf, String)], inventory: &mut ApiInventory) {
    for (path, _folder) in collected {
        let Some(extension) = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_lowercase())
        else {
            continue;
        };
        if extension != "json" && extension != "yaml" && extension != "yml" {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let file = relative_id(root, path);
        let Some(document) = parse_document(&text, &extension) else {
            if looks_like_spec_source(&text) {
                inventory
                    .warnings
                    .push(format!("{file}: could not parse OpenAPI document"));
            }
            continue;
        };
        if !is_spec(&document) {
            continue;
        }
        inventory.sources.push(ApiSource {
            kind: SOURCE_OPENAPI.to_string(),
            file: file.clone(),
        });
        inventory
            .endpoints
            .extend(extract_endpoints(&document, &file));
    }
}

fn looks_like_spec_source(text: &str) -> bool {
    text.contains("openapi") || text.contains("swagger")
}

fn relative_id(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn parse_document(text: &str, extension: &str) -> Option<Value> {
    if extension == "json" {
        serde_json::from_str(text).ok()
    } else {
        serde_norway::from_str::<Value>(text).ok()
    }
}

/// A spec document is any JSON/YAML object carrying an `openapi` or `swagger`
/// version key; other config files are ignored.
fn is_spec(document: &Value) -> bool {
    document.is_object()
        && (document.get("openapi").is_some() || document.get("swagger").is_some())
}

pub(super) fn extract_endpoints(document: &Value, file: &str) -> Vec<ApiEndpoint> {
    let mut endpoints = Vec::new();
    let Some(paths) = document.get("paths").and_then(Value::as_object) else {
        return endpoints;
    };
    for (path, item) in paths {
        let Some(item) = item.as_object() else {
            continue;
        };
        let path_parameters = item.get("parameters");
        for method in METHODS {
            let Some(operation) = item.get(method).and_then(Value::as_object) else {
                continue;
            };
            endpoints.push(build_endpoint(
                document,
                method,
                path,
                path_parameters,
                operation,
                file,
            ));
        }
    }
    endpoints
}

fn build_endpoint(
    document: &Value,
    method: &str,
    path: &str,
    path_parameters: Option<&Value>,
    operation: &Map<String, Value>,
    file: &str,
) -> ApiEndpoint {
    ApiEndpoint {
        method: method.to_uppercase(),
        path: path.to_string(),
        tags: operation
            .get("tags")
            .and_then(Value::as_array)
            .map(|tags| {
                tags.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        summary: operation
            .get("summary")
            .and_then(Value::as_str)
            .map(str::to_string),
        description: operation
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        parameters: collect_parameters(document, path_parameters, operation.get("parameters")),
        request_body: operation
            .get("requestBody")
            .and_then(|body| request_body_schema(document, body)),
        responses: collect_responses(document, operation.get("responses")),
        handler: None,
        file: file.to_string(),
        line: 0,
        source_kind: SOURCE_OPENAPI.to_string(),
        fidelity: FIDELITY_FULL.to_string(),
    }
}

fn collect_parameters(
    document: &Value,
    path_parameters: Option<&Value>,
    operation_parameters: Option<&Value>,
) -> Vec<ApiParameter> {
    let mut ordered: Vec<(String, String, ApiParameter)> = Vec::new();
    for source in [path_parameters, operation_parameters] {
        let Some(array) = source.and_then(Value::as_array) else {
            continue;
        };
        for raw in array {
            let resolved = resolve_reference(document, raw);
            let Some(parameter) = resolved.as_object() else {
                continue;
            };
            let name = parameter
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            let location = parameter
                .get("in")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let built = ApiParameter {
                name: name.clone(),
                location: location.clone(),
                required: parameter.get("required").and_then(Value::as_bool),
                description: parameter
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                schema: parameter.get("schema").map(|schema| expand(document, schema)),
            };
            if let Some(existing) = ordered
                .iter_mut()
                .find(|(n, l, _)| *n == name && *l == location)
            {
                existing.2 = built;
            } else {
                ordered.push((name, location, built));
            }
        }
    }
    ordered.into_iter().map(|(_, _, parameter)| parameter).collect()
}

fn request_body_schema(document: &Value, body: &Value) -> Option<Value> {
    let resolved = resolve_reference(document, body);
    let media = resolved.get("content")?.as_object()?.iter().next()?.1;
    Some(expand(document, media.get("schema")?))
}

fn collect_responses(document: &Value, responses: Option<&Value>) -> Vec<ApiResponse> {
    let Some(responses) = responses.and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut collected: Vec<ApiResponse> = responses
        .iter()
        .map(|(status, response)| {
            let resolved = resolve_reference(document, response);
            let schema = resolved
                .get("content")
                .and_then(Value::as_object)
                .and_then(|content| content.iter().next())
                .and_then(|(_, media)| media.get("schema"))
                .map(|schema| expand(document, schema));
            ApiResponse {
                status: status.clone(),
                schema,
            }
        })
        .collect();
    collected.sort_by(|a, b| a.status.cmp(&b.status));
    collected
}

/// Dereference a single node when it is a `$ref`, otherwise return it as-is.
fn resolve_reference(document: &Value, value: &Value) -> Value {
    if let Some(pointer) = value.get("$ref").and_then(Value::as_str) {
        if let Some(target) = resolve_pointer(document, pointer) {
            return target.clone();
        }
    }
    value.clone()
}

/// Expand every local `$ref` in `value` against `document`; an unresolvable ref
/// becomes a `{ "ref": "<name>" }` placeholder, and cycles stop the same way.
pub fn expand(document: &Value, value: &Value) -> Value {
    let mut active = HashSet::new();
    expand_inner(document, value, &mut active)
}

fn expand_inner(document: &Value, value: &Value, active: &mut HashSet<String>) -> Value {
    match value {
        Value::Object(map) => {
            if let Some(pointer) = map.get("$ref").and_then(Value::as_str) {
                let name = ref_name(pointer);
                if !active.insert(pointer.to_string()) {
                    return json!({ "ref": name });
                }
                let expanded = match resolve_pointer(document, pointer) {
                    Some(target) => expand_inner(document, target, active),
                    None => json!({ "ref": name }),
                };
                active.remove(pointer);
                return expanded;
            }
            let mut out = Map::new();
            for (key, child) in map {
                out.insert(key.clone(), expand_inner(document, child, active));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| expand_inner(document, item, active))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn resolve_pointer<'a>(document: &'a Value, pointer: &str) -> Option<&'a Value> {
    let path = pointer.strip_prefix('#')?;
    let mut current = document;
    for raw in path.split('/').filter(|segment| !segment.is_empty()) {
        let token = raw.replace("~1", "/").replace("~0", "~");
        current = match current {
            Value::Object(map) => map.get(&token)?,
            Value::Array(items) => items.get(token.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current)
}

fn ref_name(pointer: &str) -> String {
    pointer
        .rsplit('/')
        .next()
        .unwrap_or(pointer)
        .replace("~1", "/")
        .replace("~0", "~")
}
