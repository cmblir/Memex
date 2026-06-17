---
title: "lazyclaw — Overview"
type: entity
created: 2026-06-18
last_updated: 2026-06-18
source_count: 1
confidence: medium
status: active
tags:
  - lazyclaw
  - software
  - cli
  - agent
  - claw-family
sources:
  - lazyclaw-codebase-2026-06
---

# lazyclaw

**lazyclaw** is a TUI-first Node CLI agent whose pitch is: *a terminal agent that
learns on your Claude subscription — for $0 — and reaches you on every channel.*[^src-lazyclaw-codebase-2026-06]
It is a single-binary-feel Node CLI (Node 18+, Node 22+ for Slack Socket Mode) in
the **"claw" family**, with the lineage Hermes → OpenClaw → nanoclaw.[^src-lazyclaw-codebase-2026-06]
Distributed on npm as `lazyclaw`; `npx lazyclaw` runs a first-run wizard then drops
into a chat REPL. MIT-licensed; source at `cmblir/lazyclaw`.[^src-lazyclaw-codebase-2026-06]

There is **no hosted service and no telemetry** — config is plain JSON at
`~/.lazyclaw/config.json` and secrets live in `~/.lazyclaw/.env` (written 0600,
never logged).[^src-lazyclaw-codebase-2026-06]

## $0 self-learning (the headline)

lazyclaw splits two independent provider slots: **`provider`** (the chat hot path)
and **`trainer`** (the learning loop — skill synthesis, reflection, user model).[^src-lazyclaw-codebase-2026-06]
Because they are independent, a Claude Pro/Max subscription via `claude-cli` can
power the learning loop for free while chat runs on any backend; `trainer:
{ provider: "auto" }` auto-detects the `claude-cli` session.[^src-lazyclaw-codebase-2026-06]
After every turn a fire-and-forget loop records the trajectory and distils
reusable skills tagged `trained_by`.[^src-lazyclaw-codebase-2026-06]

## Architecture surfaces

- **Daemon / gateway** — an always-on daemon is the agent core (one provider path,
  one session/memory store on `127.0.0.1`). `lazyclaw gateway` runs that core plus
  the configured channel transports in a single process; in-process channels let
  `/handoff` notify the target channel with a resume marker. The gateway is
  **authenticated by default** (bearer token at `~/.lazyclaw/gateway.token`).[^src-lazyclaw-codebase-2026-06]
- **Channels** — the same agent answers everywhere; listeners forward into the
  daemon's shared session store. Built in: **Slack, Telegram, Matrix, HTTP**;
  plugins (`@lazyclaw/channel-*`): **Discord, Email, Signal, Voice, WhatsApp**.
  Inbound messages are deduplicated by native id (idempotent redelivery).[^src-lazyclaw-codebase-2026-06]
- **Multi-agent orchestration** — provider `orchestrator` turns a hard request into
  **Plan → Delegate → Synthesise**: a planner decomposes, workers run subtasks in
  parallel, the planner merges.[^src-lazyclaw-codebase-2026-06]
- **Tool registry** — 12 categories (`agents`, `browser`, `coding`, `exec`, `fs`,
  `git`, `iot`, `learning`, `media`, `net`, `os`, `scheduling`) plus stdio MCP;
  sensitive tools (shell/write/network) are **fail-closed** behind an approval
  hook by default.[^src-lazyclaw-codebase-2026-06]
- **Durable recall** — one SQLite + FTS5 index over sessions/skills/trajectories/
  memory, rebuildable from the corpus via `lazyclaw index rebuild`.[^src-lazyclaw-codebase-2026-06]
- Plus **skills** (markdown instruction bundles), **loops & goals** (cron-scheduled,
  restart-surviving), an **8-layer persona** prompt stack, **sandboxes** (local /
  docker / ssh / singularity / modal / daytona), **MCP** server boot, and a
  framework-free **dashboard** SPA (17 tabs, dark amber theme).[^src-lazyclaw-codebase-2026-06]

## Providers

`claude-cli` (subscription, keyless); `anthropic` / `openai` / `gemini` (API key);
`ollama` (local); the OpenAI-compatible set (`nim`, `openrouter`, `groq`,
`together`, `xai`, `deepseek`, `mistral`, `fireworks`); `custom` (any OpenAI-compat
v1 endpoint); the keyless CLI providers `codex-cli` / `gemini-cli`; and the
`orchestrator` meta-provider.[^src-lazyclaw-codebase-2026-06]

## Security posture

Sensitive tools deny by default unless an approval hook grants them; a listener or
the daemon **refuses to start** while `security.allowUnattendedSensitive=true`
(an always-on surface plus that flag is a remote-code-execution path).[^src-lazyclaw-codebase-2026-06]
Config values resolved with `$(...)` execute at load, so config is treated like a
shell rc; secrets are scrubbed from the `bash` child env and redacted from
trajectories, synthesised skills, and `lazyclaw export`.[^src-lazyclaw-codebase-2026-06]

## Development history

The full release/phase timeline and the thematic commit batches are tracked in
[[lazyclaw-commit-history|the commit-history analysis]]. In brief: imported
2026-05-18 at v3.99.29, the v4 line added /loop·/goal, multi-agent Slack teams,
and per-agent memory; **v5.0** (2026-06-05) was a full Hermes-parity rewrite
(phases A–H); **v6** (June 2026) brought cross-channel handoff, a module-architecture
refactor, gateway hardening, and a long UX-audit tail.[^src-lazyclaw-codebase-2026-06]

[^src-lazyclaw-codebase-2026-06]: [[source-lazyclaw-codebase-2026-06]]

