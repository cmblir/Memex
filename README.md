# Karpathy LLM Dashboard

A personal knowledge base that writes itself.

Based on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Sources go in, a persistent wiki comes out — maintained entirely by Claude, viewed in Obsidian and this dashboard.

**[한국어 README](README-ko.md)**

---

## The pattern

RAG rediscovers knowledge from scratch on every query. This doesn't. Claude reads your sources once, integrates them into a growing wiki of interlinked pages, and every new source compounds on the last. You curate sources and ask questions. Claude handles the bookkeeping — summaries, cross-references, citations, contradictions, stale-claim tracking.

- `raw/` is **immutable** source documents (articles, papers, notes). Claude reads but cannot modify — protected at 4 levels.
- `wiki/` is LLM-maintained markdown pages — entity pages, concept pages, source summaries, analyses.
- `CLAUDE.md` is the schema that tells Claude how to operate the wiki.
- The **dashboard** is a browser-based control panel at `http://localhost:8090`.

---

## Quick start

```bash
git clone https://github.com/cmblir/karpathy-llm-dashboard.git my-wiki
cd my-wiki
python dashboard/server.py
# → http://localhost:8090
```

Open the vault in Obsidian ("Open folder as vault" → select `my-wiki`). Obsidian settings, graph colors, and hotkeys are pre-configured.

