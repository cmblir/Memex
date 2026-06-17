---
title: "lazyclaw — Commit History"
type: analysis
created: 2026-06-18
last_updated: 2026-06-18
source_count: 1
confidence: medium
status: active
tags:
  - lazyclaw
  - software
  - changelog
  - git-history
sources:
  - lazyclaw-codebase-2026-06
---

# lazyclaw — Commit History

A grouped digest of the [[lazyclaw-overview|lazyclaw]] git history: **323 commits,
2026-05-18 → 2026-06-16**, from repo import (`bda076d`, v3.99.29) to HEAD
(`46ff8b1`).[^src-lazyclaw-codebase-2026-06] Full oneline log lives in the source
snapshot.

## By the numbers

- **Type mix:** 141 `feat`, 79 `fix`, 35 `docs`, 27 `refactor`, 16 `chore`,
  11 `test`, 5 `release`, 4 `ci`, 2 `perf`, 1 `style`.[^src-lazyclaw-codebase-2026-06]
- **Hottest scopes:** `tui` (46), `cli` (24), `mas` (16), `providers` (15),
  `slash` (15), `tools` (12), `gateway` (10), `channels` (10), `splash` (8),
  `setup` (8), `dashboard` (8), `security` (7), `sandbox` (6).[^src-lazyclaw-codebase-2026-06]
- The work is overwhelmingly **TUI/CLI ergonomics + the multi-agent system (mas)
  + the provider/channel/gateway plumbing** — feat-heavy, with a sizeable fix and
  refactor tail.[^src-lazyclaw-codebase-2026-06]

## Release timeline

| Version | Date | Theme |
|---|---|---|
| 3.99.29 | 2026-05-18 | standalone-repo import baseline[^src-lazyclaw-codebase-2026-06] |
| 4.0.0 | 2026-05-18 | `/loop` & `/goal` slash commands (Phases 1–8)[^src-lazyclaw-codebase-2026-06] |
| 4.1.0 | 2026-05-19 | multi-agent Slack teams (Phases 9–16)[^src-lazyclaw-codebase-2026-06] |
| 4.2.0 | 2026-05-19 | per-agent memory + auto reflection (Phase 18)[^src-lazyclaw-codebase-2026-06] |
| 4.2.1 / 4.2.2 | 2026-05-23/24 | figlet banner restoration[^src-lazyclaw-codebase-2026-06] |
| 4.3.0 | 2026-06-01 | SSE exec-approval, multichannel inbound, device gateway, Telegram bridge, Ed25519 device-auth, skill curator[^src-lazyclaw-codebase-2026-06] |
| **5.0.0** | 2026-06-05 | **Hermes-parity rewrite — phases A–H**[^src-lazyclaw-codebase-2026-06] |
| 5.1–5.4.x | 2026-06-05/06 | splash tiers, learning-loop close, prompt caching, Ink alt-buffer fullscreen, CJK/IME fixes, modal slash pickers[^src-lazyclaw-codebase-2026-06] |
| 6.0.0 | 2026-06-08 | cross-channel handoff through daemon; module-architecture refactor[^src-lazyclaw-codebase-2026-06] |
| 6.1.0 | 2026-06-10 | gateway hardening (auth-by-default, idempotency, resilient reconnect)[^src-lazyclaw-codebase-2026-06] |
| 6.2.0 / 6.3.0 / 6.3.1 | 2026-06-10 | live model lists, `/setup` vs `/config` split, legacy-boot crash fix[^src-lazyclaw-codebase-2026-06] |

## v5.0 — the Hermes-parity rewrite (phases A–H)

The largest single effort. On 2026-06-04/05 the project rebuilt around eight
phases:[^src-lazyclaw-codebase-2026-06]

