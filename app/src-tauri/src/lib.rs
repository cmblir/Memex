// Memex application entry point. The Tauri builder wires IPC commands and
// plugins. Domain logic lives in dedicated modules and stays testable without
// the Tauri runtime.

pub mod claude;
mod commands;
pub mod git_log;
pub mod index;
pub mod ollama;
pub mod parser;
pub mod provenance;
pub mod providers;
pub mod secrets;
pub mod settings;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::ensure_default_vault,
            commands::list_files,
            commands::file_mtimes,
            commands::read_file,
            commands::read_vault_context,
            commands::write_file,
            commands::read_external_text,
            commands::create_file,
            commands::create_folder,
            commands::delete_path,
            commands::rename_path,
            commands::parse_links,
            commands::build_link_graph,
            commands::git_log,
            commands::claude_run,
            commands::claude_check,
            commands::scan_provenance,
            commands::set_provider_key,
            commands::delete_provider_key,
            commands::has_provider_key,
            commands::get_settings,
            commands::set_settings,
            commands::chat_complete,
            commands::list_provider_models,
            commands::ollama_status,
            commands::ollama_install_url,
            commands::open_external,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Memex");
}
