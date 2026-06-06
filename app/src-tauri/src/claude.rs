// Claude CLI bridge. Spawns the system `claude` binary with a prompt and
// captures stdout. The CLI uses the user's existing Claude Pro/Max
// subscription via the Anthropic OAuth login it manages itself — Memex does
// not store an API key.
//
// We pass the prompt on stdin so it can be arbitrary length without bumping
// into argv limits. cwd defaults to the vault root so the CLI can read /
// write project files when given file-tool permissions.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
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
    let child = Command::new(&path)
        .arg("--print")
        .arg("--allowedTools")
        .arg(&allowed)
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude failed: {e}"))?;

    run_with_timeout(
        child,
        prompt.as_bytes().to_vec(),
        Duration::from_secs(DEFAULT_TIMEOUT_SECS),
    )
}

fn locate() -> Option<String> {
    // 1. Explicit override always wins.
    if let Ok(p) = std::env::var("MEMEX_CLAUDE_PATH") {
        if !p.is_empty() {
            return Some(p);
        }
    }
    // 2. `which` against the inherited PATH — works when Memex was launched
    //    from a shell that already has claude on PATH.
    if let Ok(which) = Command::new("/usr/bin/which").arg("claude").output() {
        if which.status.success() {
            let s = String::from_utf8_lossy(&which.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    // 3. GUI apps launched from Finder/Dock inherit a minimal launchd PATH
    //    (/usr/bin:/bin:/usr/sbin:/sbin), so `which` cannot see Homebrew,
    //    npm-global, nvm, bun, or ~/.local/bin. Probe the common locations.
    let mut candidates: Vec<std::path::PathBuf> = vec![
        "/opt/homebrew/bin/claude".into(),
        "/usr/local/bin/claude".into(),
        "/usr/bin/claude".into(),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = Path::new(&home);
        candidates.push(home.join(".local/bin/claude"));
        candidates.push(home.join(".claude/local/claude"));
        candidates.push(home.join(".npm-global/bin/claude"));
        candidates.push(home.join(".bun/bin/claude"));
        // nvm installs under ~/.nvm/versions/node/<version>/bin — try newest.
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            versions.sort();
            for v in versions.into_iter().rev() {
                candidates.push(v.join("bin/claude"));
            }
        }
    }
    candidates
        .into_iter()
        .find(|c| c.is_file())
        .map(|c| c.to_string_lossy().into_owned())
}

// Run the child to completion (or timeout), feeding `prompt` to stdin and
// draining stdout/stderr on dedicated threads. Concurrent drain is required:
// if we wrote the whole prompt before reading, a child that fills its stdout
// pipe buffer (~64 KB) would block on write while we block on stdin —
// a classic deadlock, reachable on large ingest prompts / verbose output.
fn run_with_timeout(
    mut child: Child,
    prompt: Vec<u8>,
    timeout: Duration,
) -> Result<CliResult, String> {
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdin_handle = std::thread::spawn(move || {
        if let Some(mut si) = stdin {
            let _ = si.write_all(&prompt);
            // Dropping `si` closes the pipe so the child sees EOF on stdin.
        }
    });
    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut so) = stdout {
            let _ = so.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut se) = stderr {
            let _ = se.read_to_end(&mut buf);
        }
        buf
    });

    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdin_handle.join();
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    return Err(format!("claude CLI timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => return Err(format!("try_wait failed: {e}")),
        }
    };

    let _ = stdin_handle.join();
    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    Ok(CliResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        status: status.code().unwrap_or(-1),
    })
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
