use std::collections::HashMap;
use std::path::Path;

use crate::commands::fs_cmds::relative_path;
use crate::commands::layout::load_layout;
use crate::models::{ParseResult, Position};
use crate::parser;
use crate::parser::imports::ImportAnalysis;
use crate::parser::project::ProjectGraph;

fn parse_with<F>(path: String, root: String, parse: F) -> Result<ParseResult, String>
where
    F: Fn(&str, &str, &HashMap<String, Position>) -> Result<ParseResult, String>,
{
    let full = Path::new(&root).join(&path);
    let source =
        std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    let rel = relative_path(&root, &full.to_string_lossy());
    let layout = load_layout(root, rel.clone())?.unwrap_or_default();
    parse(&source, &rel, &layout)
}

#[tauri::command(rename_all = "camelCase")]
pub fn parse_python(path: String, root: String) -> Result<ParseResult, String> {
    parse_with(path, root, parser::python::parse_source)
}

#[tauri::command(rename_all = "camelCase")]
pub fn parse_js_ts(path: String, root: String) -> Result<ParseResult, String> {
    parse_with(path, root, parser::jsts::parse_source)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analyze_imports(path: String, root: String) -> Result<ImportAnalysis, String> {
    parser::imports::analyze(&path, &root)
}

#[tauri::command(rename_all = "camelCase")]
pub fn project_graph(root: String, scope: String) -> Result<ProjectGraph, String> {
    crate::parser::project::project_graph(&root, &scope)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_python_command_reads_file_and_returns_graph() {
        let dir = std::env::temp_dir().join(format!("scalpel-parse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.py");
        std::fs::write(&file, "def one():\n    return 1\n").unwrap();

        let result = parse_python(file.to_string_lossy().to_string(), dir.to_string_lossy().to_string())
            .unwrap();
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.nodes[0].name, "one");
        assert_eq!(result.file_path, "a.py");
    }

    #[test]
    fn parse_python_command_errors_on_missing_file() {
        assert!(parse_python("C:/missing/a.py".into(), "C:/missing".into()).is_err());
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
