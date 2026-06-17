---
title: "source-lazyclaw-codebase-2026-06"
type: source-summary
created: 2026-06-18
last_updated: 2026-06-18
source_count: 1
confidence: medium
status: active
tags:
  - lazyclaw
  - software
  - cli
  - snapshot
sources:
  - lazyclaw-codebase-2026-06
---

# Source summary — lazyclaw codebase snapshot (2026-06-18)

A first-party snapshot of the `lazyclaw` git repository (`/Users/o/lazyclaw`,
branch `main`) plus its `README.md` and `CHANGELOG.md`, captured 2026-06-18 to
seed the [[lazyclaw-overview]] and [[lazyclaw-commit-history]] wiki pages.

## What the source contains

- **Project identity** from the README: lazyclaw is a TUI-first Node CLI agent in the "claw" family (Hermes → OpenClaw → nanoclaw) whose pitch is learning on a Claude subscription for $0 and reaching the user on every messaging channel.[^src-lazyclaw-codebase-2026-06]
- **Full git log** (323 commits, 2026-05-18 → 2026-06-16), oneline form, newest first.[^src-lazyclaw-codebase-2026-06]
- **Aggregate statistics**: commit type counts (141 feat, 79 fix, 35 docs, 27 refactor, …) and top scopes (tui 46, cli 24, mas 16, providers 15, slash 15, …).[^src-lazyclaw-codebase-2026-06]
- **Release timeline** from 3.99.29 through 6.3.1.[^src-lazyclaw-codebase-2026-06]
- **The single uncommitted working-tree change** at snapshot time: `mas/index_db.mjs` FTS dead-sentinel (+33 −3).[^src-lazyclaw-codebase-2026-06]

## Key facts

- The repo was imported as a standalone project on 2026-05-18 (`bda076d`) at version 3.99.29; HEAD is `46ff8b1` (2026-06-16).[^src-lazyclaw-codebase-2026-06]
- The dominant engineering activity over the window is the **v5.0 Hermes-parity rewrite** (phases A–H on 2026-06-04/05) followed by **v6 hardening + a long UX-audit tail** (June 2026).[^src-lazyclaw-codebase-2026-06]
- Architecture splits two provider slots — `provider` (chat) and `trainer` (the $0 learning loop) — and runs an always-on daemon/gateway that fans channels into one shared session store.[^src-lazyclaw-codebase-2026-06]

## Limitations

- This is a point-in-time snapshot; the live repo keeps moving. Claims here are
  dated 2026-06-18.
- The snapshot records commit subjects and README prose, not the code itself —
  per-feature correctness is asserted by the project, not independently verified.
  (A separate audit memo, `project-lazyclaw-audit-2026-06`, notes several
  advertised features that were partially un-wired as of v6.3.1.)

[^src-lazyclaw-codebase-2026-06]: [[source-lazyclaw-codebase-2026-06]]

