use crate::models::ParseResult;
use crate::parser::{self, Language};
use crate::parser::api::ApiInventory;
use crate::parser::imports::ImportAnalysis;
use crate::parser::neighborhood::FunctionGraph;
use crate::parser::project::ProjectGraph;

#[tauri::command(rename_all = "camelCase")]
pub fn parse_python(path: String, root: String) -> Result<ParseResult, String> {
    parser::parse_file(&root, &path, Language::Python)
}

#[tauri::command(rename_all = "camelCase")]
pub fn parse_js_ts(path: String, root: String) -> Result<ParseResult, String> {
    parser::parse_file(&root, &path, Language::JsTs)
}

#[tauri::command(rename_all = "camelCase")]
pub fn parse_rust(path: String, root: String) -> Result<ParseResult, String> {
    parser::parse_file(&root, &path, Language::Rust)
}

/// One file's Function Graph plus the imports that reach other files, in one
/// project scan instead of a parse plus a separate import analysis.
#[tauri::command(rename_all = "camelCase")]
pub fn function_graph(path: String, root: String) -> Result<FunctionGraph, String> {
    crate::parser::neighborhood::function_graph(&root, &path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analyze_imports(path: String, root: String) -> Result<ImportAnalysis, String> {
    parser::imports::analyze(&path, &root)
}

#[tauri::command(rename_all = "camelCase")]
pub fn project_graph(root: String, scope: String) -> Result<ProjectGraph, String> {
    crate::parser::project::project_graph(&root, &scope)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analyze_api(root: String) -> Result<ApiInventory, String> {
    crate::parser::api::analyze_api(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_file_anchors_to_root() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-file-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(dir.join("nested/b.py"), "def two():\n    return 2\n").unwrap();

        let result = crate::parser::parse_file(
            &dir.to_string_lossy(),
            "nested/b.py",
            crate::parser::Language::Python,
        )
        .unwrap();
        assert_eq!(result.nodes[0].name, "two");
        assert_eq!(result.file_path, "nested/b.py");
    }

    #[test]
    fn parse_python_command_reads_file_and_returns_graph() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.py"), "def one():\n    return 1\n").unwrap();

        let result = parse_python("a.py".to_string(), dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].name, "one");
        assert_eq!(result.file_path, "a.py");
    }

    #[test]
    fn parse_python_command_errors_on_missing_file() {
        assert!(parse_python("C:/missing/a.py".into(), "C:/missing".into()).is_err());
    }

    #[test]
    fn parse_rust_command_reads_file_and_returns_graph() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-rs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("a.rs"),
            "fn one() -> i32 {\n    1\n}\n\nfn two() -> i32 {\n    one()\n}\n",
        )
        .unwrap();

        let result = parse_rust("a.rs".to_string(), dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.nodes.len(), 2);
        assert_eq!(result.nodes[0].name, "one");
        assert_eq!(result.file_path, "a.rs");
        assert_eq!(
            result.edges,
            vec![crate::models::GraphEdge {
                source: "two".into(),
                target: "one".into(),
            }]
        );
    }

    #[test]
    fn analyze_api_command_returns_inventory_for_a_folder() {
        let dir = std::env::temp_dir().join(format!("scalpel-api-cmd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("openapi.json"),
            "{\"openapi\":\"3.0.0\",\"paths\":{\"/ping\":{\"get\":{\"responses\":{\"200\":{\"description\":\"ok\"}}}}}}",
        )
        .unwrap();

        let inventory = analyze_api(dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(inventory.endpoints.len(), 1);
        assert_eq!(inventory.endpoints[0].path, "/ping");
    }

    #[test]
    fn parse_python_command_resolves_relative_path_against_root() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-rel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(
            dir.join("nested").join("b.py"),
            "def two():\n    return 2\n",
        )
        .unwrap();

        let result = parse_python(
            "nested/b.py".to_string(),
            dir.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].name, "two");
        assert_eq!(result.file_path, "nested/b.py");
    }

    #[test]
    fn function_graph_command_returns_the_neighbourhood_in_one_call() {
        let dir = std::env::temp_dir().join(format!("scalpel-fn-graph-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("file2.py"), "def func2():\n    return 1\n").unwrap();
        std::fs::write(
            dir.join("file1.py"),
            "from file2 import func2\n\ndef func1():\n    return func2()\n",
        )
        .unwrap();

        let graph = function_graph(
            "file1.py".to_string(),
            dir.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(graph.file.nodes.len(), 1);
        assert_eq!(graph.imports.imports.len(), 1);
        assert_eq!(graph.externals.len(), 1);
        assert_eq!(graph.externals[0].path, "file2.py");
        assert_eq!(graph.cross_edges.len(), 1);
        assert_eq!(graph.cross_edges[0].source, "func1");
        assert_eq!(graph.cross_edges[0].target, "file2.py::func2");
    }

    #[test]
    fn function_graph_command_errors_on_missing_file() {
        assert!(function_graph("missing.py".into(), "C:/missing".into()).is_err());
    }
}
