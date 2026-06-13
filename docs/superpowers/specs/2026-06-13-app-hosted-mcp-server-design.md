# Design — App-Hosted MCP Server (auto-start on app launch)

- **Date:** 2026-06-13
- **Status:** approved (design); pending spec review
- **Approach:** A — app spawns the existing Python MCP server as a child process over Streamable HTTP

## Goal

When the Memex desktop app is open, the `memex` MCP server is running and
reachable at a stable local URL, so local Claude clients (Claude Code CLI and
Claude Desktop) can use the vault's MCP tools without the user manually
launching a server each session. The app surfaces the connection URL and a
copyable registration command; it does **not** auto-register the client.

Success means: launch app → server up at `http://127.0.0.1:<port>/mcp` →
register once in Claude Code (`claude mcp add --transport http …`) → tools work
in every later session as long as the app is open → quit app → server gone.

## Background (current state)

- MCP server: `mcp-server/memex_mcp.py` (Python / FastMCP), **stdio only**,
  14 tools (read + write + `git_commit`), project resolution via
  `mcp-server/project_registry.py`. Today it is spawned **by the client**
  per session and requires manual `claude mcp add` / Claude Desktop config.
- `project_registry.get_project()` re-reads `projects.json` on every call, so
  switching the active project propagates to the next MCP request with no
  server restart. The server root is fixed to the Memex repo (parent of
  `mcp-server/`).
- The Tauri app already spawns and reaps child processes: `claude.rs` keeps a
  `RUNNING` registry and `cancel_all()` reaps children on `RunEvent::Exit`
  (wired in `lib.rs`). The MCP server lifecycle reuses this pattern.
- `Settings` (`settings.rs`) is an additive, `#[serde(default)]`-based struct;
  new fields are backward-compatible with existing settings files.

## Non-goals (v1)

- No public tunnel, no OAuth, no internet exposure. Localhost only.
- No auto-registration of clients (no editing `claude_desktop_config.json`, no
  running `claude mcp add` for the user). The app shows the URL/command only.
- No rewrite of the MCP server in Rust (Approach B) and no PyInstaller sidecar
  (Approach C). Both deferred.
- No following of vaults outside the Memex repo (see Limitations).
- No automatic restart/supervision of a crashed server beyond surfacing status.

## Architecture

```
app launch (lib.rs .setup)
   └─> mcp_server::start()
         ├─ locate python (mcp-server/.venv/bin/python preferred,
         │   else locate_bin("python3", "MEMEX_PYTHON_PATH"))
         ├─ spawn: <python> mcp-server/memex_mcp.py --http --port <port>
         │         bound to 127.0.0.1
         └─ store Child in MCP registry

Claude Code / Desktop ── HTTP ──> http://127.0.0.1:<port>/mcp ──> memex_mcp.py
                                                                    (FastMCP
                                                                     streamable-http)

app exit (RunEvent::Exit)
   └─> mcp_server::stop()  (kill + wait; no orphan python)
```

## Components

### 1. MCP server transport (`mcp-server/memex_mcp.py`)

Add CLI argument parsing to `main()`:

- Default (no args): `mcp.run()` — stdio. Existing manual/stdio users unaffected.
- `--http` (optional `--port N`, default `7717`; optional `--host`, default
  `127.0.0.1`): `mcp.run(transport="streamable-http", host=<host>, port=<port>)`.

The HTTP mount path is FastMCP's default for streamable-http, yielding the
connection URL `http://<host>:<port>/mcp`. No tool definitions change; the same
14 tools are served over either transport.

### 2. Rust lifecycle module (`app/src-tauri/src/mcp_server.rs`)

Mirrors the `claude.rs` child-management pattern.

- `start(port: u16) -> Result<(), String>`: locate python, spawn
  `memex_mcp.py --http --port <port>`, store the `Child` behind a
  `OnceLock<Mutex<Option<Child>>>`. Idempotent (no-op if already running).
- `stop()`: kill + wait the child; clear the slot.
- `status() -> McpStatus { running: bool, port: u16, url: String, installed: bool }`:
  `installed` reflects whether `mcp-server/.venv` (or a usable python + `mcp`
  module) is present; `running` reflects a live child.
- Python location: prefer `mcp-server/.venv/bin/python`; fall back to
  `locate_bin("python3", "MEMEX_PYTHON_PATH")` (the same Finder-safe locator
  generalized in `claude.rs`). `augmented_path` applied so the child inherits a
  usable PATH when launched from Finder.

### 3. Tauri IPC commands (`commands.rs` + `lib.rs`)

- `mcp_status() -> McpStatus`
- `mcp_start(port: u16) -> Result<(), String>`
- `mcp_stop() -> Result<(), String>`
- `mcp_restart(port: u16) -> Result<(), String>` (stop+start; used when the
  user changes the port)

`lib.rs`:
- In `.setup()`: if `settings.mcp_autostart` (default true) and the venv is
  installed, call `mcp_server::start(settings.mcp_port)`. Failure is non-fatal:
  the app still launches; status surfaces the error.
