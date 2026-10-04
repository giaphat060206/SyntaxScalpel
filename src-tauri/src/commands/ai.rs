use crate::ai::settings::{self, AiSettings};

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
