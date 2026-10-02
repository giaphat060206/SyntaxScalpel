use std::path::Path;

use serde::Serialize;

mod openapi;

pub const SOURCE_OPENAPI: &str = "openapi";
pub const FIDELITY_FULL: &str = "full";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSource {
    pub kind: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiParameter {
    pub name: String,
    #[serde(rename = "in")]
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiEndpoint {
    pub method: String,
    pub path: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub parameters: Vec<ApiParameter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<serde_json::Value>,
    pub responses: Vec<ApiResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handler: Option<String>,
    pub file: String,
    pub line: usize,
    pub source_kind: String,
    pub fidelity: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInventory {
    pub sources: Vec<ApiSource>,
    pub endpoints: Vec<ApiEndpoint>,
    pub warnings: Vec<String>,
}

pub fn analyze_api(root: &str) -> Result<ApiInventory, String> {
    let root_path = Path::new(root);
    let tree = crate::parser::project::build_tree(root_path, "")?;
    let mut inventory = ApiInventory {
        sources: Vec::new(),
        endpoints: Vec::new(),
        warnings: Vec::new(),
    };
    openapi::collect(root_path, &tree.collected, &mut inventory);
    finalize(&mut inventory);
    Ok(inventory)
}

fn finalize(inventory: &mut ApiInventory) {
    inventory
        .sources
        .sort_by(|a, b| a.file.cmp(&b.file).then(a.kind.cmp(&b.kind)));
    inventory
        .endpoints
        .sort_by(|a, b| a.path.cmp(&b.path).then(a.method.cmp(&b.method)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "scalpel-api-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_inventory_without_api_sources() {
        let root = temp_project("empty");
        std::fs::write(root.join("main.py"), "def run():\n    return 1\n").unwrap();
        std::fs::write(root.join("package.json"), "{\"name\":\"app\"}\n").unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert!(inventory.sources.is_empty());
        assert!(inventory.endpoints.is_empty());
        assert!(inventory.warnings.is_empty());
    }

    #[test]
    fn detects_json_spec_and_lists_endpoints() {
        let root = temp_project("json");
        std::fs::write(
            root.join("openapi.json"),
            r##"{
                "openapi": "3.0.0",
                "info": { "title": "Pets", "version": "1" },
                "paths": {
                    "/pets": {
                        "get": {
                            "tags": ["pets"],
                            "summary": "List pets",
                            "parameters": [
                                {
                                    "name": "limit",
                                    "in": "query",
                                    "required": false,
                                    "schema": { "type": "integer" }
                                }
                            ],
                            "responses": {
                                "200": {
                                    "description": "ok",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }"##,
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(
            inventory.sources,
            vec![ApiSource {
                kind: "openapi".into(),
                file: "openapi.json".into(),
            }]
        );
        assert_eq!(inventory.endpoints.len(), 1);
        let endpoint = &inventory.endpoints[0];
        assert_eq!(endpoint.method, "GET");
        assert_eq!(endpoint.path, "/pets");
        assert_eq!(endpoint.tags, vec!["pets".to_string()]);
        assert_eq!(endpoint.summary.as_deref(), Some("List pets"));
        assert_eq!(endpoint.file, "openapi.json");
        assert_eq!(endpoint.source_kind, "openapi");
        assert_eq!(endpoint.fidelity, "full");
        assert_eq!(endpoint.line, 0);
        assert!(endpoint.handler.is_none());
        assert_eq!(endpoint.parameters.len(), 1);
        assert_eq!(endpoint.parameters[0].name, "limit");
        assert_eq!(endpoint.parameters[0].location, "query");
        assert_eq!(endpoint.parameters[0].required, Some(false));
        assert_eq!(endpoint.responses.len(), 1);
        assert_eq!(endpoint.responses[0].status, "200");
        assert_eq!(
            endpoint.responses[0].schema.as_ref().unwrap()["type"],
            "array"
        );
    }

    #[test]
    fn parses_yaml_spec() {
        let root = temp_project("yaml");
        std::fs::write(
            root.join("swagger.yaml"),
            "swagger: \"2.0\"\ninfo:\n  title: Pets\n  version: \"1\"\npaths:\n  /health:\n    get:\n      summary: Health\n      responses:\n        \"200\":\n          description: ok\n",
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        assert_eq!(inventory.sources.len(), 1);
        assert_eq!(inventory.sources[0].file, "swagger.yaml");
        assert_eq!(inventory.endpoints.len(), 1);
        assert_eq!(inventory.endpoints[0].method, "GET");
        assert_eq!(inventory.endpoints[0].path, "/health");
        assert_eq!(inventory.endpoints[0].summary.as_deref(), Some("Health"));
    }

    #[test]
    fn expands_local_refs_into_fields() {
        let root = temp_project("refs");
        std::fs::write(
            root.join("openapi.json"),
            r##"{
                "openapi": "3.0.0",
                "paths": {
                    "/pets": {
                        "post": {
                            "requestBody": {
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/Pet" }
                                    }
                                }
                            },
                            "responses": {
                                "201": {
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Pet" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "components": {
                    "schemas": {
                        "Pet": {
                            "type": "object",
                            "required": ["name"],
                            "properties": {
                                "name": { "type": "string" },
                                "tag": { "type": "string" }
                            }
                        }
                    }
                }
            }"##,
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let endpoint = &inventory.endpoints[0];
        let body = endpoint.request_body.as_ref().unwrap();
        assert_eq!(body["type"], "object");
        assert_eq!(body["properties"]["name"]["type"], "string");
        assert_eq!(body["properties"]["tag"]["type"], "string");
        let response = endpoint.responses[0].schema.as_ref().unwrap();
        assert_eq!(response["properties"]["name"]["type"], "string");
    }

    #[test]
    fn keeps_ref_name_when_unresolved() {
        let root = temp_project("unresolved");
        std::fs::write(
            root.join("openapi.json"),
            r##"{
                "openapi": "3.0.0",
                "paths": {
                    "/pets": {
                        "get": {
                            "responses": {
                                "200": {
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Missing" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }"##,
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let schema = inventory.endpoints[0].responses[0].schema.as_ref().unwrap();
        assert_eq!(schema["ref"], "Missing");
    }

    #[test]
    fn expands_recursive_refs_without_hanging() {
        let root = temp_project("recursive");
        std::fs::write(
            root.join("openapi.json"),
            r##"{
                "openapi": "3.0.0",
                "paths": {
                    "/nodes": {
                        "get": {
                            "responses": {
                                "200": {
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Node" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "components": {
                    "schemas": {
                        "Node": {
                            "type": "object",
                            "properties": {
                                "value": { "type": "string" },
                                "next": { "$ref": "#/components/schemas/Node" }
                            }
                        }
                    }
                }
            }"##,
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let schema = inventory.endpoints[0].responses[0].schema.as_ref().unwrap();
        assert_eq!(schema["properties"]["value"]["type"], "string");
        assert_eq!(schema["properties"]["next"]["ref"], "Node");
    }

    #[test]
    fn merges_path_and_operation_parameters_with_operation_winning() {
        let root = temp_project("params");
        std::fs::write(
            root.join("openapi.json"),
            r##"{
                "openapi": "3.0.0",
                "paths": {
                    "/pets/{id}": {
                        "parameters": [
                            { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                        ],
                        "get": {
                            "parameters": [
                                { "name": "id", "in": "path", "required": true, "description": "pet id", "schema": { "type": "integer" } }
                            ],
                            "responses": { "200": { "description": "ok" } }
                        }
                    }
                }
            }"##,
        )
        .unwrap();

        let inventory = analyze_api(&root.to_string_lossy()).unwrap();
        let params = &inventory.endpoints[0].parameters;
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].description.as_deref(), Some("pet id"));
        assert_eq!(params[0].schema.as_ref().unwrap()["type"], "integer");
    }

    #[test]
    fn serializes_payload_as_camel_case() {
        let inventory = ApiInventory {
            sources: vec![ApiSource {
                kind: "openapi".into(),
                file: "openapi.yaml".into(),
            }],
            endpoints: vec![ApiEndpoint {
                method: "GET".into(),
                path: "/pets".into(),
                tags: vec!["pets".into()],
                summary: None,
                description: None,
                parameters: vec![],
                request_body: None,
                responses: vec![],
                handler: None,
                file: "openapi.yaml".into(),
                line: 0,
                source_kind: "openapi".into(),
                fidelity: "full".into(),
            }],
            warnings: vec![],
        };
        let json = serde_json::to_value(inventory).unwrap();
        assert_eq!(json["sources"][0]["kind"], "openapi");
        assert_eq!(json["endpoints"][0]["sourceKind"], "openapi");
        assert_eq!(json["endpoints"][0]["requestBody"], serde_json::Value::Null);
    }
}