- **Phase A — foundation:** TrajectoryRecord JSONL store, SQLite + FTS5 index store, FTS5 write-through hooks, `resolveTrainer()`, v4→v5 baseline migration.
- **Phase B — learning core:** skill_synth v2 (frontmatter + anti-pattern outcome switch), user_modeler (USER.md updater), recall, nudge ticker, confidence calculator (Wilson + cross-CLI dampen).
- **Phase D — sandbox:** 6-backend abstraction (local + pluggable OS confiners, docker, ssh, singularity, modal, daytona) + CLI.
- **Phase E — tools + MCP:** registry + ~45 tools across 12 categories, sensitive-driven `tool_runner`, stdio MCP client + `server_spawn` driver, named toolsets.
- **Phase F — channels:** plugin loader + 5 channel skeletons (discord/email/signal/voice/whatsapp) + `/handoff` + threads.jsonl cross-channel session map.
- **Phase C — UX:** Ink splash, ghost autocomplete, multiline editor, interrupt-and-redirect REPL.
- **Phase G — persona + migration:** 8-layer prompt compose stack + hermes/openclaw import.
- **Phase H — perf + migration:** trajectory exporter (atropos/axolotl/openai-ft), perf benchmarks, E2E matrix, migration guide + cookbooks.

## Recent thematic batches (post-6.3.1, mostly Unreleased)

- **Security pass** (2026-06-07): fail-closed sensitive-tool approval + default approve hooks, secret scrubbing in the bash child env, SSRF close in browser/`web_fetch`, owner-only (0600) config/state writes, landlock/seatbelt confiner honesty, export/import secret redaction.[^src-lazyclaw-codebase-2026-06]
- **CLI module refactor** (2026-06-07/08): `cli.mjs` split into `commands/*.mjs` (channels, automation, sessions, agents, providers, skills, workflow, daemon, …); daemon `makeHandler` switch split into route modules; a CI file-size gate locks the architecture.[^src-lazyclaw-codebase-2026-06]
- **MAS revival** (2026-06-13): revive dead tools, learning triggers, recall write-through, sandboxed exec.[^src-lazyclaw-codebase-2026-06]
- **Unified model picker + slash-arg completion** (2026-06-15): one canonical `pickProviderModel` everywhere (`/model`, `/trainer set|fallback`, `/agent edit`, `/orchestrator` planner/worker, `/provider` chain); the parallel `pickModelForProvider` removed; inline slash-argument autocomplete for every arg-taking command.[^src-lazyclaw-codebase-2026-06]
- **UX-audit batches** (2026-06-13 → 2026-06-16): NO_COLOR gate, agentic chat REPL + plan mode, claude-hud status bar, no-arg action menus, destructive confirms, readable `show` output, guided creation/install, channel credential verification (`channels test`), chat key preflight, setup `--only`/`--skip`.[^src-lazyclaw-codebase-2026-06]
- **Setup wizard pickers** (2026-06-16, HEAD): the channel step and all remaining wizard prompts become arrow-key picks; pickers render on the alternate screen buffer (no scrollback push); stdin is released after a picker so `lazyclaw setup` exits instead of hanging.[^src-lazyclaw-codebase-2026-06]

## Working-tree change at snapshot (uncommitted, 2026-06-18)

`mas/index_db.mjs` (+33 −3) — an **FTS dead-sentinel**. When the native
`better-sqlite3` binding fails to load (the classic `NODE_MODULE_VERSION`
mismatch after a Node upgrade) or the db file is unopenable, `_handle()` caches a
`{ db: null, dead: true }` sentinel instead of re-attempting `new Database` on
every index read/write. It warns **once** per configDir (with the fix: `npm
rebuild better-sqlite3`), then degrades FTS to a no-op: index writes return early,
`recall()` returns empty, the integrity-check pragma returns `{ ok: false }`. The
JSONL corpus stays intact and `lazyclaw index rebuild` repopulates once the binary
is fixed. Motivation: the prior retry storm spammed the chat with one warning per
turn and added hot-path latency.[^src-lazyclaw-codebase-2026-06]

[^src-lazyclaw-codebase-2026-06]: [[source-lazyclaw-codebase-2026-06]]

