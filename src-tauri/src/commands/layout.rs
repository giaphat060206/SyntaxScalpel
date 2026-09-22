use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::Position;

#[derive(Debug, Serialize, Deserialize, Default)]
struct Metadata {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    layouts: HashMap<String, HashMap<String, Position>>,
}

fn default_version() -> u32 {
    1
}

pub fn metadata_path(root: &str) -> PathBuf {
    Path::new(root).join(".scalpel").join("metadata.json")
}

fn read_metadata(root: &str) -> Metadata {
    let path = metadata_path(root);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Metadata::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("scalpel-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().to_string()
    }

    #[test]
    fn load_returns_none_when_no_metadata_file() {
        let root = temp_root("load-none");
        assert_eq!(load_layout(root, "src/a.py".into()).unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips_positions() {
        let root = temp_root("round-trip");
        let mut layout = HashMap::new();
        layout.insert("helper".to_string(), Position { x: 12.0, y: 34.0 });
        save_layout(root.clone(), "src/a.py".into(), layout.clone()).unwrap();

        let loaded = load_layout(root.clone(), "src/a.py".into()).unwrap().unwrap();
        assert_eq!(loaded, layout);
        assert!(metadata_path(&root).parent().unwrap().exists());
    }

    #[test]
    fn saving_one_file_preserves_other_files() {
        let root = temp_root("preserve");
        let mut a = HashMap::new();
        a.insert("a".to_string(), Position { x: 1.0, y: 1.0 });
        let mut b = HashMap::new();
        b.insert("b".to_string(), Position { x: 2.0, y: 2.0 });
        save_layout(root.clone(), "src/a.py".into(), a.clone()).unwrap();
        save_layout(root.clone(), "src/b.py".into(), b.clone()).unwrap();

        assert_eq!(load_layout(root.clone(), "src/a.py".into()).unwrap().unwrap(), a);
        assert_eq!(load_layout(root, "src/b.py".into()).unwrap().unwrap(), b);
    }

    #[test]
    fn corrupt_metadata_is_treated_as_absent() {
        let root = temp_root("corrupt");
        let path = metadata_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not json").unwrap();

        assert_eq!(load_layout(root.clone(), "src/a.py".into()).unwrap(), None);

        let mut layout = HashMap::new();
        layout.insert("x".to_string(), Position { x: 0.0, y: 0.0 });
        save_layout(root.clone(), "src/a.py".into(), layout.clone()).unwrap();
        assert_eq!(load_layout(root, "src/a.py".into()).unwrap().unwrap(), layout);
    }
}

pub fn load_layout(
    root: String,
    rel_path: String,
) -> Result<Option<HashMap<String, Position>>, String> {
    Ok(read_metadata(&root).layouts.get(&rel_path).cloned())
}

pub fn save_layout(
    root: String,
    rel_path: String,
    layout: HashMap<String, Position>,
) -> Result<(), String> {
    let mut metadata = read_metadata(&root);
    metadata.version = default_version();
    metadata.layouts.insert(rel_path, layout);

    let path = metadata_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}
