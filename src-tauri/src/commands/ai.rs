use crate::ai::cache::{self, SummaryCache};
use crate::ai::digest::{Options, Target};
use crate::ai::providers::HttpTransport;
use crate::ai::settings::{self, AiSettings, KeyringStore};
use crate::ai::summary::{self, AiSummary};

#[tauri::command(rename_all = "camelCase")]
pub fn ai_settings(provider: String) -> Result<AiSettings, String> {
    Ok(settings::settings(&provider))
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_ai_key(provider: String, key: String) -> Result<AiSettings, String> {
    settings::set_key(&provider, &key)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_ai_key(provider: String) -> Result<AiSettings, String> {
    settings::clear_key(&provider)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_summary(
    root: String,
    target: Target,
    options: Option<Options>,
    task: String,
    provider: String,
    model: String,
    force: bool,
) -> Result<AiSummary, String> {
    let transport = HttpTransport::new()?;
    summary::summarize(
        &root,
        &target,
        options.as_ref(),
        &task,
        &provider,
        &model,
        force,
        &KeyringStore,
        &transport,
    )
    .await
}

/// Writes one cached summary to a path the user picked. The text comes from the
/// store rather than from the caller, so an exported file and a stored file are
/// the same document.
#[tauri::command(rename_all = "camelCase")]
pub fn export_summary(root: String, key: String, path: String) -> Result<(), String> {
    let cache = SummaryCache::new(&root);
    let entry = cache
        .get(&key)
        .ok_or_else(|| "that summary is no longer cached: regenerate it first".to_string())?;
    std::fs::write(&path, cache::render(&entry)?).map_err(|error| format!("{path}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::cache::CachedSummary;

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("scalpel-export-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cached(root: &std::path::Path) -> String {
        let key = SummaryCache::key_for("prompt text");
        SummaryCache::new(root.to_str().unwrap())
            .put(&CachedSummary {
                key: key.clone(),
                task: "explain-selection".into(),
                provider: "openrouter".into(),
                model: "deepseek/deepseek-chat".into(),
                prompt_version: 1,
                created_at_ms: 1_790_000_000_000,
                input_tokens: 10,
                output_tokens: 20,
                text: "## What it does\n\nIt returns a path.".into(),
            })
            .unwrap();
        key
    }

    #[test]
    fn exports_the_stored_document_to_the_chosen_path() {
        let root = fixture("writes");
        let key = cached(&root);
        let target = root.join("exported.md");

        export_summary(
            root.to_str().unwrap().to_string(),
            key.clone(),
            target.to_str().unwrap().to_string(),
        )
        .unwrap();

        let written = std::fs::read_to_string(&target).unwrap();
        assert!(written.starts_with("---\n"), "{written}");
        assert!(written.contains(&format!("key: {key}")), "{written}");
        assert!(written.ends_with("It returns a path.\n"), "{written}");
    }

    #[test]
    fn refuses_to_export_something_that_is_not_cached() {
        let root = fixture("missing");
        let target = root.join("exported.md");

        let error = export_summary(
            root.to_str().unwrap().to_string(),
            "0123456789abcdef".repeat(4),
            target.to_str().unwrap().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("no longer cached"), "{error}");
        assert!(!target.exists());
    }
}
