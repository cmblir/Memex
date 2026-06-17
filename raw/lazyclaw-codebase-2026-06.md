# lazyclaw — codebase & commit-history snapshot (2026-06-18)

Source material captured from the `lazyclaw` git repository at `/Users/o/lazyclaw`
(branch `main`) and its `README.md` / `CHANGELOG.md`. This is an immutable
snapshot for the wiki; the live repo continues to evolve.

## Project identity (from README.md)

- **Tagline:** "A terminal agent that learns on your Claude subscription — for $0 — and reaches you on every channel."
- A single-binary-feel **Node CLI** (Node 18+; Node 22+ for Slack Socket Mode) in the **"claw" family**: lineage **Hermes → OpenClaw → nanoclaw**.
- **TUI-first:** `lazyclaw` with no args opens an Ink chat REPL (sloth splash, slash commands, ghost-text autocomplete). Distributed on npm as `lazyclaw`; `npx lazyclaw` runs first-run setup then drops into chat. License MIT. Repo: `cmblir/lazyclaw`.
- **No hosted service / no telemetry.** Config in plain JSON at `~/.lazyclaw/config.json`; secrets in `~/.lazyclaw/.env` (0600, never logged). Move dir with `LAZYCLAW_CONFIG_DIR`.

### $0 self-learning (the headline feature)
- Two independent provider slots: **`provider`** (chat hot path) and **`trainer`** (learning loop — skill synthesis, reflection, user model).
- A Claude Pro/Max subscription via `claude-cli` can power the learning loop for free while chat runs on any backend. `trainer: { provider: "auto" }` auto-detects the `claude-cli` session.
- After every turn a fire-and-forget loop records the trajectory and distils reusable skills tagged `trained_by`.
- Cost matrix: subscription-only (`claude-cli` + `auto`) = $0; hybrid (`openai` chat + `auto` trainer) = chat only; pure API = both metered.

### Channels (talk to it anywhere)
- Same agent answers on every channel; listeners forward into an always-on daemon's shared session store (one agent, one memory, context follows across channels).
- Built in: **Slack, Telegram, Matrix, HTTP**. Plugins (`@lazyclaw/channel-*`): **Discord, Email, Signal, Voice, WhatsApp**.
- A listener is a thin forwarder owning the channel socket (Slack Socket Mode needs only an `xapp-` token, no public URL) → POSTs to daemon `/inbound`.
- Inbound messages are **idempotent** (dedup by native id: Slack `channel:ts`, Telegram `chat:message_id`, Matrix `event_id`).

### Always-on / gateway
- `lazyclaw gateway` runs the daemon core **and** configured channel transports in one process; in-process channels let `/handoff` notify the target channel with a resume marker (failed notify rolls the handoff back).
- Gateway is **authenticated by default**: mints a bearer token to `~/.lazyclaw/gateway.token` (0600).
- `lazyclaw service install [gateway]` → launchd (macOS) / systemd user unit (Linux) / pidfile fallback (auto-detected).
- Safety: a listener/daemon **refuses to start** while `security.allowUnattendedSensitive=true` (always-on + that flag = RCE path).

### Multi-agent orchestration
- Set provider to `orchestrator` → hard request becomes **Plan → Delegate → Synthesise**: a planner decomposes, workers run subtasks in parallel, planner merges. Workers are real agents with the tool registry.

### Providers
- `claude-cli` (subscription, keyless); `anthropic`/`openai`/`gemini` (API key); `ollama` (local); OpenAI-compatible: `nim`/`openrouter`/`groq`/`together`/`xai`/`deepseek`/`mistral`/`fireworks`; `custom` (any OpenAI-compat v1 endpoint); `orchestrator` (meta-provider). Also keyless CLI providers `codex-cli` / `gemini-cli`.

### What else it ships
- **Tool registry** — 12 categories (`agents`, `browser`, `coding`, `exec`, `fs`, `git`, `iot`, `learning`, `media`, `net`, `os`, `scheduling`) plus stdio MCP. Sensitive tools (shell/write/network) **fail-closed** behind an approval hook by default.
- **Skills** — markdown instruction bundles composed into the system prompt. Starter pack (`concise`, `korean`, `commit-message`, `code-review`, `channel-style`, `summarize`, `explain`, `debug-coach`) via `lazyclaw skills starter`; install more from GitHub.
- **Durable recall** — one SQLite + FTS5 index over sessions/skills/trajectories/memory; rebuildable from the corpus (`lazyclaw index rebuild`).
- **Loops & goals** — durable foreground/`--detach` loops and cron-scheduled goals that survive restart.
- **Personas** — layered SOUL / workspace / personality / role / user-model / skills (8-layer prompt stack).
- **Sandboxes** — `local` / `docker` / `ssh` / `singularity` / `modal` / `daytona` behind one API; `bash` tool runs inside the configured sandbox.
- **MCP** — stdio MCP servers in `cfg.mcp.servers` boot with the daemon; tools register as `mcp:<server>:<tool>` (always approval-gated).
- **Dashboard** — framework-free SPA over the daemon JSON API, 17 tabs, dark amber theme.

## Repository commit statistics

- **Total commits:** 323. **Date range:** 2026-05-18 → 2026-06-16.
- First commit: `bda076d` (2026-05-18) "chore: import lazyclaw as a standalone repository".
- HEAD: `46ff8b1` (2026-06-16) "fix(tui): release stdin after a picker so `lazyclaw setup` exits instead of hanging".

