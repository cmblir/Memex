<div align="center">

<br />

<img src="dashboard/claude_character.svg" width="100" alt="Memex character" />

<h1>Memex</h1>

<p><strong>A personal knowledge base that writes itself.</strong></p>

<p>
Drop a source. Claude does the bookkeeping.<br/>
Your knowledge compounds.
</p>

<p>
<a href="#quick-start"><img alt="Quick start" src="https://img.shields.io/badge/quick%20start-60s-111?style=flat-square" /></a>
&nbsp;
<img alt="Dependencies" src="https://img.shields.io/badge/pip%20deps-0-111?style=flat-square" />
&nbsp;
<img alt="License" src="https://img.shields.io/badge/license-MIT-111?style=flat-square" />
&nbsp;
<img alt="Made with Claude Code" src="https://img.shields.io/badge/made%20with-Claude%20Code-111?style=flat-square" />
&nbsp;
<a href="README-ko.md"><img alt="한국어" src="https://img.shields.io/badge/한국어-README-111?style=flat-square" /></a>
</p>

<br />

<p>
<em>"Obsidian is the IDE. Claude is the programmer. The wiki is the codebase."</em>
</p>

</div>

---

## Why?

Most LLM-plus-documents setups **re-derive knowledge on every query**. RAG finds chunks, the model stitches an answer, nothing is kept. Ten queries against the same docs → ten rediscoveries.

**Memex inverts this.** You add a source once. Claude reads it, integrates it into a persistent wiki, flags contradictions against older pages, wires up citations, and commits the result. By query #10, the wiki is doing the synthesis for free — the bookkeeping has already happened.

