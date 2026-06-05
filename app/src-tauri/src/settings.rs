// Persisted user settings — written to ~/Library/Application Support/dev.cmblir.memex/
// (or platform equivalent). Stores non-secret data only: connection flags
// (true/false), selected provider + model per task, language. API keys live
// in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Default for Settings {
    fn default() -> Self {
        Self {
            providers: ProviderFlags::default(),
            query_provider: default_query_provider(),
            query_model: default_query_model(),
            ingest_provider: default_ingest_provider(),
            ingest_model: default_ingest_model(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderFlags {
    // anthropic_cli defaults to true: it's the app's primary path and was
    // implicitly always-on before flags existed for CLIs, so existing
    // installs keep working after upgrade.
    #[serde(default = "default_true")]
    pub anthropic_cli: bool,
    #[serde(default)]
    pub gemini_cli: bool,
    #[serde(default)]
    pub codex_cli: bool,
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

impl Default for ProviderFlags {
    fn default() -> Self {
        Self {
            anthropic_cli: true,
            gemini_cli: false,
            codex_cli: false,
            anthropic_api: false,
            openai_api: false,
            google_api: false,
            ollama: false,
            openrouter: false,
        }
    }
}

fn default_true() -> bool {
    true
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialise tests that mutate the data dir env var.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_isolated_data<F: FnOnce(&PathBuf)>(name: &str, f: F) {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir =
            std::env::temp_dir().join(format!("memex-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let prev = std::env::var("MEMEX_DATA_DIR").ok();
        unsafe {
            std::env::set_var("MEMEX_DATA_DIR", &dir);
        }
        f(&dir);
        if let Some(v) = prev {
            unsafe {
                std::env::set_var("MEMEX_DATA_DIR", v);
            }
        } else {
            unsafe {
                std::env::remove_var("MEMEX_DATA_DIR");
            }
        }
    }

    #[test]
    fn defaults_use_claude_cli() {
        let s = Settings::default();
        assert_eq!(s.query_provider, "anthropic-cli");
        assert_eq!(s.ingest_provider, "anthropic-cli");
        assert!(s.providers.anthropic_cli); // primary path stays on
        assert!(!s.providers.gemini_cli);
        assert!(!s.providers.codex_cli);
        assert!(!s.providers.anthropic_api);
        assert!(!s.providers.openai_api);
        assert!(!s.providers.google_api);
        assert!(!s.providers.ollama);
        assert!(!s.providers.openrouter);
    }

    #[test]
    fn legacy_settings_json_keeps_claude_cli_enabled() {
        with_isolated_data("legacy-flags", |dir| {
            // Pre-CLI-flags settings.json — anthropic_cli absent must
            // default to true so upgrades don't break the working setup.
            std::fs::write(
                dir.join("settings.json"),
                r#"{ "providers": { "ollama": true } }"#,
            )
            .unwrap();
            let s = load();
            assert!(s.providers.anthropic_cli);
            assert!(!s.providers.gemini_cli);
            assert!(s.providers.ollama);
        });
    }

    #[test]
    fn load_returns_default_when_missing() {
        with_isolated_data("load-missing", |_dir| {
            let s = load();
            assert_eq!(s.query_provider, "anthropic-cli");
        });
    }

    #[test]
    fn save_then_load_roundtrips() {
        with_isolated_data("roundtrip", |dir| {
            let s = Settings {
                query_provider: "openai-api".into(),
                query_model: "gpt-4o-mini".into(),
                providers: ProviderFlags {
                    openai_api: true,
                    ..ProviderFlags::default()
                },
                ..Settings::default()
            };
            save(&s).unwrap();
            assert!(dir.join("settings.json").exists());
            let back = load();
            assert_eq!(back.query_provider, "openai-api");
            assert_eq!(back.query_model, "gpt-4o-mini");
            assert!(back.providers.openai_api);
        });
    }

    #[test]
    fn load_tolerates_partial_json() {
        with_isolated_data("partial", |dir| {
            // Write a stub with only some fields — defaults should fill the rest.
            std::fs::write(
                dir.join("settings.json"),
                r#"{ "providers": { "ollama": true } }"#,
            )
            .unwrap();
            let s = load();
            assert!(s.providers.ollama);
            assert_eq!(s.query_provider, "anthropic-cli"); // default
        });
    }
}
