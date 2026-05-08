// Memex application entry point. The Tauri builder wires IPC commands and
// plugins. Domain logic lives in dedicated modules and stays testable without
// the Tauri runtime.

mod commands;
pub mod index;
pub mod parser;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::list_files,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::create_folder,
            commands::delete_path,
            commands::rename_path,
            commands::parse_links,
            commands::build_link_graph,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Memex");
}