Based on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Named for [Vannevar Bush's 1945 Memex](https://en.wikipedia.org/wiki/Memex).

---

## The pattern

```
   raw/              Original sources. Immutable. 4-layer protection.
     │
     ▼  ingest
   wiki/             Claude-maintained pages. Entities, concepts, summaries.
     │               Inline citations [^src-*]. Auto cross-referenced.
     │               Every change is a git commit.
     ▼
   Obsidian graph + Dashboard
                     Browse, query, analyze, reflect, compare, write.
```

- **You**: curate sources, ask questions, direct the analysis.
- **Claude**: summarize, cross-reference, cite, detect contradictions, file.
- **The wiki**: compounds.

---

## Quick start

```bash
git clone https://github.com/cmblir/memex.git
cd memex
python dashboard/server.py    # Python 3.10+, zero pip deps
```

Open `http://localhost:8090`. Done.

<br />

<details>
<summary><strong>Requirements</strong></summary>

- Python 3.10+ (stdlib only)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
- A browser
- Obsidian — *optional* but pre-configured. The repo ships as a ready Obsidian vault.

</details>

---

## What you get

<table>
<tr>
<td width="50%" valign="top">

### ◆ Core operations
- **Ingest** — Paste source → diff + WHY report + auto-commit
- **Query** — Ask the wiki. Tracks files read, Wiki Ratio, tokens
- **Lint** — 16-point health check + auto-fix
- **Reflect** — Weekly meta-analysis of the whole wiki
- **Write** — Draft essays from the wiki, citations auto-inserted
- **Compare** — Two pages → similarities/differences
- **Review** — Spaced review of stale pages
- **Search** — TF-IDF full-text, zero deps
- **Slides** — Export any page as a Marp deck
- **Graph** — Force-directed knowledge graph

</td>
<td width="50%" valign="top">

### ◆ Infrastructure
- **Git-backed history** — every ingest is a commit
- **One-click revert** — undo any ingest
- **Inline citations** — `[^src-*]` rendered as badges
- **raw/ immutability** — 4 layers of protection
- **Adaptive indexing** — flat → hierarchical → indexed (auto)
- **Schema (CLAUDE.md)** — the rules Claude follows
- **WHY reports** — every ingest explains its own decisions
- **Query log** — drives the Wiki Ratio gauge
- **Bilingual UI** — EN / 한국어 toggle
- **Model selector** — Opus / Sonnet / Haiku

</td>
</tr>
</table>

---

## The dashboard

<div align="center">
<em>Monochrome. Categorized. Interactive.</em>
</div>

<br />

- **Black & white** — color is reserved for status and diffs only.
- **Categorized toolbar** — 13 operations in 5 dropdowns (Work, Analyze, Browse, Create, More).
- **Resizable sidebar** — drag the edge, or `Cmd/Ctrl + B` to collapse.
- **Folder continuous view** — click a folder *name* to read all its pages in one scroll.
- **Live status** — Claude CLI + Obsidian detection, raw facts only.
- **Wiki Ratio gauge** — measures how often Claude reaches into the wiki vs raw sources. Below 0.4 means your wiki isn't replacing raw yet.
- **Floating Claude character** — click for an in-dashboard chatbot that answers questions *about the dashboard*. Wiki-content questions get redirected to Query.

---

## How knowledge accumulates

```
You drop a source ─────►  raw/article.md
                          │
                          ▼
  Claude reads it, writes:
  ├─ wiki/source-article.md     (source summary)
  ├─ wiki/entity-X.md           (new or updated)
  ├─ wiki/concept-Y.md          (new or updated, with citations)
  ├─ wiki/index.md              (updated)
  ├─ wiki/log.md                (appended)
  └─ ingest-reports/...md       (WHY report)

                          │
                          ▼
  git commit "ingest: <title>"
                          │
                          ▼
  Dashboard shows: diff + reasoning + approve / revert
```

Every ingest is revertable. Every claim has a citation. Every contradiction gets one of three policies (Historical / Disputed / Superseded).

---

## CLI usage

Everything in the dashboard works from the terminal:

```bash
claude
"Ingest raw/some-article.md"
"What is Self-Attention?"
"Lint the wiki"
"Reflect on the last 10 ingests"
```

The dashboard shells out to `claude -p` underneath. Use whichever you prefer; they share the same state.

---

## Configuration

```bash
# Environment variables
CLAUDE_TIMEOUT=1200  python dashboard/server.py   # 20-min timeout for large ingests
CLAUDE_QUICK_TIMEOUT=30
CLAUDE_TOOLS=Edit,Write,Read,Glob,Grep
```

Or edit `CLAUDE.md` — the schema Claude follows. Frontmatter rules, citation rules, contradiction resolution, ingest workflow, lint checklist. Changes take effect on the next operation.

---

## Troubleshooting

<details>
<summary><strong>"Claude CLI timeout"</strong></summary>

Default is 10 min. Increase with `CLAUDE_TIMEOUT=1800`. The dashboard shows a **Run Claude CLI diagnostic** button on timeout — it calls `/api/claude/diagnose` and checks installation, auth, response time, model speed.

</details>

<details>
<summary><strong>"vault not registered"</strong></summary>

Hover the status bar — it shows your project path vs Obsidian's known vaults. Click **Register** to auto-add to `obsidian.json`, then restart Obsidian.

</details>

<details>
<summary><strong>Slow ingestion</strong></summary>

Opus 4.7 is slowest. Switch to **Sonnet 4.6** or **Haiku 4.5** in the header dropdown for faster ingests.

</details>

<details>
<summary><strong>Expecting value: line 1 column 1</strong></summary>

This is Python's empty-JSON error. Fixed — all endpoints now return valid JSON even on crash. If you still see it, check `/tmp/wiki-server.log` for the traceback.

</details>

---

## Repository layout

```
raw/                       Immutable sources
wiki/                      Claude-maintained pages
  index.md                 Content catalog (auto flat/hierarchical)
  log.md                   Activity timeline
  overview.md              Stats + coverage areas
ingest-reports/            One WHY report per ingest
reflect-reports/           Weekly meta-analyses
dashboard/
  server.py                Zero-dep API server
  index.html               Single-file dashboard UI
  provenance.py            Citation parsing + coverage
  index_strategy.py        Adaptive indexing
  claude_character.svg     The floating helper
CLAUDE.md                  Schema (the rules Claude follows)
.obsidian/                 Pre-configured vault
```

---

## API

Dashboard talks to the server via 30+ endpoints:

<details>
<summary><strong>Show all endpoints</strong></summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Claude CLI + Obsidian — raw facts only |
| GET | `/api/wiki` | Full wiki data |
| GET | `/api/folders` | Folder tree |
| GET | `/api/hash` | Change detection |
| GET | `/api/schema` | Read CLAUDE.md |
| GET | `/api/history` | Ingest commits |
| GET | `/api/provenance` | Citation coverage |
| GET | `/api/query-stats` | Wiki Ratio |
| GET | `/api/index/status` | Strategy badge |
| GET | `/api/raw/integrity` | raw/ tampering check |
| GET | `/api/reflect/status` | Last reflect date |
| GET | `/api/review/list` | Stale pages |
| GET | `/api/settings` | Model selector data |
| GET | `/api/claude/diagnose` | CLI quick check |
| POST | `/api/ingest` | New source → wiki pages |
| POST | `/api/query` | Ask the wiki |
| POST | `/api/query/save` | Save answer as page |
| POST | `/api/lint` / `/api/lint/fix` | Health check |
| POST | `/api/reflect` | Meta-analysis |
| POST | `/api/write` | Writing companion |
| POST | `/api/compare` | Two-page analysis |
| POST | `/api/review/refresh` | Refresh a stale page |
| POST | `/api/slides` | Marp export |
| POST | `/api/search` | TF-IDF search |
| POST | `/api/suggest/sources` | What to ingest next |
| POST | `/api/assistant` | Dashboard helper chatbot |
| POST | `/api/provenance/fix` | Add missing citations |
| POST | `/api/index/rebuild` | Force index rebuild |
| POST | `/api/revert` | Revert an ingest |
| POST | `/api/page` / `/update` / `/delete` | Page CRUD |
| POST | `/api/folder` | Create folder |
| POST | `/api/schema` | Update CLAUDE.md |
| POST | `/api/settings` | Change Claude model |
| POST | `/api/obsidian/register` | Add this folder to obsidian.json |

</details>

---

## Keyboard shortcuts

- `Cmd/Ctrl + B` — toggle sidebar
- `Esc` — close dropdowns / modals

---

## Credits

- **Pattern**: [Andrej Karpathy](https://github.com/karpathy) — *[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)*.
- **Ancestor**: [Vannevar Bush, "As We May Think"](https://en.wikipedia.org/wiki/As_We_May_Think), 1945.
- **Built with**: [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

---

<div align="center">
<br/>
<sub>MIT License · <a href="README-ko.md">한국어 README</a></sub>
</div>
