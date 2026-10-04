use serde::Deserialize;

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

/// One request as a panel would ask it, for the mark probe. It deliberately omits
/// the Digest layers: a panel asks for the defaults, so a mark and the click that
/// follows it resolve to the same layers.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedRequest {
    pub target: Target,
    pub task: String,
    pub provider: String,
    #[serde(default)]
    pub model: String,
}

/// Which of these requests the store can already answer, so the panel's marks
/// survive a restart without the panel keeping state of its own. A request that
/// cannot be resolved is simply not marked: marks are a hint, and a probe must
/// never be the reason the panel shows nothing.
#[tauri::command(rename_all = "camelCase")]
pub async fn ai_cached(root: String, requests: Vec<CachedRequest>) -> Result<Vec<bool>, String> {
    Ok(requests
        .into_iter()
        .map(|request| {
            summary::is_cached(
                &root,
                &request.target,
                None,
                &request.task,
                &request.provider,
                &request.model,
            )
            .unwrap_or(false)
        })
        .collect())
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

    fn key_for(root: &std::path::Path, target: &Target, task: &str, provider: &str, model: &str) -> String {
        use crate::ai::prompts;

        let task_id = prompts::Task::from_id(task).unwrap();
        let options = prompts::default_options(task_id);
        let digest = crate::ai::digest::build(root.to_str().unwrap(), target, &options).unwrap();
        let prompt = prompts::render(task_id, &digest.text).unwrap();
        SummaryCache::key_for(&prompts::cache_input(provider, model, &prompt))
    }

    #[test]
    fn marks_the_requests_the_store_can_answer_and_no_others() {
        let root = fixture("marks");
        std::fs::write(root.join("a.py"), "def one():\n    return 1\n").unwrap();
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        let key = key_for(&root, &target, "explain-selection", "openrouter", "deepseek/deepseek-chat");
        SummaryCache::new(root.to_str().unwrap())
            .put(&CachedSummary {
                key,
                task: "explain-selection".into(),
                provider: "openrouter".into(),
                model: "deepseek/deepseek-chat".into(),
                prompt_version: crate::ai::prompts::PROMPT_VERSION,
                created_at_ms: 1,
                input_tokens: 1,
                output_tokens: 1,
                text: "## Answer\n\nIt returns a path.".into(),
            })
            .unwrap();
        let openrouter = |task: &str, model: &str| CachedRequest {
            target: target.clone(),
            task: task.to_string(),
            provider: "openrouter".into(),
            model: model.to_string(),
        };

        let marks = tauri::async_runtime::block_on(ai_cached(
            root.to_str().unwrap().to_string(),
            vec![
                openrouter("explain-selection", "deepseek/deepseek-chat"),
                openrouter("impact", "deepseek/deepseek-chat"),
                openrouter("not-a-task", ""),
            ],
        ))
        .unwrap();

        assert_eq!(marks, vec![true, false, false]);
    }

    #[test]
    fn reads_the_payload_the_panel_actually_sends() {
        let root = fixture("marks-payload");
        std::fs::write(root.join("a.py"), "def one():\n    return 1\n").unwrap();
        let target = Target::Files { scope: "".into(), files: vec!["a.py".into()] };
        // Stored by a run where the model box was left empty, so the entry holds
        // the provider's default. The probe must resolve an empty model the same
        // way, or a mark would never match what the user generated.
        let key = key_for(&root, &target, "explain-selection", "openrouter", "deepseek/deepseek-chat");
        SummaryCache::new(root.to_str().unwrap())
            .put(&CachedSummary {
                key,
                task: "explain-selection".into(),
                provider: "openrouter".into(),
                model: "deepseek/deepseek-chat".into(),
                prompt_version: crate::ai::prompts::PROMPT_VERSION,
                created_at_ms: 1,
                input_tokens: 1,
                output_tokens: 1,
                text: "## Answer".into(),
            })
            .unwrap();

        // Exactly what `invoke("ai_cached", { root, requests })` puts on the wire:
        // whole `AiRequest`s, carrying fields the probe has no use for.
        let payload = serde_json::json!([
            {
                "root": root.to_str().unwrap(),
                "target": { "kind": "files", "scope": "", "files": ["a.py"] },
                "task": "explain-selection",
                "provider": "openrouter",
                "model": ""
            },
            {
                "root": root.to_str().unwrap(),
                "target": { "kind": "scope", "scope": "" },
                "task": "project-overview",
                "provider": "openrouter",
                "model": ""
            }
        ]);
        let requests: Vec<CachedRequest> = serde_json::from_value(payload).unwrap();

        let marks = tauri::async_runtime::block_on(ai_cached(
            root.to_str().unwrap().to_string(),
            requests,
        ))
        .unwrap();

        assert_eq!(marks, vec![true, false]);
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
