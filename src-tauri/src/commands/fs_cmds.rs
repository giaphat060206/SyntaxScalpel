use std::path::Path;

use serde::Serialize;

const ALLOWED_EXTENSIONS: [&str; 15] = [
    "py", "js", "jsx", "ts", "tsx", "md", "c", "cpp", "cc", "hpp", "h", "java", "cs", "rs", "go",
];

const SKIPPED_DIRS: [&str; 8] = [
    ".git", "node_modules", "target", "dist", ".scalpel", "__pycache__", ".venv", "venv",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileEntry>,
}

pub fn relative_path(root: &str, path: &str) -> String {
    Path::new(path)
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.replace('\\', "/"))
}

fn is_supported(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| ALLOWED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        let dir = std::env::temp_dir().join(format!("scalpel-fs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("src/main.py"), "def a():\n    return 1\n").unwrap();
        std::fs::write(dir.join("README.md"), "# hi\n").unwrap();
        std::fs::write(dir.join("src/style.css"), "body {}").unwrap();
        std::fs::write(dir.join("node_modules/junk.py"), "def junk(): pass\n").unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn lists_supported_files_and_skips_ignored_dirs() {
        let root = fixture();
        let entries = list_directory(root.clone(), "".into()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"README.md"));
        assert!(names.contains(&"src"));
        assert!(!names.contains(&"node_modules"));

        let src = entries.iter().find(|e| e.name == "src").unwrap();
        let child_names: Vec<&str> =
            src.children.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(child_names, vec!["main.py"]);
    }

    #[test]
    fn entry_paths_are_project_relative_with_forward_slashes() {
        let root = fixture();
        let entries = list_directory(root, "".into()).unwrap();
        let readme = entries.iter().find(|e| e.name == "README.md").unwrap();
        assert_eq!(readme.path, "README.md");
    }

    #[test]
    fn read_markdown_returns_raw_text() {
        let root = fixture();
        let path = Path::new(&root).join("README.md");
        assert_eq!(read_markdown(path.to_string_lossy().to_string()).unwrap(), "# hi\n");
    }

    #[test]
    fn read_markdown_errors_on_missing_file() {
        assert!(read_markdown("C:/definitely/missing.md".into()).is_err());
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_directory(root: String, rel_path: String) -> Result<Vec<FileEntry>, String> {
    let base = Path::new(&root).join(&rel_path);
    let read = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for item in read {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let full = item.path();
        let is_dir = full.is_dir();

        if is_dir {
            if SKIPPED_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            let child_rel = relative_path(&root, &full.to_string_lossy());
            let children = list_directory(root.clone(), child_rel).unwrap_or_default();
            if children.is_empty() {
                continue;
            }
            entries.push(FileEntry {
                name,
                path: relative_path(&root, &full.to_string_lossy()),
                is_dir: true,
                children,
            });
        } else if is_supported(&name) {
            entries.push(FileEntry {
                name,
                path: relative_path(&root, &full.to_string_lossy()),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_markdown(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}
