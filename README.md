# LLM Wiki Dashboard

A personal knowledge base built and maintained by an LLM, with a web dashboard for control. Based on [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

**[한국어 README](README-ko.md)**

> **Obsidian** is the IDE. **Claude Code** is the programmer. **The wiki** is the codebase. **The dashboard** is the control panel.

You never write the wiki yourself — the LLM writes and maintains all of it. You curate sources, explore, and ask the right questions. The dashboard lets you do it all from a browser.

## Quick Start

```bash
git clone https://github.com/cmblir/karpathy-llm-dashboard.git my-wiki
cd my-wiki
python dashboard/server.py
# → http://localhost:8090
```

Open Obsidian → "Open folder as vault" → select `my-wiki`.

That's it. Obsidian settings, graph colors, and hotkeys are pre-configured.

## What You Can Do

### UI / UX

- **Black & white design** — monochrome palette for focused reading, minimal color except for status/diff signals.
- **Interactive** — hover/focus animations, smooth transitions, toast notifications.
- **Resizable sidebar** — drag the right edge to adjust width (220–500px), or press **Cmd/Ctrl + B** to toggle.
- **Folder view** — click a folder name in the tree to read all its pages continuously in one scroll, with a floating scroll-spy navigator.
- **Model selector** — top-left dropdown to pick Claude model (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Default).

### Languages

Fully bilingual (English / 한국어). Use the **EN / 한국어** toggle in the top-right header. Your choice persists in `localStorage`.

### From the Dashboard (http://localhost:8090)

| Feature | Description |
|---------|------------|
| **Ingest** | Paste content → auto-saves to `raw/` → Claude creates wiki pages, shows diff + reasoning |
| **Query** | Ask questions → Claude searches wiki, synthesizes answer with citations. Tracks which files were read |
| **Lint** | Health check: missing citations, orphan pages, stale claims, frontmatter issues (16-point checklist) |
| **Reflect** | Meta-analysis of recent ingests → suggests new pages, schema improvements, missing sources |
| **Write** ✨ | Writing Companion: draft essays/articles using the wiki with automatic `[^src-*]` citations. Topic + length + style (blog/paper/explainer) |
| **Compare** ✨ | Two-page analysis (similarities / differences / implications) → save as `comparison` page |
| **Review** ✨ | Spaced Review: list active pages stale for 30+ days → refresh with Claude |
| **Search** ✨ | Smart Search: TF-IDF full-text search across the wiki with score-ranked snippets |
| **Slides** ✨ | Export any page as Marp-compatible slide deck markdown |
| **Suggest Sources** ✨ | Claude recommends what to ingest next based on wiki gaps |
| **History** | Git-backed ingest history with one-click revert |
| **Provenance** | Citation coverage table per page, auto-fix with Claude |
| **Graph** | Interactive knowledge graph with drag, click to navigate |
| **CLAUDE.md** | View and edit the LLM schema directly from the dashboard |
| **Edit/Delete** | Edit any wiki page, delete non-system pages |
| **+ Folder / + Page** | Create wiki structure manually |

### From the CLI

```bash
claude                              # Start Claude Code in this directory
# Then in the conversation:
"Ingest raw/some-article.md"        # Process a source
"What is Self-Attention?"           # Query the wiki
"Lint the wiki"                     # Health check
```

## Architecture

```
raw/                  Immutable source documents (protected — cannot modify/delete)
raw/assets/           Downloaded images
wiki/                 LLM-maintained wiki pages (Obsidian + dashboard viewer)
  index.md            Content catalog (auto-switches: flat → hierarchical at 50+ pages)
  log.md              Activity timeline
  overview.md         Wiki stats
dashboard/
  server.py           API server (Python 3.10+, zero dependencies)
  index.html          Single-file dashboard UI
  provenance.py       Citation parsing and coverage analysis
  index_strategy.py   Adaptive indexing (flat/hierarchical/indexed)
  build.py            Optional: wiki → data.json compiler
ingest-reports/       WHY reports for each ingest
reflect-reports/      Weekly meta-analysis reports
query-log.jsonl       Query tracking (files read, wiki ratio)
CLAUDE.md             LLM schema — frontmatter rules, citation rules,
                      contradiction policy, ingest workflow, lint checklist
.obsidian/            Vault settings (pre-configured)
```

## Key Systems

### Ingest with Diff Visualization

When you ingest a source, the dashboard shows:
- **Left panel**: File tree (green = created, yellow = modified)
- **Right panel**: Unified diff for modified files, markdown preview for new files
- **Reasoning**: Claude explains why it made each decision
- **Approve / Revert**: One-click revert via `git revert`

### Inline Citations

All factual claims require `[^src-*]` citations. The dashboard renders them as numbered badges with hover tooltips and click-to-navigate.

The **Provenance** tab shows citation coverage per page — click **Fix** to have Claude add missing citations automatically.

### Adaptive Indexing

| Pages | Strategy | Behavior |
|-------|----------|----------|
| < 50 | `flat` | Single `index.md` |
| 50-200 | `hierarchical` | Type-specific sub-indexes auto-generated |
| > 200 | `indexed` | Warning banner, recommends BM25/vector search |

### Wiki Ratio Gauge

The header shows a live gauge of how much Claude relies on wiki vs raw sources when answering queries. Below 0.4 = red (wiki isn't replacing raw effectively).

### raw/ Protection

`raw/` is immutable at 4 levels:
1. `CLAUDE.md` instructs LLM never to modify raw/
2. Every prompt includes "raw/ is immutable"
3. `assert_writable()` blocks programmatic writes
4. `check_raw_integrity()` detects post-hoc changes

### Contradiction Resolution

When sources conflict, CLAUDE.md defines 3 resolution paths:
- **Newer + high confidence** → old claim moves to "Historical claims"
- **Similar date or low confidence** → "Disputed" section, page marked `disputed`
- **Explicit refutation** → old source marked `superseded`

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Claude CLI + Obsidian connection |
| GET | `/api/wiki` | All wiki data (pages, graph, log, stats) |
| GET | `/api/folders` | Folder tree |
| GET | `/api/hash` | Wiki change detection hash |
| GET | `/api/schema` | Read CLAUDE.md |
| GET | `/api/history` | Ingest commit history |
| GET | `/api/provenance` | Citation coverage per page |
| GET | `/api/query-stats` | Recent query wiki ratio average |
| GET | `/api/index/status` | Current indexing strategy |
| GET | `/api/raw/integrity` | raw/ tampering check |
| GET | `/api/reflect/status` | Last reflect date |
| GET | `/api/review/list` | Pages stale for 30+ days |
| GET | `/api/settings` | Current settings (model) + available models |
| POST | `/api/settings` | Update settings (e.g. `{model: "claude-sonnet-4-6"}`) |
| POST | `/api/ingest` | Ingest source (diff, reasoning, auto-commit) |
| POST | `/api/query` | Query with file tracking |
| POST | `/api/query/save` | Save query answer as wiki page |
| POST | `/api/lint` | Run lint checklist |
| POST | `/api/lint/fix` | Auto-fix lint issues |
| POST | `/api/reflect` | Run meta-analysis |
| POST | `/api/write` | Writing companion (topic → drafted essay) |
| POST | `/api/compare` | Compare two pages, optionally save |
| POST | `/api/review/refresh` | Refresh a stale page with Claude |
| POST | `/api/slides` | Export page as Marp slide deck |
| POST | `/api/search` | TF-IDF full-text search |
| POST | `/api/suggest/sources` | Claude suggests next sources to ingest |
| POST | `/api/provenance/fix` | Fix citations for a page |
| POST | `/api/index/rebuild` | Force index rebuild |
| POST | `/api/revert` | Revert an ingest commit |
| POST | `/api/page` | Create page |
| POST | `/api/page/update` | Edit page |
| POST | `/api/page/delete` | Delete page |
| POST | `/api/folder` | Create folder |
| POST | `/api/schema` | Update CLAUDE.md |

## Requirements

- Python 3.10+ (no pip dependencies)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- A browser
- Obsidian (optional but recommended)

## Obsidian Tips

- **Graph View** (`Cmd+G`) — see wiki structure at a glance
- **Backlinks** — see all pages referencing the current one
- **`Cmd+Shift+D`** — download images from a clipped article to `raw/assets/`
- **Web Clipper** — browser extension to clip articles as markdown into `raw/`
- **Dataview** — dynamic tables from frontmatter (install from Community Plugins)

## License

MIT
