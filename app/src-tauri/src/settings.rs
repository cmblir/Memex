// Persisted user settings — written to ~/Library/Application Support/dev.cmblir.memex/
// (or platform equivalent). Stores non-secret data only: connection flags
// (true/false), selected provider + model per task, language. API keys live
// in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub providers: ProviderFlags,
    #[serde(default = "default_query_provider")]
    pub query_provider: String,
    #[serde(default = "default_query_model")]
    pub query_model: String,
    #[serde(default = "default_ingest_provider")]
    pub ingest_provider: String,
    #[serde(default = "default_ingest_model")]
    pub ingest_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderFlags {
    #[serde(default)]
    pub anthropic_api: bool,
    #[serde(default)]
    pub openai_api: bool,
    #[serde(default)]
    pub google_api: bool,
    #[serde(default)]
    pub ollama: bool,
    #[serde(default)]
    pub openrouter: bool,
}

fn default_query_provider() -> String {
    "anthropic-cli".to_string()
}
fn default_query_model() -> String {
    "claude-sonnet-4-6".to_string()
}
fn default_ingest_provider() -> String {
    "anthropic-cli".to_string()
}
fn default_ingest_model() -> String {
    "claude-sonnet-4-6".to_string()
}

fn settings_dir() -> Result<PathBuf, String> {
    let base = if let Ok(p) = std::env::var("MEMEX_DATA_DIR") {
        PathBuf::from(p)
    } else if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME").ok_or_else(|| "no HOME".to_string())?;
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("dev.cmblir.memex")
    } else if cfg!(target_os = "windows") {
        let appdata = std::env::var_os("APPDATA").ok_or_else(|| "no APPDATA".to_string())?;
        PathBuf::from(appdata).join("Memex")
    } else {
        let home = std::env::var_os("HOME").ok_or_else(|| "no HOME".to_string())?;
        PathBuf::from(home).join(".config").join("memex")
    };
    std::fs::create_dir_all(&base).map_err(|e| format!("create settings dir: {e}"))?;
    Ok(base)
}

pub fn load() -> Settings {
    let path = match settings_dir() {
        Ok(p) => p.join("settings.json"),
        Err(_) => return Settings::default(),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Settings::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let path = settings_dir()?.join("settings.json");
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("write settings: {e}"))
}
