use std::collections::HashMap;

use tree_sitter::Node;

use crate::models::{GraphEdge, GraphNode, NodeKind, ParseResult};

/// One call a Definition's body makes, and the line it is made on.
#[derive(Debug, Clone, PartialEq)]
pub struct CallSite {
    pub name: String,
    /// 1-based line of the call expression, so a relationship can quote the call
    /// itself rather than describe it.
    pub line: usize,
}

/// One extracted Definition, with everything a Function Graph needs.
///
/// `calls` is captured while the definition's body is still in hand, so edge
/// building never re-walks the tree, other modules can read a file's Definitions
/// without holding on to its syntax tree, and the call sites carry their lines.
pub struct Def {
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub params: Vec<String>,
    pub returns: Vec<String>,
    pub uses: Vec<String>,
    pub calls: Vec<CallSite>,
    pub value: Option<String>,
    pub parent: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
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

pub fn collect_edges(defs: &[Def]) -> Vec<GraphEdge> {
    let mut targets: HashMap<&str, &str> = HashMap::new();
    for def in defs {
        if def.kind != NodeKind::Class && def.kind != NodeKind::Variable {
            targets.insert(def.id.as_str(), def.id.as_str());
            targets.insert(def.name.as_str(), def.id.as_str());
        }
    }

    let mut edges: Vec<GraphEdge> = Vec::new();
    for def in defs {
        for call in &def.calls {
            let Some(target) = targets.get(call.name.as_str()) else {
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

pub fn assemble(defs: &[Def], file_path: &str) -> ParseResult {
    let nodes = defs.iter().map(to_node).collect();
    let edges = collect_edges(defs);
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

    fn sites(names: &[&str]) -> Vec<CallSite> {
        names
            .iter()
            .enumerate()
            .map(|(index, name)| CallSite {
                name: (*name).to_string(),
                line: index + 1,
            })
            .collect()
    }

    fn def(id: &str, kind: NodeKind) -> Def {
        Def {
            id: id.into(),
            kind,
            name: id.into(),
            params: vec![],
            returns: vec![],
            uses: vec![],
            calls: vec![],
            value: None,
            parent: None,
            start_line: 1,
            end_line: 1,
        }
    }

    #[test]
    fn collect_edges_maps_names_dedups_and_skips_self_edges() {
        let mut caller = def("caller", NodeKind::Function);
        caller.calls = sites(&[
            "callee",
            "callee",
            "C",
            "self_ref",
            "public_name",
        ]);
        let mut self_ref = def("self_ref", NodeKind::Function);
        self_ref.calls = sites(&["callee", "public_name"]);
        let mut aliased = def("aliased_id", NodeKind::Function);
        aliased.name = "public_name".into();
        aliased.calls = sites(&["callee", "self_ref"]);
        let defs = vec![
            caller,
            self_ref,
            aliased,
            def("callee", NodeKind::Function),
            def("C", NodeKind::Class),
        ];

        assert_eq!(
            collect_edges(&defs),
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

    #[test]
    fn a_definition_without_calls_contributes_no_edges() {
        assert!(collect_edges(&[def("loner", NodeKind::Function)]).is_empty());
    }

    #[test]
    fn containers_and_variables_are_never_edge_targets() {
        let mut caller = def("caller", NodeKind::Function);
        caller.calls = sites(&["C", "V", "callee"]);
        let defs = vec![
            caller,
            def("C", NodeKind::Class),
            def("V", NodeKind::Variable),
            def("callee", NodeKind::Function),
        ];
        assert_eq!(
            collect_edges(&defs),
            vec![GraphEdge {
                source: "caller".into(),
                target: "callee".into(),
            }]
        );
    }
}