**Requirements**: Python 3.10+ (zero dependencies), [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`), a browser. Obsidian optional but recommended.

---

## Dashboard

### UI/UX

- **Floating assistant character** — a pixel-art Claude character wanders the screen. Click (or drag) to open a chat panel where you can ask how any feature works. Powered by Claude CLI with dashboard-specific context; does not answer wiki content questions (those go through Query).
- **Black & white design** — monochrome palette; color is reserved for status and diffs only.
- **Categorized toolbar** — operations are grouped into 5 dropdowns (Work, Analyze, Browse, Create, More). The parent of your active view is highlighted.
- **Interactive** — hover/focus animations, toast notifications, dropdown pop, smooth view transitions.
- **Resizable sidebar** — drag the right edge (220–500px) or press `Cmd/Ctrl + B` to collapse. Width persists in `localStorage`.
- **Folder continuous view** — click a folder *name* in the tree to read all its pages in one long scroll with a floating scroll-spy.
- **Bilingual** — EN / 한국어 toggle in the header. Your choice persists.
- **Model selector** — pick Claude model from the header (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Default).

### Operations

| Category | Feature | What it does |
|----------|---------|--------------|
| **Work** | Ingest | Paste a source → `raw/` → Claude generates/updates wiki pages → diff + reasoning panel + revert |
| | Query | Ask a question. Tracked: which files were read, wiki-vs-raw ratio, token usage |
| | Write | Writing Companion: draft essays using the wiki. Citations auto-inserted. Topic/length/style |
| | Compare | Pick two pages → similarities/differences/implications → save as `comparison` page |
| **Analyze** | Lint | 16-point health check. Auto-fix button |
| | Reflect | Weekly meta-analysis. Suggested pages / schema updates / missing sources / contradiction patterns |
| | Review | Spaced Review: list `status: active` pages not updated for 30+ days. One-click refresh |
| | Provenance | Per-page citation coverage (claims with `[^src-*]` / total claims). Auto-fix button |
| **Browse** | Search | TF-IDF full-text search across the wiki |
| | Graph | Force-directed knowledge graph. Drag nodes, click to open |
| | History | Git-backed ingest history. One-click revert of any ingest |
| **Create** | + Folder | New wiki subfolder |
| | + Page | Empty page with frontmatter |
| **More** | CLAUDE.md | View and edit the schema from the dashboard |
| | Guide | Built-in interactive guide (streamed on first view) |

### Per-page actions

- **Edit** — inline markdown editor
- **Slides** — export page as Marp-compatible slide deck
- **Delete** — for non-system pages

### Header indicators

- **Live dot** + stats: total pages · sources · links
- **Wiki Ratio gauge** — how much Claude relied on wiki vs raw in recent queries. Below 0.4 means your wiki isn't replacing raw effectively
- **Index strategy badge** — `flat` (<50 pages), `hierarchical` (50–200), `indexed` (>200, qmd recommended)
- **Status bar (bottom-left)**: Claude CLI, Obsidian — both report raw facts (process/vault_open), no guesses

---

## How knowledge accumulates

```
you drop a source ─────────►  raw/article.md
                              │
                              ▼
           Claude reads it, generates:
           ├─ wiki/source-article.md     (summary, auto-created)
           ├─ wiki/entity-X.md           (new or updated)
           ├─ wiki/concept-Y.md          (new or updated)
           ├─ wiki/index.md              (updated)
           ├─ wiki/log.md                (appended)
           └─ ingest-reports/YYYY-MM-DD-{slug}.md  (WHY report)

           │
           ▼
           git commit: "ingest: Article Title"
           │
           ▼
           Dashboard shows: diff view + reasoning + approve / revert
```

Every ingest is a git commit. Every page has a revert path.

---

## Infrastructure

- **Git-backed history**. Every ingest is a commit. Every revert is a proper `git revert`.
- **Inline citations**. Every factual claim needs `[^src-source-slug]`. Rendered in the dashboard as numbered badges with source-page tooltips.
- **Provenance tracking**. `/api/provenance` reports citation coverage per page.
- **raw/ immutability** — 4-layer defense:
  1. `CLAUDE.md` instructs LLM never to modify raw/
  2. Every ingest prompt includes "raw/ is immutable"
  3. `assert_writable()` blocks programmatic writes at the server
  4. `check_raw_integrity()` detects post-hoc tampering
- **Adaptive indexing**. At 50 pages, `index.md` auto-splits into `index-sources.md`, `index-entities.md`, `index-concepts.md`, etc. Prompts reference only the relevant sub-index.
- **Ingest reports** (`ingest-reports/`). Claude writes a WHY report for every ingest — "why did I create this page, modify that one, add this cross-link?"
- **Reflect reports** (`reflect-reports/`). Weekly meta-analysis saved for later.
- **Query log** (`query-log.jsonl`). Tracks files read, wiki ratio, token usage. Feeds the Wiki Ratio gauge.
- **Contradiction resolution**. CLAUDE.md defines 3 paths: historical-claims shelf, disputed flag, superseded chain.

---

## Schema (`CLAUDE.md`)

The schema covers:

- **Frontmatter rules** — `type`, `confidence`, `status`, `source_count`, `superseded_by`.
- **Inline citation rules** — format, obligation criteria, source slug mapping.
- **Contradiction resolution** — 3 cases with concrete example markdown.
- **Ingest workflow** — 9-step strict procedure. Pages cannot be created without at least one citation.
- **Lint checklist** — 16 checks across structure / citation / link / freshness.

Edit it in the dashboard (More → CLAUDE.md → Edit) or from the terminal. Changes take effect from the next operation.

---

## Repository layout

```
raw/                     source documents (immutable)
raw/assets/              images
wiki/                    LLM-maintained pages
  index.md               content catalog (auto flat/hierarchical)
  log.md                 activity timeline
  overview.md            wiki stats
ingest-reports/          per-ingest WHY report
reflect-reports/         weekly meta-analysis
plans/                   project plans (feature queues)
query-log.jsonl          query tracking log (gitignored)
.dashboard-settings.json  runtime settings (model, gitignored)
dashboard/
  server.py              API server (Python 3.10+, stdlib only)
  index.html             single-file dashboard UI
  provenance.py          citation parsing + coverage
  index_strategy.py      adaptive indexing
  build.py               (optional) wiki → data.json compiler
CLAUDE.md                schema
.obsidian/               pre-configured vault settings
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Claude CLI + Obsidian connection (raw facts) |
| GET | `/api/wiki` | All wiki data (pages, graph, log, stats) |
| GET | `/api/folders` | Folder tree |
| GET | `/api/hash` | Change-detection hash |
| GET | `/api/schema` | Read `CLAUDE.md` |
| GET | `/api/history` | Ingest commit history |
| GET | `/api/provenance` | Citation coverage per page |
| GET | `/api/query-stats` | Recent query Wiki Ratio average |
| GET | `/api/index/status` | Current indexing strategy |
| GET | `/api/raw/integrity` | raw/ tampering check |
| GET | `/api/reflect/status` | Last reflect date |
| GET | `/api/review/list` | Pages stale for 30+ days |
| GET | `/api/settings` | Current model + available models |
| POST | `/api/settings` | `{model}` — change Claude model |
| POST | `/api/ingest` | `{title, content, folder}` — with diff + reasoning + auto-commit |
| POST | `/api/query` | `{question}` — tracks files_read + wiki_ratio |
| POST | `/api/query/save` | `{title, content}` — save as analysis page |
| POST | `/api/lint` / `/api/lint/fix` | health check + auto-fix |
| POST | `/api/reflect` | `{window}` — meta-analysis |
| POST | `/api/write` | `{topic, length, style}` — writing companion |
| POST | `/api/compare` | `{page_a, page_b, save_as?}` |
| POST | `/api/review/refresh` | `{filename}` — refresh stale page |
| POST | `/api/slides` | `{page}` — Marp export |
| POST | `/api/search` | `{query, top_k}` — TF-IDF |
| POST | `/api/suggest/sources` | recommend next sources |
| POST | `/api/assistant` | `{question, lang, history}` — dashboard helper chatbot |
| POST | `/api/provenance/fix` | `{page}` — fill missing citations |
| POST | `/api/index/rebuild` | force index rebuild |
| POST | `/api/revert` | `{commit_hash}` — revert an ingest |
| POST | `/api/page` / `/api/page/update` / `/api/page/delete` | page CRUD |
| POST | `/api/folder` | create folder |
| POST | `/api/schema` | update `CLAUDE.md` |

---

## Troubleshooting

### "Claude CLI timeout"

Ingest can take several minutes for large sources. Default timeout is **600s (10 min)**. To increase:

```bash
CLAUDE_TIMEOUT=1200 python dashboard/server.py    # 20 min
```

When you see this error, the dashboard now shows a **"Run Claude CLI diagnostic"** button. It calls `/api/claude/diagnose` which checks:
- `claude --version` (installed?)
- A 30s quick prompt (authenticated? responsive?)
- Model speed warning if applicable

You can also call it directly:
```bash
curl http://localhost:8090/api/claude/diagnose | python3 -m json.tool
```

### "vault not registered"

Hover the status bar tooltip — it shows your project path vs Obsidian's known vaults. Click the **Register** button to add your project to `obsidian.json` automatically, then restart Obsidian.

### Heavy model slowness

Opus 4.7 is the slowest. For ingestion of large batches, switch to **Sonnet 4.6** or **Haiku 4.5** in the header model dropdown.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_TIMEOUT` | `600` | Max seconds for Claude CLI calls (Ingest/Query/Lint) |
| `CLAUDE_QUICK_TIMEOUT` | `30` | Max seconds for diagnostic quick test |
| `CLAUDE_TOOLS` | `Edit,Write,Read,Glob,Grep` | Allowed tools for `claude -p --allowedTools` |

---

## CLI usage (optional)

Everything in the dashboard also works from the terminal:

```bash
claude                                # interactive
"Ingest raw/some-article.md"
"What is Self-Attention?"
"Lint the wiki"
"Reflect on the last 10 ingests"
```

---

## Keyboard shortcuts

- `Cmd/Ctrl + B` — toggle sidebar
- `Esc` — close dropdowns / modals

---

## License

MIT
