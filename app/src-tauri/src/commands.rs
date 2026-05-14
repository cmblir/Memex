// Tauri IPC command surface. Each function is a thin adapter that delegates
// to a domain module (vault, parser, index). Keep this file free of business
// logic so the same modules remain unit-testable without Tauri runtime.

use crate::claude::{self, CliResult, CliStatus};
use crate::git_log::{self, Commit};
use crate::index::{self, Adjacency};
use crate::parser;
use crate::provenance::{self, ProvenanceRow};
use crate::providers::{self, ChatRequest, ChatResponse};
use crate::secrets;
use crate::settings::{self, Settings};
use crate::vault::{self, FileContent, FileNode, VaultMeta};

#[tauri::command]
pub fn open_vault(path: String) -> Result<VaultMeta, String> {
    vault::open_vault(&path)
}

#[tauri::command]
pub fn ensure_default_vault() -> Result<String, String> {
    vault::ensure_default_vault()
}

#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<FileNode>, String> {
    vault::list_files(&root)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    vault::read_file(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    vault::write_file(&path, &content)
}

#[tauri::command]
pub fn create_file(parent: String, name: String) -> Result<String, String> {
    vault::create_file(&parent, &name)
}

#[tauri::command]
pub fn create_folder(parent: String, name: String) -> Result<String, String> {
    vault::create_folder(&parent, &name)
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    vault::delete_path(&path)
}

#[tauri::command]
pub fn rename_path(from: String, to_name: String) -> Result<String, String> {
    vault::rename_path(&from, &to_name)
}

#[tauri::command]
pub fn parse_links(path: String) -> Result<Vec<String>, String> {
    parser::parse_links(&path)
}

#[tauri::command]
pub fn build_link_graph(root: String) -> Result<Adjacency, String> {
    index::build_link_graph(&root)
}

#[tauri::command]
pub fn git_log(vault_path: String, limit: Option<usize>) -> Result<Vec<Commit>, String> {
    git_log::git_log(&vault_path, limit.unwrap_or(50))
}

#[tauri::command]
pub fn claude_check() -> CliStatus {
    claude::check()
}

#[tauri::command]
pub async fn claude_run(prompt: String, cwd: String) -> Result<CliResult, String> {
    tauri::async_runtime::spawn_blocking(move || claude::run_prompt(&prompt, &cwd))
        .await
        .map_err(|e| format!("join failed: {e}"))?
}

#[tauri::command]
pub fn scan_provenance(vault_path: String) -> Result<Vec<ProvenanceRow>, String> {
    provenance::scan_provenance(&vault_path)
}

#[tauri::command]
pub fn set_provider_key(provider_id: String, key: String) -> Result<(), String> {
    secrets::set_key(&provider_id, &key)
}

#[tauri::command]
pub fn delete_provider_key(provider_id: String) -> Result<(), String> {
    secrets::delete_key(&provider_id)
}

#[tauri::command]
pub fn has_provider_key(provider_id: String) -> Result<bool, String> {
    Ok(secrets::get_key(&provider_id)?.is_some())
}

#[tauri::command]
pub fn get_settings() -> Settings {
    settings::load()
}

#[tauri::command]
pub fn set_settings(value: Settings) -> Result<(), String> {
    settings::save(&value)
}

#[tauri::command]
pub async fn chat_complete(request: ChatRequest) -> Result<ChatResponse, String> {
    let key = if request.provider_id == "ollama" {
        None
    } else {
        secrets::get_key(&request.provider_id)?
    };
    providers::chat_complete(request, key).await
}

#[tauri::command]
pub async fn list_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    let key = if provider_id == "ollama" {
        None
    } else {
        secrets::get_key(&provider_id)?
    };
    providers::list_models(&provider_id, key).await
}
