use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Function,
    Class,
    Method,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub params: Vec<String>,
    pub returns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub file_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node() -> GraphNode {
        GraphNode {
            id: "Greeter.greet".into(),
            kind: NodeKind::Method,
            name: "greet".into(),
            params: vec!["self".into(), "name".into()],
            returns: vec!["name".into()],
            parent: Some("Greeter".into()),
            position: None,
        }
    }

    #[test]
    fn graph_node_serializes_camel_case_and_lowercase_kind() {
        let json = serde_json::to_value(sample_node()).unwrap();
        assert_eq!(json["id"], "Greeter.greet");
        assert_eq!(json["kind"], "method");
        assert_eq!(json["params"][0], "self");
        assert_eq!(json["parent"], "Greeter");
        assert!(json.get("position").is_none());
    }

    #[test]
    fn graph_node_includes_position_when_set() {
        let mut node = sample_node();
        node.position = Some(Position { x: 10.0, y: 20.0 });
        let json = serde_json::to_value(node).unwrap();
        assert_eq!(json["position"]["x"], 10.0);
        assert_eq!(json["position"]["y"], 20.0);
    }

    #[test]
    fn parse_result_uses_camel_case_file_path() {
        let result = ParseResult {
            nodes: vec![],
            edges: vec![],
            file_path: "src/main.py".into(),
        };
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["filePath"], "src/main.py");
        assert_eq!(json["nodes"], serde_json::json!([]));
    }
}
