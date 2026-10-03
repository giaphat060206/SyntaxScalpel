use crate::models::ParseResult;

pub mod api;
pub mod function_graph;
pub mod imports;
pub mod jsts;
pub mod project;
pub mod python;
pub mod rust;

pub enum Language {
    Python,
    JsTs,
    Rust,
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
