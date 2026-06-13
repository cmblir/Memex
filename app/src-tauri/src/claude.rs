// Claude CLI bridge. Spawns the system `claude` binary with a prompt and
// captures stdout. The CLI uses the user's existing Claude Pro/Max
// subscription via the Anthropic OAuth login it manages itself — Memex does
// not store an API key.
//
// We pass the prompt on stdin so it can be arbitrary length without bumping
// into argv limits. cwd defaults to the vault root so the CLI can read /
// write project files when given file-tool permissions.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 600;

// Children of in-flight streaming runs, keyed by run_id. Lets `cancel` kill
// a run early and `cancel_all` reap everything on app exit so no orphan
// claude processes outlive Memex. (OnceLock not LazyLock: MSRV is 1.77.)
static RUNNING: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn running() -> &'static Mutex<HashMap<String, Child>> {
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

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
        .env("PATH", augmented_path(&path))
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

/// One event parsed from the CLI's `stream-json` output. `kind` is one of:
/// `init` (run started, text = model), `text` (assistant prose), `tool`
/// (tool call; tool = name, detail = file path / command / pattern),
/// `result` (final summary text), `raw` (unparseable line, verbatim).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ParsedEvent {
    pub kind: String,
    pub tool: Option<String>,
    pub detail: Option<String>,
    pub text: Option<String>,
}

/// Payload emitted to the frontend per event (ParsedEvent + run identity).
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamEvent {
    pub run_id: String,
    #[serde(flatten)]
    pub event: ParsedEvent,
}

/// Parse one line of `--output-format stream-json` output into displayable
/// events. Lines we deliberately ignore (tool results, unknown types) return
/// an empty vec; lines that are not valid JSON come back as `raw`.
pub fn parse_stream_line(line: &str) -> Vec<ParsedEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return vec![ParsedEvent {
            kind: "raw".into(),
            tool: None,
            detail: None,
            text: Some(trimmed.to_string()),
        }];
    };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("system") if v.get("subtype").and_then(|s| s.as_str()) == Some("init") => {
            vec![ParsedEvent {
                kind: "init".into(),
                tool: None,
                detail: None,
                text: v
                    .get("model")
                    .and_then(|m| m.as_str())
                    .map(String::from),
            }]
        }
        Some("assistant") => {
            let blocks = v
                .pointer("/message/content")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();
            blocks
                .iter()
                .filter_map(|b| match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        let text = b.get("text").and_then(|t| t.as_str())?.trim();
                        if text.is_empty() {
                            return None;
                        }
                        Some(ParsedEvent {
                            kind: "text".into(),
                            tool: None,
                            detail: None,
                            text: Some(text.to_string()),
                        })
                    }
                    Some("tool_use") => {
                        let name = b.get("name").and_then(|n| n.as_str())?;
                        let input = b.get("input");
                        let detail = input.and_then(|i| {
                            ["file_path", "path", "command", "pattern", "url"]
                                .iter()
                                .find_map(|k| i.get(k).and_then(|x| x.as_str()))
                        });
                        Some(ParsedEvent {
                            kind: "tool".into(),
                            tool: Some(name.to_string()),
                            detail: detail.map(|d| {
                                d.chars().take(160).collect::<String>()
                            }),
                            text: None,
                        })
                    }
                    _ => None,
                })
                .collect()
        }
        Some("result") => {
            let text = v
                .get("result")
                .and_then(|r| r.as_str())
                .map(String::from)
                .or_else(|| {
                    v.get("subtype").and_then(|s| s.as_str()).map(String::from)
                });
            vec![ParsedEvent {
                kind: "result".into(),
                tool: None,
                detail: None,
                text,
            }]
        }
        _ => vec![],
    }
}

/// Streaming variant of `run_prompt`. Spawns the CLI with
/// `--output-format stream-json`, parses stdout line-by-line and reports
/// each displayable event through `on_event` while the run is in flight.
/// The child is registered under `run_id` so `cancel(run_id)` can kill it.
/// No hard timeout — the user cancels from the UI instead.
pub fn run_prompt_stream<F>(
    run_id: &str,
    prompt: &str,
    cwd: &str,
    on_event: F,
) -> Result<CliResult, String>
where
    F: Fn(ParsedEvent) + Send,
{
    let path = locate().ok_or_else(|| {
        "claude CLI not found on PATH. Install: https://docs.claude.com/en/docs/claude-code"
            .to_string()
    })?;
    let dir = Path::new(cwd);
    if !dir.is_dir() {
        return Err(format!("cwd is not a directory: {cwd}"));
    }
    let allowed = std::env::var("MEMEX_CLAUDE_TOOLS")
        .unwrap_or_else(|_| "Read,Write,Edit,Glob,Grep,Bash".to_string());
    // --verbose is required by the CLI when combining --print with
    // --output-format stream-json.
    let mut child = Command::new(&path)
        .arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json")
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
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout handle".to_string())?;
    let stderr = child.stderr.take();
    let stderr_thread = stderr.map(|s| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = std::io::Read::read_to_string(&mut BufReader::new(s), &mut buf);
            buf
        })
    });

    running()
        .lock()
        .map_err(|_| "registry poisoned".to_string())?
        .insert(run_id.to_string(), child);

    let mut result_text: Option<String> = None;
    let mut texts: Vec<String> = Vec::new();
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        for ev in parse_stream_line(&line) {
            if ev.kind == "result" {
                result_text = ev.text.clone();
            } else if ev.kind == "text" {
                if let Some(t) = &ev.text {
                    texts.push(t.clone());
                }
            }
            on_event(ev);
        }
    }

    let stderr_text = stderr_thread
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    // If the child is gone from the registry, `cancel` beat us to it.
    let child = running()
        .lock()
        .map_err(|_| "registry poisoned".to_string())?
        .remove(run_id);
    let Some(mut child) = child else {
        return Err("cancelled".to_string());
    };
    let status = child
        .wait()
        .map_err(|e| format!("wait failed: {e}"))?
        .code()
        .unwrap_or(-1);

    Ok(CliResult {
        stdout: result_text.unwrap_or_else(|| texts.join("\n")),
        stderr: stderr_text,
        status,
    })
}

