use std::collections::HashMap;

use tree_sitter::Node;

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult};

pub struct Def<'a> {
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub params: Vec<String>,
    pub returns: Vec<String>,
    pub uses: Vec<String>,
    pub value: Option<String>,
    pub parent: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub body: Option<Node<'a>>,
}

pub fn line_range(node: Node) -> (usize, usize) {
    (node.start_position().row + 1, node.end_position().row + 1)
}

pub fn node_text(node: Node, source: &str) -> String {
    node.utf8_text(source.as_bytes()).unwrap_or("").to_string()
}

pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn to_node(def: &Def) -> GraphNode {
    GraphNode {
        id: def.id.clone(),
        kind: def.kind.clone(),
        name: def.name.clone(),
        params: def.params.clone(),
        returns: def.returns.clone(),
        uses: def.uses.clone(),
        start_line: def.start_line,
        end_line: def.end_line,
        value: def.value.clone(),
        parent: def.parent.clone(),
    }
}

pub fn collect_edges(
    defs: &[Def],
    source: &str,
    calls_in: fn(Node, &str) -> Vec<String>,
) -> Vec<GraphEdge> {
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
        let calls = calls_in(body, source);
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

pub fn assemble(
    defs: Vec<Def>,
    source: &str,
    file_path: &str,
    calls_in: fn(Node, &str) -> Vec<String>,
) -> ParseResult {
    let nodes = defs.iter().map(to_node).collect();
    let edges = collect_edges(&defs, source, calls_in);
    ParseResult {
        nodes,
        edges,
        file_path: file_path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{GraphEdge, NodeKind};

    fn def(id: &str, kind: NodeKind) -> Def<'static> {
        Def {
            id: id.into(),
            kind,
            name: id.into(),
            params: vec![],
            returns: vec![],
            uses: vec![],
            value: None,
            parent: None,
            start_line: 1,
            end_line: 1,
            body: None,
        }
    }

    #[test]
    fn collect_edges_maps_names_dedups_and_skips_self_edges() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&tree_sitter_python::LANGUAGE.into())
            .unwrap();
        let tree = parser.parse("x = 1\n", None).unwrap();
        let body = tree.root_node();

        let mut caller = def("caller", NodeKind::Function);
        caller.body = Some(body);
        let mut self_ref = def("self_ref", NodeKind::Function);
        self_ref.body = Some(body);
        let mut aliased = def("aliased_id", NodeKind::Function);
        aliased.name = "public_name".into();
        aliased.body = Some(body);
        let defs = vec![
            caller,
            self_ref,
            aliased,
            def("callee", NodeKind::Function),
            def("C", NodeKind::Class),
        ];

        let edges = collect_edges(&defs, "", |_, _| {
            vec![
                "callee".into(),
                "callee".into(),
                "C".into(),
                "self_ref".into(),
                "public_name".into(),
            ]
        });

        assert_eq!(
            edges,
            vec![
                GraphEdge {
                    source: "caller".into(),
                    target: "callee".into(),
                },
                GraphEdge {
                    source: "caller".into(),
                    target: "self_ref".into(),
                },
                GraphEdge {
                    source: "caller".into(),
                    target: "aliased_id".into(),
                },
                GraphEdge {
                    source: "self_ref".into(),
                    target: "callee".into(),
                },
                GraphEdge {
                    source: "self_ref".into(),
                    target: "aliased_id".into(),
                },
                GraphEdge {
                    source: "aliased_id".into(),
                    target: "callee".into(),
                },
                GraphEdge {
                    source: "aliased_id".into(),
                    target: "self_ref".into(),
                },
            ]
        );
    }
}
