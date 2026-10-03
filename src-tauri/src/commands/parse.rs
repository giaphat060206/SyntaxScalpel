use crate::models::ParseResult;
use crate::parser::{self, Language};
use crate::parser::api::ApiInventory;
use crate::parser::imports::ImportAnalysis;
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
}
