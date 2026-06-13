// memex MCP server registration helpers. The MCP server itself
// (mcp-server/memex_mcp.py) is stdio and unchanged; this module makes it easy
// to register with local Claude clients from the app: it resolves the repo
// root from the current vault, derives the venv python + script paths, builds
// the `claude mcp add` command and the Claude Desktop config JSON, and can run
// install.sh / `claude mcp add` on request. Nothing here hosts a server.

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
pub struct McpRegInfo {
    /// mcp-server/memex_mcp.py was located by walking up from the vault.
    pub found: bool,
    /// Both the venv python and the script exist (install.sh has been run).
    pub installed: bool,
    pub python: Option<String>,
    pub script: Option<String>,
    /// `claude mcp add --scope user memex -- "<python>" "<script>"`.
    pub command: Option<String>,
    /// JSON snippet for claude_desktop_config.json.
    pub desktop_json: Option<String>,
}

/// Walk up from `vault_path` until a directory contains
/// `mcp-server/memex_mcp.py`; that directory is the repo root.
fn find_repo_root(vault_path: &str) -> Option<PathBuf> {
    let mut dir: &Path = Path::new(vault_path);
    loop {
        if dir.join("mcp-server/memex_mcp.py").is_file() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
}

fn desktop_json(python: &str, script: &str) -> String {
    format!(
        "{{\n  \"mcpServers\": {{\n    \"memex\": {{\n      \"command\": \"{python}\",\n      \"args\": [\"{script}\"]\n    }}\n  }}\n}}"
    )
}

/// Assemble registration info for the repo that owns `vault_path`.
pub fn registration_info(vault_path: &str) -> McpRegInfo {
    let Some(root) = find_repo_root(vault_path) else {
        return McpRegInfo {
            found: false,
            installed: false,
            python: None,
            script: None,
            command: None,
            desktop_json: None,
        };
    };
    let script = root.join("mcp-server/memex_mcp.py");
    let python = root.join("mcp-server/.venv/bin/python");
    let installed = script.is_file() && python.is_file();
    let py = python.to_string_lossy().into_owned();
    let sc = script.to_string_lossy().into_owned();
    let command = format!("claude mcp add --scope user memex -- \"{py}\" \"{sc}\"");
    McpRegInfo {
        found: true,
        installed,
        desktop_json: Some(desktop_json(&py, &sc)),
        python: Some(py),
        script: Some(sc),
        command: Some(command),
    }
}

/// Run mcp-server/install.sh (creates the venv + installs deps). Blocking.
pub fn install(vault_path: &str) -> Result<String, String> {
    let root = find_repo_root(vault_path).ok_or("mcp-server/ not found near vault")?;
    let script = root.join("mcp-server/install.sh");
    if !script.is_file() {
        return Err(format!("install.sh not found at {}", script.display()));
    }
    let py = crate::claude::locate_bin("python3", "MEMEX_PYTHON_PATH")
        .ok_or("python3 not found on PATH")?;
    let out = Command::new("bash")
        .arg(&script)
        .current_dir(&root)
        .env("PYTHON", &py)
        .env("PATH", crate::claude::augmented_path(&py))
        .output()
        .map_err(|e| format!("spawn bash failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "install.sh failed (exit {}):\n{}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Run `claude mcp add …` for the user. Requires the claude CLI. Blocking.
pub fn register(vault_path: &str) -> Result<String, String> {
    let info = registration_info(vault_path);
    if !info.installed {
        return Err("MCP server not installed yet — run Install first".into());
    }
    let (py, sc) = (info.python.unwrap(), info.script.unwrap());
    let claude = crate::claude::locate_bin("claude", "MEMEX_CLAUDE_PATH")
        .ok_or("claude CLI not found on PATH")?;
    let out = Command::new(&claude)
        .args(["mcp", "add", "--scope", "user", "memex", "--", &py, &sc])
        .env("PATH", crate::claude::augmented_path(&claude))
        .output()
        .map_err(|e| format!("spawn claude failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "claude mcp add failed:\n{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_repo_root_ascends_to_mcp_server_dir() {
        let base = std::env::temp_dir().join("memex-mcp-test-root");
        let _ = std::fs::remove_dir_all(&base);
        let mcp = base.join("mcp-server");
        std::fs::create_dir_all(&mcp).unwrap();
        std::fs::write(mcp.join("memex_mcp.py"), "# stub").unwrap();
        let nested = base.join("projects").join("p").join("wiki");
        std::fs::create_dir_all(&nested).unwrap();
        assert_eq!(find_repo_root(nested.to_str().unwrap()), Some(base.clone()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn registration_info_not_found_without_mcp_server() {
        let base = std::env::temp_dir().join("memex-mcp-test-none");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let info = registration_info(base.to_str().unwrap());
        assert!(!info.found);
        assert!(!info.installed);
        assert!(info.command.is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn registration_info_builds_command_and_detects_venv() {
        let base = std::env::temp_dir().join("memex-mcp-test-info");
        let _ = std::fs::remove_dir_all(&base);
        let bin = base.join("mcp-server").join(".venv").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(base.join("mcp-server").join("memex_mcp.py"), "# stub").unwrap();
        // venv python absent → found but not installed
        let info = registration_info(base.to_str().unwrap());
        assert!(info.found);
        assert!(!info.installed);
        let cmd = info.command.clone().unwrap();
        assert!(cmd.contains("claude mcp add --scope user memex --"));
        assert!(cmd.contains("mcp-server/memex_mcp.py"));
        // create the venv python → installed
        std::fs::write(bin.join("python"), "#!/bin/sh\n").unwrap();
        assert!(registration_info(base.to_str().unwrap()).installed);
        let _ = std::fs::remove_dir_all(&base);
    }
}
