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
    options: Options,
    task: String,
    provider: String,
    model: String,
    force: bool,
) -> Result<AiSummary, String> {
    let transport = HttpTransport::new()?;
    summary::summarize(
        &root,
        &target,
        &options,
        &task,
        &provider,
        &model,
        force,
        &KeyringStore,
        &transport,
    )
    .await
}