/// Kill the streaming run with this id. Returns true if a child was found.
pub fn cancel(run_id: &str) -> bool {
    let Ok(mut reg) = running().lock() else {
        return false;
    };
    if let Some(mut child) = reg.remove(run_id) {
        let _ = child.kill();
        let _ = child.wait();
        true
    } else {
        false
    }
}

/// Kill every in-flight streaming run. Called on app exit.
pub fn cancel_all() {
    let Ok(mut reg) = running().lock() else { return };
    for (_, mut child) in reg.drain() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn locate() -> Option<String> {
    locate_bin("claude", "MEMEX_CLAUDE_PATH")
}

/// Find an agent CLI binary. GUI apps launched from Finder/Dock inherit
/// launchd's minimal PATH (/usr/bin:/bin:...), so `which` misses user-level
/// installs even when the CLI works fine in a terminal. Order: env override,
/// `which`, well-known install dirs, then the user's login shell (which
/// sources the profile that puts nvm / custom dirs on PATH).
pub(crate) fn locate_bin(bin: &str, env_var: &str) -> Option<String> {
    if let Ok(p) = std::env::var(env_var) {
        if !p.is_empty() {
            return Some(p);
        }
    }
    if let Ok(which) = Command::new("/usr/bin/which").arg(bin).output() {
        if which.status.success() {
            let s = String::from_utf8_lossy(&which.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    for candidate in candidate_paths(bin) {
        if Path::new(&candidate).is_file() {
            return Some(candidate);
        }
    }
    login_shell_lookup(bin)
}

fn candidate_paths(bin: &str) -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut paths = vec![
        format!("{home}/.local/bin/{bin}"),    // native installers
        format!("{home}/.claude/local/{bin}"), // claude migrate-installer
        format!("/opt/homebrew/bin/{bin}"),    // Homebrew (Apple Silicon)
        format!("/usr/local/bin/{bin}"),       // Homebrew (Intel) / npm -g
        format!("{home}/.npm-global/bin/{bin}"), // npm custom prefix
        format!("{home}/.bun/bin/{bin}"),      // bun global
    ];
    // nvm installs under ~/.nvm/versions/node/<version>/bin — try newest first.
    if let Ok(entries) = std::fs::read_dir(format!("{home}/.nvm/versions/node")) {
        let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        versions.sort();
        for v in versions.into_iter().rev() {
            paths.push(v.join(format!("bin/{bin}")).to_string_lossy().into_owned());
        }
    }
    paths
}

fn login_shell_lookup(bin: &str) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let out = Command::new(shell)
        .args(["-lc", &format!("command -v {bin}")])
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
// during ingest — and node-based CLIs (gemini) whose `env node` shebang
// needs their own bin dir on PATH. Prepend the CLI's bin dir plus the
// standard user dirs.
pub(crate) fn augmented_path(cli_path: &str) -> String {
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

pub(crate) fn wait_with_timeout(
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
    fn parse_init_line_yields_model() {
        let line = r#"{"type":"system","subtype":"init","model":"claude-opus-4-8","session_id":"s"}"#;
        let evs = parse_stream_line(line);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "init");
        assert_eq!(evs[0].text.as_deref(), Some("claude-opus-4-8"));
    }

    #[test]
    fn parse_assistant_tool_use_extracts_name_and_path() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/v/wiki/index.md"}}]}}"#;
        let evs = parse_stream_line(line);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "tool");
        assert_eq!(evs[0].tool.as_deref(), Some("Read"));
        assert_eq!(evs[0].detail.as_deref(), Some("/v/wiki/index.md"));
    }

    #[test]
    fn parse_assistant_mixed_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Updating index."},{"type":"tool_use","name":"Bash","input":{"command":"ls raw"}}]}}"#;
        let evs = parse_stream_line(line);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].kind, "text");
        assert_eq!(evs[1].tool.as_deref(), Some("Bash"));
        assert_eq!(evs[1].detail.as_deref(), Some("ls raw"));
    }

    #[test]
    fn parse_result_line() {
        let line = r#"{"type":"result","subtype":"success","result":"Ingest complete."}"#;
        let evs = parse_stream_line(line);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "result");
        assert_eq!(evs[0].text.as_deref(), Some("Ingest complete."));
    }

    #[test]
    fn parse_skips_tool_results_and_flags_garbage() {
        // tool_result lines are noise — ignored.
        let ignored = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
        assert!(parse_stream_line(ignored).is_empty());
        // Non-JSON comes back verbatim as raw.
        let evs = parse_stream_line("plain text line");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "raw");
        // Blank lines are dropped.
        assert!(parse_stream_line("   ").is_empty());
    }

    #[test]
    fn cancel_unknown_run_id_is_noop() {
        assert!(!cancel("no-such-run"));
    }

    #[test]
    fn candidate_paths_cover_known_install_locations() {
        let home = std::env::var("HOME").unwrap_or_default();
        let paths = candidate_paths("claude");
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