### Commit type counts
```
141 feat
 79 fix
 35 docs
 27 refactor
 16 chore
 11 test
  5 release
  4 ci
  2 perf
  1 style
```

### Top commit scopes
```
46 tui      24 cli       19 changelog  16 mas       15 slash
15 providers 12 tools    10 gateway    10 channels   8 splash
 8 setup     8 release    8 dashboard   7 security    6 sandbox
 4 readme    4 migrate    3 phaseH      3 models      3 loop
 3 editor    3 daemon     2 spec        2 skills      2 repl
```

### Release tags (chronological)
- 3.99.29 (2026-05-18, repo import baseline)
- 4.0.0 (2026-05-18) — /loop and /goal slash commands (Phases 1–8)
- 4.1.0 (2026-05-19) — multi-agent Slack teams (Phases 9–16)
- 4.2.0 (2026-05-19) — per-agent memory + auto reflection (Phase 18)
- 4.2.1 / 4.2.2 (2026-05-23/24) — figlet banner restoration
- 4.3.0 (2026-06-01) — SSE exec-approval, multichannel inbound, device gateway, Telegram bridge, Ed25519 device-auth, skill curator
- 5.0.0 (2026-06-05) — v5 Hermes-parity rewrite (Phases A–H: foundation, learning-core, sandbox, tools+MCP, channels, persona, ux, perf/migration)
- 5.1.0 / 5.2 / 5.3.x / 5.4.x (2026-06-05/06) — splash tiers, learning-loop close, Anthropic prompt caching, Ink alt-buffer fullscreen, CJK/IME editor fixes, modal slash pickers
- 6.0.0 (2026-06-08) — cross-channel handoff through daemon; module-architecture refactor (cli.mjs → commands/*, daemon route modules)
- 6.1.0 (2026-06-10) — gateway hardening (auth-by-default, idempotency, resilient reconnect)
- 6.2.0 / 6.3.0 / 6.3.1 (2026-06-10) — live model lists, /setup vs /config split, legacy-boot crash fix

### Recent thematic batches (post-6.3.1, mostly Unreleased)
- **v5.0 design/plan docs** (2026-06-04): Hermes-parity spec + phase A–H implementation plans.
- **Security pass** (2026-06-07): fail-closed sensitive-tool approval, secret scrubbing in bash child env, SSRF close in browser/web_fetch, owner-only (0600) config/state writes, landlock/seatbelt confiner honesty, export/import secret redaction.
- **MAS revival** (2026-06-13): revive dead tools, learning triggers, recall write-through, sandboxed exec.
- **Unified model picker + slash-arg completion** (2026-06-15): one canonical `pickProviderModel` everywhere (`/model`, `/trainer set|fallback`, `/agent edit`, `/orchestrator` planner/worker, `/provider` chain); the parallel `pickModelForProvider` removed; inline slash-argument autocomplete for every arg-taking command.
- **UX-audit batches** (2026-06-13 → 2026-06-16): NO_COLOR gate, agentic chat REPL + plan mode, claude-hud status bar, no-arg action menus, destructive confirms, readable `show` output, guided creation/install, channel credential verification (`channels test`), key preflight, setup `--only`/`--skip`.
- **Setup wizard pickers** (2026-06-16): channel step + all remaining wizard prompts become arrow-key picks; pickers render on the alternate screen buffer (no scrollback push); stdin released after a picker so `lazyclaw setup` exits.

## Uncommitted working-tree change (2026-06-18)

`mas/index_db.mjs` (+33 −3, not yet committed): **FTS dead-sentinel** for the
recall index. When the native `better-sqlite3` binding fails to load (classic
`NODE_MODULE_VERSION` mismatch after a Node upgrade) or the db file is
unopenable, `_handle()` now caches a `{ db: null, dead: true }` sentinel instead
of re-attempting `new Database` on every index read/write. It warns **once** per
configDir (with the exact fix: `npm rebuild better-sqlite3` on a version
mismatch), then degrades FTS to a no-op for the rest of the process: writes
(`indexSessionTurn`/`indexSkill`/`indexTrajectory`/`indexMemory`/`deleteSkill`)
return early when `_stmts()` is null; `recall()` returns `{ hits: [], latencyMs: 0 }`;
the integrity-check pragma returns `{ ok: false }`. The JSONL corpus stays intact
and `lazyclaw index rebuild` repopulates once the binary is fixed. Motivation:
the prior retry storm spammed the chat with one warning per turn and added hot-path latency.

## Full commit log (oneline, newest first)

```
46ff8b1 2026-06-16 fix(tui): release stdin after a picker so `lazyclaw setup` exits instead of hanging
ad5f2c3 2026-06-16 docs(changelog): pickable wizard prompts + alt-screen fix
15eb4d3 2026-06-16 feat(setup): make the remaining wizard prompts pickable (no more typing y/n/numbers)
2d94a51 2026-06-16 fix(tui): render _arrowMenu on the alternate screen buffer (stop scrollback push)
2e58173 2026-06-16 docs(changelog): setup wizard channel picker
1f521ed 2026-06-16 feat(setup): pick the channel from an arrow-key list + configure several in one pass
32838d7 2026-06-15 fix(daemon): per-provider timeout on GET /providers/test so one hang can't stall all
fc4d759 2026-06-15 fix(mas,dashboard): add resumable 'paused' task status; fix phase13/14/15
991a38d 2026-06-15 test(phase6): fix two stale daemon/cli assertions (production is correct)
f4c9e7c 2026-06-15 test(providers): update providers info defaultModel assertion to claude-opus-4-8
bc7c118 2026-06-15 docs(changelog): final UX batch — personality install, picker routing, setup gating, key preflight
97dc3ec 2026-06-15 feat(tui,setup): final UX-audit batch — guided install, picker routing, setup gating, key preflight
fdc5830 2026-06-15 docs(changelog): guided create, channel verify, /menu in-chat
95bb2f2 2026-06-15 feat(channels): verify credentials with `channels test` / `/channels <name> test`
010f9bb 2026-06-15 feat(tui): guided interactive create + menu/alias ergonomics
d40daad 2026-06-15 docs(changelog): UX batch — no-arg menus, confirms, readable show, error hints
2235f48 2026-06-15 feat(tui): UX batch — no-arg menus, destructive confirms, readable show, error hints
3c0d105 2026-06-15 docs(changelog): channels setup, masked secrets, help-text fixes
4ce81fe 2026-06-15 docs(tui): fix stale slash help text to match handlers
160b0ec 2026-06-15 fix(security): mask secret entry in the setup/channel readline path
8f85b4e 2026-06-15 feat(tui): set channel credentials from /channels (no /config detour)
071a64e 2026-06-15 docs(changelog): handoff/dashboard/goal arg completion + config note
12eb8b8 2026-06-15 fix(tui): complete arg-autocomplete coverage from a handler audit
51fd453 2026-06-15 docs: inline slash-argument autocomplete (readme, changelog)
22cf8c3 2026-06-15 feat(tui): inline argument autocomplete for all arg-taking commands
52f570c 2026-06-15 docs(changelog): bare /trainer action menu
c744ed0 2026-06-15 fix(tui): bare /trainer opens an action menu (not just status)
569e062 2026-06-15 docs(changelog): note /model + /provider persistence fix
689ece3 2026-06-15 fix(chat): persist /model and /provider picks across sessions
b6e1be5 2026-06-15 docs(changelog): note claude-fable-5 removal from suggested models
e3566b0 2026-06-15 fix(providers): drop claude-fable-5 from suggested model lists
f0ae713 2026-06-15 refactor(tui): drop now-dead aliased picker imports after migration
418cf46 2026-06-15 docs: model picker unification + slash-arg completion (changelog, readme)
7f7a561 2026-06-15 feat(tui): wire slash-arg completion end-to-end (Tab opens modal, fills value)
d44cd4c 2026-06-15 feat(tui): Editor Tab opens arg completion + injects the picked value
1b5edaa 2026-06-15 feat(tui): slash-argument completion registry (argSpecFor + ARG_COMPLETERS)
1293460 2026-06-15 feat(tui): add fillArgToken editor primitive for arg completion
fa57f9e 2026-06-15 feat(tui): /agent edit picks provider+model via the shared picker
e5635a7 2026-06-15 refactor(tui): orchestrator + /provider chain use the canonical picker
ce1a843 2026-06-15 feat(tui): /trainer set|fallback open the shared model picker
3224543 2026-06-15 refactor(tui): /model uses the shared pickProviderModel
c290e7f 2026-06-15 refactor(tui): hoist canonical model picker into tui/model_pick.mjs
8288813 2026-06-15 fix(config): recognize trainer/orchestrator/persona/customProviders/chat keys
0d66da1 2026-06-15 fix(providers): bump stale default models to current Opus/Gemini
ccbcfb7 2026-06-15 docs(plan): unified model picker + slash-arg completion implementation plan
979d408 2026-06-15 docs(spec): unified model picker + slash-arg completion design
4c2150e 2026-06-13 feat(tui): NO_COLOR gate, provider-adaptive splash tip, /new clears screen
bbd967a 2026-06-13 feat(tui): wire Ink approval hook + slash "did you mean"
f7b340c 2026-06-13 docs(changelog): D/E tier — input UX, retry, config, cli ergonomics
38b7309 2026-06-13 fix(reliability,cli): chat transient-retry, fail-loud config, did-you-mean
2af5b1a 2026-06-13 feat(tui): Ink input UX, key masking, context-gauge percentage
e61c73e 2026-06-13 docs: changelog, README, agentic-REPL design spec
1290ae5 2026-06-13 fix(dashboard,channels): workflow detail + auth-token support, plugin channel loading
f9faa1e 2026-06-13 feat(daemon,cli,mcp): daemon lifecycle, index rebuild, MCP boot
9b83d8d 2026-06-13 feat(tui): agentic chat REPL + plan mode
ee0823b 2026-06-13 fix(mas): revive dead tools, learning triggers, recall write-through, sandboxed exec
49d6db9 2026-06-13 fix(providers): honor suggested models, reasoning-model tokens, idle timeout
f53fc0f 2026-06-13 fix(security): redact all secrets in export, strip placeholder on import
954486a 2026-06-13 feat(skills): bundled starter pack + `skills starter`
7b5b71b 2026-06-12 feat(tui): fetch+pick editing for orchestrator planner/workers and provider model
4a0dead 2026-06-12 feat(tui): claude-hud-style status bar, toggleable via /config and /hud
9c1bd74 2026-06-12 fix(dashboard): absolute asset paths so the page isn't unstyled at /dashboard/
42137f5 2026-06-12 fix(models): codex-cli/gemini-cli model fetch falls back to local config
1a96070 2026-06-12 fix(tui): context gauge tracks chat history, not provider self-reported usage
263be4c 2026-06-12 feat(tui): inline connect/login for codex-cli & gemini-cli
aa72b9b 2026-06-12 fix(providers): stop forcing rejected default model on codex-cli/gemini-cli
bfd750a 2026-06-10 release: 6.3.1
58f7ea1 2026-06-10 fix(tui): legacy-path boot crash + retire the v4 figlet banner
9f3d954 2026-06-10 release: 6.3.0
1d9018b 2026-06-10 feat(tui): /setup = full wizard, /config = single-setting editor
ace0d59 2026-06-10 feat(tui): always-visible caret in the input box
3de462e 2026-06-10 release: 6.2.0
0084989 2026-06-10 fix(providers): async spawn-ENOENT crash in gemini-cli/codex-cli (CI red)
3003de0 2026-06-10 feat(models): live model lists for claude-cli / gemini-cli / codex-cli
876b338 2026-06-10 feat(providers): register gemini-cli/codex-cli + pickable orchestrator family
854421e 2026-06-10 feat(models): live model lists for anthropic/gemini + current Claude lineup
eae6919 2026-06-10 release: 6.1.0
0b7d3cb 2026-06-10 fix(channels): surface telegram/matrix poll-loop death (onDead)
cffc86b 2026-06-10 docs(changelog): record the gateway hardening pass
1eda5c4 2026-06-10 fix(gateway): auth by default, prompt shutdown, resilient slack reconnect
2ce460a 2026-06-10 fix(gateway): conversation-scoped idempotency + bounded learning (review)
4c8afd6 2026-06-10 test(dashboard): expect relative asset refs in the shell
d7aaa58 2026-06-10 feat(gateway): single-process gateway + live handoff notify (approach B)
6f7fc37 2026-06-10 feat(gateway): /inbound idempotency + post-task learning on channel turns
cfad6c7 2026-06-10 fix(gateway): default service daemon to port 19600 + honest fallback liveness check
71698f6 2026-06-10 feat(gateway): Slack sender-id pairing parity
0713fbf 2026-06-10 feat(gateway): bridge channel listeners through the daemon (single agent)
94616a3 2026-06-09 feat(gateway): always-on service install (launchd/systemd/fallback)
f2a8bce 2026-06-09 feat(gateway): fail-closed boot guards + crash handlers for always-on surfaces
67cd309 2026-06-09 chore: drop the dead build-splash script
0c1e6c8 2026-06-09 chore(assets): remove the placeholder sloth source PNG
dae4eb1 2026-06-09 docs(readme): drop the broken corner sloth image (was a black-circle placeholder)
a2dfbc4 2026-06-09 Update README.md
d1df4a5 2026-06-09 docs(readme): rewrite in the Hermes/nanoclaw style with a real usage shot
e18ebab 2026-06-09 fix(tui): slash commands with args submit the full line, not the bare command
8b534e9 2026-06-09 feat(orchestrator): bare /orchestrator opens an on/off picker
bf57d77 2026-06-09 fix(tui): backspace no longer erases the scrollback above the input
ed2e749 2026-06-09 fix(tui): show the input cursor + keep IME pre-edit in the box (non-alt layout)
7f11069 2026-06-09 feat(context): /context slash + setup step + status-bar fix; orchestrator on/off CLI
d317e01 2026-06-09 fix(tui): stream completed lines to scrollback so long replies don't spill below the input
331487a 2026-06-09 feat(setup): pick orchestration planner/workers from the searchable provider list
1890204 2026-06-09 feat(setup): Slack inbound app-token + orchestration setup step + /orchestrator
978bd98 2026-06-09 feat(channels): view + edit channel settings via CLI and /channels slash
64c439f 2026-06-09 fix(setup): verify step no longer exits the wizard; accent now amber
14f0831 2026-06-09 feat(setup): render the real splash in setup + add /config to re-enter it
f5b535c 2026-06-09 fix(setup): treat blank/mock provider as not-yet-configured for first run
158f540 2026-06-09 feat(setup): Hermes-style phased first-run setup with a channel step
f5bc800 2026-06-09 feat(config): add writeDotenvMerge + export daemon KNOWN_CHANNELS
94e85e7 2026-06-08 fix(dashboard): use relative asset paths so it renders outside the host root
de1a93d 2026-06-08 style(dashboard): drop header mascot, switch accent to terminal amber
77cc71d 2026-06-08 fix(tui): keep assistant replies in the Ink REPL scrollback
2461eba 2026-06-08 fix(pkg): ship lib/commands/daemon + add pack-completeness gate (v6.0.1)
f1d1251 2026-06-08 chore(release): v6.0.0
02219fa 2026-06-08 feat(handoff): wire cross-channel context handoff through the daemon (F5/F6)
49699ad 2026-06-08 fix(repl): surface the actual error in the chat transcript (F3)
25df0c4 2026-06-08 ci(lint): add file-size gate to lock module architecture (D8)
7f85fad 2026-06-08 refactor(cli): extract cmdChat + setup hub to commands/{chat,setup}.mjs (D7)
df86a40 2026-06-08 perf(router): reuse one Slack client across a task run (E3)
78b08ff 2026-06-08 perf(orchestrator): bound parallel subtask dispatch by concurrency (E1)
70f6f5a 2026-06-08 ci(playwright): promote acceptance suite to a hard gate (F8)
b9050be 2026-06-08 fix(providers): handle async spawn ENOENT in claude-cli probe (F8)
f12b276 2026-06-08 fix(dashboard): make nav/banner responsive + add keyboard a11y
09d6b46 2026-06-08 refactor(dashboard): remove no-op trainer "Sync now" button + dead route
87209f8 2026-06-08 refactor(dashboard): split monolithic dashboard.html into html/css/js
7d73b76 2026-06-08 docs(ci): mark node-20 chat bug resolved; correct playwright gate rationale
b479886 2026-06-08 fix(cli): create chat readline interface adjacent to its loop (D7)
9ca69b4 2026-06-08 refactor(cli): unify slash catalog, drop stale cli.mjs copy (D6)
34e8005 2026-06-08 refactor(daemon): split makeHandler switch into route modules + table (D5)
a4347bc 2026-06-08 refactor(daemon): extract http/cost/auth/provider helpers to daemon/lib (D5)
076dd12 2026-06-07 fix(cli): correct loop-worker path after automation extraction
e753e59 2026-06-07 refactor(cli): extract providers/rates/orchestrator to commands/providers.mjs
cb150e1 2026-06-07 refactor(tui): move readline pickers/banner to tui/pickers.mjs (D4)
300200d 2026-06-07 refactor(cli): extract config/doctor/status/version commands to commands/config.mjs
2a1f279 2026-06-07 refactor(cli): extract agent/task/team/registry to commands/agents.mjs
04cd956 2026-06-07 refactor(cli): extract browse/sandbox commands to commands/misc.mjs
c8ca50d 2026-06-07 refactor(cli): extract sessions/export/import/memory to commands/sessions.mjs
f177736 2026-06-07 refactor(cli): extract cron/loop/goal commands to commands/automation.mjs
1c449b5 2026-06-07 refactor(cli): extract slack/telegram/matrix to commands/channels.mjs
89528d4 2026-06-07 refactor(cli): extract auth/pairing/nodes/message/workspace to commands/auth_nodes.mjs
727e2fa 2026-06-07 refactor(cli): extract daemon/dashboard commands to commands/daemon.mjs
3842bcd 2026-06-07 refactor(cli): extract skill commands to commands/skills.mjs
dcc0890 2026-06-07 refactor(cli): extract workflow commands to commands/workflow.mjs
938bae1 2026-06-07 refactor(cli): extract config/args/registry-boot helpers to lib/
93853ab 2026-06-07 refactor(providers): break the registry↔orchestrator static import cycle
b044483 2026-06-07 fix(providers): enforce cost on the subscription path via reported total_cost_usd
c2ce7be 2026-06-07 fix(perf): durable, dedup'd, faster recall index
d14d45e 2026-06-07 fix(correctness): guard state parses, loop-worker write race, /chat abort
a362613 2026-06-07 feat(providers): OpenAI-compat providers can be agents and trainers
e98b889 2026-06-07 feat(providers): real claude-cli session detection for the $0 trainer
6c8c464 2026-06-07 docs(known-issues): note flaky network/timing spawn specs (non-blocking)
c555bad 2026-06-07 test: auto-approve sensitive tools in tool-use adapter specs
d786acf 2026-06-07 fix(security): confiner honesty — landlock fail-closed, seatbelt SBPL escaping
79ce026 2026-06-07 fix(security): write config and workflow state owner-only (0600)
fd1d5ee 2026-06-07 fix(security): close SSRF in browser tool + revalidate web_fetch redirects
2f1eb1f 2026-06-07 fix(security): scrub secrets from the bash child environment
3cbf009 2026-06-07 fix(security): fail-closed approval for sensitive tools + default approve hooks
11f070b 2026-06-07 ci: split gate into hard node job + non-blocking playwright
83a9777 2026-06-07 docs(changelog): record skill-store unify + full test gate
dd9a998 2026-06-07 test: widen gate to full suite + fix stale resume assertion; add CI
0dde9aa 2026-06-07 fix(skills): unify agent skill tools onto the canonical flat store
141f740 2026-06-06 docs(changelog): record flicker default, first-run funnel, /task start+tick
69fdcaa 2026-06-06 feat(slash): /task start + /task tick run in the Ink chat
59512af 2026-06-06 feat(cli): first run gets the full guided setup, not just a provider pick
86ee9af 2026-06-06 fix(tui): default to the no-flicker Static scrollback
3c17efb 2026-06-06 docs(changelog): record /dashboard port, /task slack close, /menu palette
a4d8820 2026-06-06 feat(slash): /menu command palette for the full subcommand catalog
e07997a 2026-06-06 feat(slash): /task done|abandon posts the Slack closing message
95abe14 2026-06-06 fix(slash): /dashboard opens the actually-bound port
30c44f2 2026-06-06 docs(changelog): record rendering fixes + /model switch + /skills picker
e024fa9 2026-06-06 feat(slash): reach any provider's models from /model + a real /skills picker
1fb26b0 2026-06-06 fix(tui): stop typing flicker + keep the splash from vanishing
977dbf5 2026-06-06 docs(changelog): record P3 StatusBar live-refresh + /loop Esc-abort
abf6caa 2026-06-06 feat(slash): Esc aborts a running /loop in the Ink chat
e075ff6 2026-06-06 fix(tui): live StatusBar — refresh provider/model after a slash switch
2ca2a3c 2026-06-06 docs(changelog): record P3 /trainer fallback, /loop memory, /goal cron
9fd72ee 2026-06-06 feat(slash): /goal add --cron actually schedules; /goal close detaches
a453c03 2026-06-06 fix(slash): honor /loop --use-memory / --recall in the Ink path
d242e4f 2026-06-06 feat(slash): /trainer fallback routing knob
6358db1 2026-06-06 docs(changelog): record P1+P2 /model + /provider restoration (Unreleased)
66d3b14 2026-06-06 feat(slash): prompt for an api key when /provider picks a keyless built-in
cd6ab12 2026-06-06 feat(slash): register custom OpenAI-compat endpoints from the Ink /provider
09c468f 2026-06-06 feat(slash): restore family drill-in + tags for the Ink /provider picker
9b1bc54 2026-06-06 fix(slash): restore /model depth — live-fetch, custom id, orchestrator escape
1bf80bf 2026-06-06 feat(tui): modal picker pinned rows + free-text resolution
59168d9 2026-06-06 refactor(providers): extract shared model-catalogue resolver
676941a 2026-06-06 chore: bump 5.4.4 — /dashboard spawn-loop fix, flicker fix, UX polish
7ef30fa 2026-06-06 fix(editor): eliminate render flicker from the v5.4.3 IME cursor anchor
59312b9 2026-06-06 fix(slash): root-cause /dashboard spawn pile-up + Hermes-style /status /usage /memory output
82f87bf 2026-06-06 chore: bump 5.4.3 — splash + slash + IME fixes
f343888 2026-06-06 feat(slash): Ink modal picker for /provider /model /personality, plus /dashboard /task /trainer /clear
16a541a 2026-06-06 fix(splash): drop baked status row + hide splash from scrollback after first turn
9cb1a84 2026-06-06 chore: bump 5.4.2 — alt-buffer splash visibility + editor IME char-drop fixes
ef1602e 2026-06-06 fix(editor): mirror state to a ref so rapid IME commits don't drop chars
0826c32 2026-06-06 fix(repl): render alt-buffer scrollback as flex children, not <Static/>
bec0257 2026-06-06 test(v54): update altbuffer contract for v5.4.1 (splash inside alt, not pre-printed)
78cb805 2026-06-06 fix(v5.4.1): render splash inside alt-buffer, not pre-printed to primary
3e1dbd6 2026-06-06 feat(v5.4): alt-buffer fullscreen Ink + all 24 slash commands wired
373472d 2026-06-06 fix(editor): pre-wrap CJK buffer to explicit cell budget — real v5.3.3 CJK fix
8e5f034 2026-06-05 chore: bump 5.3.2 (v5.3.2 patch — fixes already at bbc9ffc)
bbc9ffc 2026-06-05 fix(v5.3.2): CJK editor width + single-model default + true single-shot orchestrator fallback
037e8d2 2026-06-05 fix(v5.3.1): /exit hang, editor key blocking, narrow splash color
9573c2c 2026-06-05 release(v5.3.0): narrow-tier splash, sticky-bottom REPL, slash popup
ff4768b 2026-06-05 feat(v5.2): close learning loop, enable Anthropic prompt caching, fix 26 audit findings
60811b2 2026-06-05 fix(dashboard): escape recall snippet HTML, preserve FTS5 mark highlight
ea2d741 2026-06-05 feat(v5.1): responsive splash tiers + dashboard v5 + README rewrite
d5ebd8a 2026-06-05 feat(splash): gradient wordmark + subcommands section + bottom status bar
af34d2d 2026-06-05 feat(splash): replace wordmark with operator-supplied 13x120 Larry 3D LAZYCLAW
d853fc8 2026-06-05 fix(splash): populate tools and skills from registry + skills dir
e5c8714 2026-06-05 feat(splash): Hermes-style panel + lazyclaw no-arg drops to chat
07e7a7b 2026-06-05 fix(splash): operator-curated 48x35 sloth — no more inverted silhouette
2e99911 2026-06-05 feat(splash): hi-res chafa braille sloth hero, shared by launcher + chat
d286a87 2026-06-05 feat(splash): hand-drawn sloth + ANSI Shadow wordmark
6eb248a 2026-06-05 fix(package): include tui/ and mcp/ in npm tarball
7f6e0d1 2026-06-05 fix(launcher): use v5 sloth banner in no-arg launcher (chat splash parity)
42816c4 2026-06-05 ci(publish): diff against npm registry, add workflow_dispatch trigger
b081bdc 2026-06-05 docs(readme): redesign for v5.0 — lead with trainer-split + FTS5 recall + channel handoff
bb087f5 2026-06-05 Merge remote-tracking branch 'origin/main'
668ff50 2026-06-05 feat(providers): scaffold codex-cli + gemini-cli stubs (v5.1 pending wire-up)
f1f36a9 2026-06-05 test(perf): stabilize 10k recall via median-of-5 sampling
ed66d97 2026-06-05 chore(release): 5.0.0
a626871 2026-06-05 test(phaseH): perf benchmarks — index_store + cold-start + idle RSS
0f2d90b 2026-06-05 test(phaseH): E2E matrix — 12 flows x 2 providers x 2 channels
e378307 2026-06-05 docs(phaseH): v5.0 migration guide, persona cookbook, trainer recipes, KO README
3fed4a7 2026-06-05 feat(confidence): tunable cross-CLI dampen factor (spec H2)
cea20b4 2026-06-05 feat(trajectories): JSONL → atropos/axolotl/openai-ft exporter
3b871ac 2026-06-05 feat: v5 Phase C ux-upgrade (ink splash + ghost autocomplete + multiline editor + REPL)
bd35041 2026-06-05 feat: v5 Phase G persona + migration (8-layer prompt stack + hermes/openclaw import)
68b8d46 2026-06-05 feat: v5 Phase F channels (plugin loader + 5 channel skeletons + /handoff)
e8f8642 2026-06-05 fix(recall): unify Phase B FTS5 impl with Phase E tool wrapper interface
27e2357 2026-06-05 feat: v5 Phase E tools+MCP (registry + 45 tools + stdio MCP client)
4fad8c5 2026-06-05 feat: v5 Phase D sandbox (6-backend abstraction + cli)
ddf1d75 2026-06-05 feat: v5 Phase B learning-core (skill_synth v2 + user_modeler + recall + nudge + confidence)
a89690f 2026-06-05 fix(sandbox): SandboxError.toString includes code
5c223f5 2026-06-05 fix(tui): widen toolRow label column for sensitive prefix
86544cf 2026-06-04 test(phase-e): acceptance sweep — 45+ tools, MCP spawn, approve gate
e48beed 2026-06-04 feat(mcp): stdio client + server_spawn driver
dae1240 2026-06-04 feat(toolsets): named tool bundles with add/list/remove
f304d66 2026-06-04 feat(migrate): lazyclaw openclaw import
35e7967 2026-06-04 feat(tools): clarify + browser groups
3d03410 2026-06-04 feat(tools): media + ha groups (HA stubs per spec §0.2)
52fec8c 2026-06-04 feat(migrate): lazyclaw hermes import
d00900e 2026-06-04 feat(cli): add lazyclaw sandbox list|test|add|use subcommand
8636d6d 2026-06-04 feat(tools): delegation group — task_spawn + delegate
ee8dc67 2026-06-04 feat(tools): scheduling group — cron_add/remove/list
28021c6 2026-06-04 feat(migrate): full v4→v5 migration + rollback
5be0aec 2026-06-04 test(phaseB): e2e learning-loop acceptance
b27a0ff 2026-06-04 feat(tools): git group — 5 read-only + 2 sensitive writers
3f780e2 2026-06-04 feat(channels-voice): @lazyclaw/channel-voice plugin (transcribe-only)
83ecaa5 2026-06-04 feat(mas,daemon): add nudge ticker + SSE producer
b0e4b25 2026-06-04 feat(tools): coding group — python/node exec, sql, http, regex
d5c4060 2026-06-04 feat(channels-email): @lazyclaw/channel-email plugin skeleton
50cd3cb 2026-06-04 feat(tools): os group — clipboard, screenshot, notify, open_url, file_dialog
92ee749 2026-06-04 feat(tui): interrupt-and-redirect REPL + cli.mjs ink mount
d8707ee 2026-06-04 feat(channels): whatsapp and signal plugin skeletons
aeee272 2026-06-04 feat(cli): personality subcommand + /personality REPL slash
a47149e 2026-06-04 feat(sandbox): per-worker bindings + node-ssh runtime dep
ae72e42 2026-06-04 feat(tools): web group — fetch + search + url_extract
bb30422 2026-06-04 feat(mas): add user_modeler (Honcho-equivalent USER.md updater)
7d4d313 2026-06-04 feat(channels-discord): @lazyclaw/channel-discord plugin skeleton
8c7e796 2026-06-04 feat(sandbox): add ssh/singularity/modal/daytona backends + resolver
b38e28b 2026-06-04 feat(tui): multiline editor + ink ghost autocomplete
b198116 2026-06-04 feat(mas): add recall tool (FTS5 cross-scope query)
ab181db 2026-06-04 feat(cli): /handoff slash migrates active session across channels
45e87cb 2026-06-04 feat(tools): learning group — skill_*, memory_*, user_*
8e7a12d 2026-06-04 feat(skill_synth): v5 frontmatter + anti-pattern outcome switch
7e9d858 2026-06-04 feat(tui): two-column ink splash with fixed 4-line footer
49ab930 2026-06-04 feat(channels): plugin loader + channels install/remove/list CLI
f642462 2026-06-04 feat(tools): recall tool over Phase B FTS5 substrate
8d8ddfb 2026-06-04 feat(mas): 8-layer prompt compose stack for v5 persona system
9c44c08 2026-06-04 feat(sandbox): add local backend with pluggable OS confiners
2c7c246 2026-06-04 feat(tui): sloth ASCII build pipeline + committed banner
509757f 2026-06-04 feat(tools): add edit + patch (sensitive, fs category)
4b9d101 2026-06-04 feat(mas): add confidence calculator (Wilson + cross-CLI dampen)
281e17c 2026-06-04 refactor(sandbox): move docker backend into sandbox/docker.mjs
1cf1c38 2026-06-04 feat(tools): introduce registry + sensitive-driven tool_runner
ec618c4 2026-06-04 feat(tui): add ink + theme tokens for v5 splash
dcadfdb 2026-06-04 feat(channels): add threads.jsonl store for cross-channel session mapping
0af7d1c 2026-06-04 feat(sandbox): add Sandbox + SandboxSession base contracts
b17226d 2026-06-04 feat: v5 Phase A foundation
57e349d 2026-06-04 feat(migrate): v4 → v5 baseline migration (backup + config + index)
a5156f0 2026-06-04 feat(mas): wire FTS5 write-through hooks for sessions/skills/trajectories
17043f5 2026-06-04 feat(mas): SQLite + FTS5 index store
78952f3 2026-06-04 feat(mas): TrajectoryRecord store with JSONL persistence
b081430 2026-06-04 feat(providers): add resolveTrainer() and dotted config-get
d0ba1b9 2026-06-04 docs(plans): lazyclaw v5.0 implementation plans (phases A-H)
1330890 2026-06-04 docs(spec): lazyclaw v5.0 Hermes-parity design
849f094 2026-06-02 docs(readme): update banner + install version to 4.3.0
1ba0565 2026-06-01 chore(release): 4.3.0
08791d1 2026-06-01 feat: SSE exec-approval producer + multichannel inbound (Matrix, generic webhook)
2e7cec1 2026-06-01 feat(gateway): wire device gateway into the daemon (HTTP + SSE)
462df2b 2026-06-01 feat: Telegram mobile bridge, Ed25519 device-auth module, skill curator + HEARTBEAT
043c418 2026-06-01 refactor(mas): shared provider-adapter resolver + secret-redaction module; harden reflection/synthesis injection
dab30f7 2026-06-01 feat(agents): Hermes-style self-improving skills
5065304 2026-05-24 chore(release): 4.2.2 — single-tone orange banner on npm
78cb269 2026-05-24 fix(cli): extend orange tone to caption rows below figlet box (Phase 19.6)
fed478e 2026-05-24 fix(cli): single-colour orange banner with figlet-standard "lazy" (Phase 19.5)
501a1a9 2026-05-23 chore(release): 4.2.1 — restore figlet boxed banner on npm
72810ac 2026-05-23 fix(cli): restore v3.99.11 figlet-"lazy" boxed wordmark banner (Phase 19.4)
df0e6b5 2026-05-23 fix(tests): replace __filename with import.meta.url in phase6 skills test
b8475c1 2026-05-23 fix(cli): swap 8-bit ASCII crab mascot for 🦞 emoji minimal banner (Phase 19.3)
c12941b 2026-05-19 fix(channels): drop "확인해보겠습니다…" and "(empty reply)" channel noise (Phase 19.2)
c8d2f98 2026-05-19 fix(channels): Slack listener loop on chat:write.customize self-posts (Phase 19.1)
6697415 2026-05-19 feat(mas): claude-cli tool-use adapter (Phase 19)
d41ad20 2026-05-19 feat(mas): per-agent memory with auto reflection on task done (Phase 18, v4.2.0)
7f7e347 2026-05-19 chore(release): 4.1.0 — multi-agent Slack teams (Phases 9–16)
47893f4 2026-05-19 feat(mas): per-agent persona, transcript export, typing placeholder (Phase 16)
0fa8e5b 2026-05-19 feat(mas): dashboard CRUD routes + Agents/Teams/Tasks tabs (Phase 15)
9a0f642 2026-05-19 feat(mas): mention router + termination policies (Phases 13–14)
7103215 2026-05-18 feat(mas): tool-use loop with anthropic/openai/gemini adapters (Phase 12)
0518958 2026-05-18 feat(mas): Slack Socket Mode listener + multi-agent foundation (Phases 9–11)
4c72d98 2026-05-18 chore(release): 4.0.0 — /loop and /goal slash commands (Phases 1–8)
0b0df8e 2026-05-18 feat(channels): Slack adapter with real chat.postMessage delivery (Phase 8)
3704e34 2026-05-18 feat(channels): add channel adapter interface (Phase 7)
076837d 2026-05-18 feat(loop): wire /loop and goal tick to layered memory (Phase 6)
ff3f155 2026-05-18 feat(memory): add layered memory store + /memory and /dream (Phase 5)
a5bd1b4 2026-05-18 feat(goal): wire /goal to cron scheduler with tick subcommand (Phase 4)
d387c56 2026-05-18 feat(goal): register persistent goals via /goal slash + CLI (Phase 3)
03a1070 2026-05-18 feat(loop): add lazyclaw loop foreground+detached subcommands (Phase 2)
6e5289c 2026-05-18 feat(loop): add /loop REPL slash command (Phase 0+1)
f4bfee9 2026-05-18 chore: port 8-bit crab mascot CLI redesign
22dd2d8 2026-05-18 docs: add terminal screenshots to README usage sections
f59645e 2026-05-18 chore(release): 3.99.29
bda076d 2026-05-18 chore: import lazyclaw as a standalone repository
```
