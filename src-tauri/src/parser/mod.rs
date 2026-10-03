use crate::models::ParseResult;
use crate::parser::function_graph::Def;

pub mod api;
pub mod function_graph;
pub mod imports;
pub mod jsts;
pub mod neighborhood;
pub mod project;
pub mod python;
pub mod rust;

pub enum Language {
    Python,
    JsTs,
    Rust,
}

impl Language {
    /// Language for a project-relative path, by extension (case-insensitive).
    pub fn from_path(rel: &str) -> Option<Language> {
        match rel.rsplit_once('.').map(|(_, ext)| ext.to_lowercase())?.as_str() {
            "py" => Some(Language::Python),
            "js" | "jsx" | "ts" | "tsx" => Some(Language::JsTs),
            "rs" => Some(Language::Rust),
            _ => None,
        }
    }
}

/// Definitions declared by one source, dispatched by the file's extension.
/// An extension no language module handles yields no Definitions, not an error.
pub fn definitions(source: &str, rel: &str) -> Result<Vec<Def>, String> {
    match Language::from_path(rel) {
        Some(Language::Python) => python::definitions(source, rel),
        Some(Language::JsTs) => jsts::definitions(source, rel),
        Some(Language::Rust) => rust::definitions(source, rel),
        None => Ok(Vec::new()),
    }
}

pub fn parse_file(root: &str, rel: &str, language: Language) -> Result<ParseResult, String> {
    let rel = rel.replace('\\', "/");
    let full = std::path::Path::new(root).join(&rel);
    let source = std::fs::read_to_string(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    match language {
        Language::Python => python::parse_source(&source, &rel),
        Language::JsTs => jsts::parse_source(&source, &rel),
        Language::Rust => rust::parse_source(&source, &rel),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_from_path_covers_every_parsed_extension() {
        assert!(matches!(Language::from_path("a.py"), Some(Language::Python)));
        assert!(matches!(Language::from_path("a.js"), Some(Language::JsTs)));
        assert!(matches!(Language::from_path("a.jsx"), Some(Language::JsTs)));
        assert!(matches!(Language::from_path("a.ts"), Some(Language::JsTs)));
        assert!(matches!(Language::from_path("a.tsx"), Some(Language::JsTs)));
        assert!(matches!(Language::from_path("a.rs"), Some(Language::Rust)));
        assert!(matches!(Language::from_path("A.RS"), Some(Language::Rust)));
        assert!(Language::from_path("a.css").is_none());
        assert!(Language::from_path("Makefile").is_none());
    }

    #[test]
    fn definitions_dispatch_by_extension_and_tolerate_unknown_files() {
        let python = definitions("def one():\n    return 1\n", "a.py").unwrap();
        assert_eq!(python.len(), 1);
        assert_eq!(python[0].name, "one");

        let rust = definitions("fn one() -> i32 {\n    1\n}\n", "a.rs").unwrap();
        assert_eq!(rust.len(), 1);
        assert_eq!(rust[0].name, "one");

        assert!(definitions("body {}\n", "a.css").unwrap().is_empty());
    }
}
