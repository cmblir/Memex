// Claude CLI bridge. Spawns the system `claude` binary with a prompt and
// captures stdout. The CLI uses the user's existing Claude Pro/Max
// subscription via the Anthropic OAuth login it manages itself — Memex does
// not store an API key.
//
// We pass the prompt on stdin so it can be arbitrary length without bumping
// into argv limits. cwd defaults to the vault root so the CLI can read /
// write project files when given file-tool permissions.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 600;

#[derive(Debug, Clone, serde::Serialize)]
pub struct CliResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

pub fn check() -> CliStatus {
    match locate() {
        Some(path) => {
            let v = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            CliStatus {
                installed: true,
                version: v,
                path: Some(path),
            }
        }
        None => CliStatus {
            installed: false,
            version: None,
            path: None,
        },
    }
}

pub fn run_prompt(prompt: &str, cwd: &str) -> Result<CliResult, String> {
    let path = locate().ok_or_else(|| {
        "claude CLI not found on PATH. Install: https://docs.claude.com/en/docs/claude-code"
            .to_string()
    })?;
    let dir = Path::new(cwd);
    if !dir.is_dir() {
        return Err(format!("cwd is not a directory: {cwd}"));
    }
    // --print so the CLI exits after producing output (non-interactive).
    // --allowedTools so Claude can actually edit the vault Memex spawned
    // it on — without this, every Write/Edit in an ingest workflow gets
    // silently denied in --print mode. The user installed Memex with the
    // intent of letting it maintain the vault, so we pre-authorize the
    // tools that the Ingest / Lint prompts need. MEMEX_CLAUDE_TOOLS env
    // var overrides if a user wants a tighter set.
    let allowed = std::env::var("MEMEX_CLAUDE_TOOLS")
        .unwrap_or_else(|_| "Read,Write,Edit,Glob,Grep,Bash".to_string());
    let mut child = Command::new(&path)
        .arg("--print")
        .arg("--allowedTools")
        .arg(&allowed)
        .env("PATH", augmented_path(&path))
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude failed: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("stdin write failed: {e}"))?;
    }

    let output = wait_with_timeout(child, Duration::from_secs(DEFAULT_TIMEOUT_SECS))?;
    Ok(CliResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        status: output.status.code().unwrap_or(-1),
    })
}

fn locate() -> Option<String> {
    // Honor MEMEX_CLAUDE_PATH override first, otherwise try `which claude`.
    if let Ok(p) = std::env::var("MEMEX_CLAUDE_PATH") {
        if !p.is_empty() {
            return Some(p);
        }
    }
    if let Ok(which) = Command::new("/usr/bin/which").arg("claude").output() {
        if which.status.success() {
            let s = String::from_utf8_lossy(&which.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    // GUI apps launched from Finder/Dock inherit launchd's minimal PATH
    // (/usr/bin:/bin:...), so `which` misses user-level installs even when
    // the CLI works fine in a terminal. Probe the well-known install
    // locations directly before giving up.
    for candidate in candidate_paths() {
        if Path::new(&candidate).is_file() {
            return Some(candidate);
        }
    }
    // Last resort: ask the user's login shell, which sources the profile
    // that puts custom install dirs on PATH.
    login_shell_lookup()
}

fn candidate_paths() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        format!("{home}/.local/bin/claude"),    // native installer (default)
        format!("{home}/.claude/local/claude"), // claude migrate-installer
        "/opt/homebrew/bin/claude".to_string(), // Homebrew (Apple Silicon)
        "/usr/local/bin/claude".to_string(),    // Homebrew (Intel) / npm -g
        format!("{home}/.npm-global/bin/claude"), // npm custom prefix
    ]
}

fn login_shell_lookup() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let out = Command::new(shell)
        .args(["-lc", "command -v claude"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Profiles may print banners; take the last line that looks like a path.
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with('/'))
        .map(String::from)
}

// PATH for the spawned CLI. The app's own PATH is minimal when launched
// from Finder, which would break claude's Bash tool (and any shell hooks)
// during ingest. Prepend the CLI's bin dir plus the standard user dirs.
fn augmented_path(cli_path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<String> = Vec::new();
    let push = |dirs: &mut Vec<String>, d: String| {
        if !d.is_empty() && !dirs.contains(&d) {
            dirs.push(d);
        }
    };
    if let Some(parent) = Path::new(cli_path).parent() {
        push(&mut dirs, parent.to_string_lossy().into_owned());
    }
    push(&mut dirs, format!("{home}/.local/bin"));
    push(&mut dirs, "/opt/homebrew/bin".to_string());
    push(&mut dirs, "/usr/local/bin".to_string());
    for d in current.split(':') {
        push(&mut dirs, d.to_string());
    }
    dirs.join(":")
}

fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("wait failed: {e}"));
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return Err(format!("claude CLI timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => return Err(format!("try_wait failed: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_returns_status_struct() {
        // We don't assert installed/not — the test host may or may not have
        // claude. We just verify the struct comes back populated correctly.
        let s = check();
        if s.installed {
            assert!(s.path.is_some());
        } else {
            assert!(s.path.is_none());
            assert!(s.version.is_none());
        }
    }

    #[test]
    fn run_prompt_rejects_invalid_cwd() {
        // Independent of whether claude is on PATH — we want the error path.
        let unique = std::env::temp_dir().join("memex-claude-no-such-xyz");
        let _ = std::fs::remove_dir_all(&unique);
        let res = run_prompt("hi", unique.to_str().unwrap());
        assert!(res.is_err(), "expected error for missing cwd");
    }

    #[test]
    fn candidate_paths_cover_known_install_locations() {
        let home = std::env::var("HOME").unwrap_or_default();
        let paths = candidate_paths();
        assert!(paths.contains(&format!("{home}/.local/bin/claude")));
        assert!(paths.contains(&"/opt/homebrew/bin/claude".to_string()));
    }

    #[test]
    fn augmented_path_prepends_cli_dir_and_dedupes() {
        let p = augmented_path("/Users/x/.local/bin/claude");
        let dirs: Vec<&str> = p.split(':').collect();
        assert_eq!(dirs[0], "/Users/x/.local/bin");
        assert!(dirs.contains(&"/opt/homebrew/bin"));
        // No duplicate entries.
        let mut seen = std::collections::HashSet::new();
        for d in &dirs {
            assert!(seen.insert(*d), "duplicate PATH entry: {d}");
        }
    }

    #[test]
    fn locate_honors_env_override() {
        let prev = std::env::var("MEMEX_CLAUDE_PATH").ok();
        unsafe {
            std::env::set_var("MEMEX_CLAUDE_PATH", "/tmp/fake-claude");
        }
        let p = locate();
        assert_eq!(p.as_deref(), Some("/tmp/fake-claude"));
        if let Some(v) = prev {
            unsafe {
                std::env::set_var("MEMEX_CLAUDE_PATH", v);
            }
        } else {
            unsafe {
                std::env::remove_var("MEMEX_CLAUDE_PATH");
            }
        }
    }
}
