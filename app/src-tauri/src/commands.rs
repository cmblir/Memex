// Tauri IPC command surface. Each function is a thin adapter that delegates
// to a domain module (vault, parser, index). Keep this file free of business
// logic so the same modules remain unit-testable without Tauri runtime.

use crate::claude::{self, CliResult, CliStatus};
use crate::cli_agent;
use crate::git_log::{self, Commit};
use crate::index::{self, Adjacency};
use crate::mcp_server::{self, McpRegInfo};
use crate::ollama::{self, OllamaStatus};
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
pub fn file_mtimes(root: String) -> Result<Vec<(String, i64)>, String> {
    vault::file_mtimes(&root)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    vault::read_file(&path)
}

/// Concatenate vault markdown (CLAUDE.md + wiki/ + raw/) up to `max_bytes`,
/// so non-tool LLM providers can answer queries / run lint against real vault
/// content (the Claude CLI reads files itself and does not use this).
#[tauri::command]
pub fn read_vault_context(root: String, max_bytes: usize) -> Result<String, String> {
    vault::read_vault_context(&root, max_bytes)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    vault::write_file(&path, &content)
}

/// Read any text file on disk (not restricted to inside the vault). Used by
/// the Ingest drag-drop handler to slurp the dropped file's content into the
/// paste-body textarea. Refuses files larger than 25 MB.
#[tauri::command]
pub fn read_external_text(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("stat failed: {e}"))?;
    if meta.len() > 25 * 1024 * 1024 {
        return Err(format!(
            "file too large: {} bytes (limit 25 MB)",
            meta.len()
        ));
    }
    std::fs::read_to_string(p).map_err(|e| format!("read failed: {e}"))
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

/// Streaming claude run: emits a `claude-stream` event per parsed CLI event
/// so the frontend can render live progress, then resolves with the final
/// result like `claude_run`. Cancel with `claude_cancel(run_id)`.
#[tauri::command]
pub async fn claude_run_stream(
    app: tauri::AppHandle,
    run_id: String,
    prompt: String,
    cwd: String,
) -> Result<CliResult, String> {
    use tauri::Emitter;
    tauri::async_runtime::spawn_blocking(move || {
        let id = run_id.clone();
        claude::run_prompt_stream(&run_id, &prompt, &cwd, move |event| {
            let _ = app.emit(
                "claude-stream",
                claude::StreamEvent {
                    run_id: id.clone(),
                    event,
                },
            );
        })
    })
    .await
    .map_err(|e| format!("join failed: {e}"))?
}

#[tauri::command]
pub fn claude_cancel(run_id: String) -> bool {
    claude::cancel(&run_id)
}

/// Install status of a third-party agent CLI ("gemini-cli" / "codex-cli").
#[tauri::command]
pub async fn agent_check(provider: String) -> CliStatus {
    tauri::async_runtime::spawn_blocking(move || cli_agent::check(&provider))
        .await
        .unwrap_or(CliStatus {
            installed: false,
            version: None,
            path: None,
        })
}

/// Headless run of a third-party agent CLI with the vault as cwd.
#[tauri::command]
pub async fn agent_run(
    provider: String,
    model: String,
    prompt: String,
    cwd: String,
) -> Result<CliResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cli_agent::run_prompt(&provider, &model, &prompt, &cwd)
    })
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

#[tauri::command]
pub async fn ollama_status() -> OllamaStatus {
    ollama::check().await
}

#[tauri::command]
pub fn ollama_install_url() -> &'static str {
    ollama::install_url()
}

/// Opens an external URL in the user's default browser via `open` (macOS),
/// `xdg-open` (Linux), or `start` (Windows). Used by the Ollama setup card
/// to take the user to the install page.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    // For local file paths (not URLs), verify the target exists first so a
    // wrong/missing path returns an error instead of silently doing nothing.
    let is_url = url.contains("://") || url.starts_with("mailto:");
    if !is_url && !std::path::Path::new(&url).exists() {
        return Err(format!("file not found: {url}"));
    }
    let cmd = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(&url).spawn()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&url).spawn()
    };
    cmd.map(|_| ()).map_err(|e| format!("open failed: {e}"))
}

#[tauri::command]
pub fn mcp_registration_info(vault_path: String) -> McpRegInfo {
    mcp_server::registration_info(&vault_path)
}

#[tauri::command]
pub async fn mcp_install(vault_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mcp_server::install(&vault_path))
        .await
        .map_err(|e| format!("join failed: {e}"))?
}

#[tauri::command]
pub async fn mcp_register(vault_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mcp_server::register(&vault_path))
        .await
        .map_err(|e| format!("join failed: {e}"))?
}
