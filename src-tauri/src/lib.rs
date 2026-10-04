pub mod ai;
mod commands;
mod models;
mod parser;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::fs_cmds::list_directory,
            commands::fs_cmds::read_markdown,
            commands::fs_cmds::read_file,
            commands::parse::parse_python,
            commands::parse::parse_js_ts,
            commands::parse::parse_rust,
            commands::parse::function_graph,
            commands::parse::analyze_imports,
            commands::parse::project_graph,
            commands::parse::analyze_api,
            commands::ai::ai_settings,
            commands::ai::set_ai_key,
            commands::ai::clear_ai_key,
            commands::ai::ai_summary,
            commands::ai::ai_cached,
            commands::ai::export_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