- In `RunEvent::Exit`: call `mcp_server::stop()` alongside the existing
  `claude::cancel_all()`.

### 4. Settings additions (`settings.rs`)

Two new `#[serde(default)]` fields (backward compatible):

- `mcp_port: u16` (default `7717`)
- `mcp_autostart: bool` (default `true`)

### 5. Settings UI — "MCP Server" section (`PageSettings.tsx` + a tab)

- **Status row**: running/stopped indicator + port. Driven by `mcp_status`.
- **Connection URL**: `http://127.0.0.1:<port>/mcp` with a copy button.
- **Copyable snippets**:
  - Claude Code: `claude mcp add --transport http memex http://127.0.0.1:<port>/mcp`
  - Claude Desktop: the URL for a custom/remote connector (with a one-line note
    that older Desktop builds accept stdio only — see Verification).
- **Port input** (default 7717) → on change, `mcp_restart`.
- **Auto-start toggle** → persists `mcp_autostart`.
- **Not-installed state**: when `status.installed == false`, replace the
  controls with a clear message — "MCP server not installed. Run
  `bash mcp-server/install.sh`." — and (optional, may defer) a one-click
  install button that shells the script. Never fail silently.
- New i18n keys (en/ko/ja) for all visible strings.

## Data flow

1. App launches → reads settings → `mcp_server::start(port)` spawns the python
   child bound to `127.0.0.1:<port>`.
2. Claude Code/Desktop (registered once by the user) opens an HTTP MCP session
   to `…/mcp`; FastMCP serves the 14 tools.
3. Tool calls resolve the project via `project_registry` (live `projects.json`
   read), so the active project in use is reflected per request.
4. App quit → `mcp_server::stop()` kills the child.

## Error handling

- **venv / python missing**: `start` returns an error; `status.installed=false`;
  Settings shows install guidance. App launch is unaffected.
- **port in use**: `start` fails; surface the bind error in Settings status with
  a hint to change the port.
- **child dies while running**: `status.running` flips to false on next poll;
  Settings shows "stopped" with a Start button. (No auto-restart in v1.)
- No errors are swallowed: failures propagate to `status`/Settings, never a
  silent no-op.

## Security

- Bind strictly to `127.0.0.1` (never `0.0.0.0`). The server is not reachable
  from the network or the internet; no tunnel is created.
- Because the listener is loopback-only, no authentication is required for v1,
  matching standard local-MCP practice.
- The server retains the existing write guards (`add_raw_source` refuses
  overwrite, `is_protected_raw`, `_safe_wiki_path`); HTTP transport changes
  reachability, not authorization of tools.

## Verification items (confirm during implementation; avoid assumptions)

1. The installed `mcp` SDK version supports `transport="streamable-http"` and
   the exact `mcp.run(...)` signature (host/port kwargs). Pin/upgrade in
   `mcp-server/requirements.txt` if needed.
2. Whether the current Claude Desktop build accepts a **localhost HTTP** MCP
   endpoint. If yes, Desktop uses the same URL. If not, Desktop keeps a one-time
   stdio config (server spawned by Desktop per session); Claude Code uses HTTP.
   Both end up usable; the spec does not block on Desktop HTTP support.
3. Exact `claude mcp add --transport http` syntax for the target Claude Code
   version (shown verbatim in the Settings snippet).

## Limitations (v1)

- The MCP server root is fixed to the Memex repo (where `mcp-server/` lives). If
  the app opens a vault outside the repo, the server does not follow it. Future
  (v2): pass `MEMEX_VAULT_ROOT=<current vault>` to the child and have
  `project_registry` honor it; restart the server on vault switch.

## Testing

- **Rust unit (`mcp_server.rs`)**: python-location resolution prefers the venv
  path; `status` reports `installed=false` when venv absent; `stop` on a
  not-started server is a no-op. (Spawning a real server is an integration
  concern, not a unit test.)
- **Python**: `memex_mcp.py --http --port <p>` starts and the existing tools
  respond over HTTP (manual/integration check: `claude mcp add` + a tool call).
- **TS**: if a runner is introduced (separate from this work), cover the
  Settings MCP store logic; otherwise verify via `tsc -b` + manual UI check.
- **Manual acceptance** (the real proof): see Success criteria.

## Success criteria

1. Launching the app spawns a server bound to `127.0.0.1:<port>`; an MCP
   handshake to `http://127.0.0.1:<port>/mcp` succeeds.
2. Quitting the app leaves no orphan python process.
3. After `claude mcp add --transport http memex http://127.0.0.1:<port>/mcp`,
   `claude mcp list` shows it connected and a tool (e.g. `stats`) returns data
   in a Claude Code session — repeatable across sessions with no re-setup while
   the app is open.
4. Settings shows live status, the URL, and working copy buttons; with the venv
   absent it shows actionable install guidance instead of failing silently.
5. Existing stdio usage (`python memex_mcp.py` with no args) is unchanged.
