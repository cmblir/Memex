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

<br />

<img src="docs/demo.gif" width="100%" alt="Memex dashboard demo" />

</div>

---

## Why?

Most LLM-plus-documents setups **re-derive knowledge on every query**. RAG finds chunks, the model stitches an answer, nothing is kept. Ten queries against the same docs → ten rediscoveries.

**Memex inverts this.** You add a source once. Claude reads it, integrates it into a persistent wiki, flags contradictions against older pages, wires up citations, and commits the result. By query #10, the wiki is doing the synthesis for free — the bookkeeping has already happened.

Based on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Named for [Vannevar Bush's 1945 Memex](https://en.wikipedia.org/wiki/Memex).

---

## The pattern

```
   projects/<slug>/    One topic = one project. Fully isolated.
     ├─ raw/           Original sources. Immutable. 4-layer protection.
     │    │
     │    ▼  ingest
     ├─ wiki/          Claude-maintained pages. Entities, concepts, summaries.
     │                 Inline citations [^src-*]. Auto cross-referenced.
     │                 Every change is a git commit (prefixed with slug).
     ├─ CLAUDE.md      Per-project schema (starts from a template)
     └─ .settings.json Per-project model (Opus / Sonnet / Haiku)
     ▼
   Obsidian graph + Dashboard
                       Switch projects. Browse, query, analyze, reflect, compare, write.
```

- **You**: curate sources, ask questions, direct the analysis, draw project boundaries.
- **Claude**: summarize, cross-reference, cite, detect contradictions, file. *Scoped to the selected project.*
- **The wiki**: compounds independently inside each project.

If `projects.json` is missing or empty, the server runs in legacy mode — treating the root `wiki/ raw/` as the default project (existing setups keep working unchanged).

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
- **Multi-project** — isolated wikis, models, templates under one dashboard
- **Git-backed history** — every ingest is a commit (`ingest(slug): ...`)
- **One-click revert** — undo any ingest
- **Inline citations** — `[^src-*]` rendered as badges
- **raw/ immutability** — 4 layers of protection, applied to every project's `raw/`
- **Adaptive indexing** — flat → hierarchical → indexed (auto)
- **Schema (CLAUDE.md)** — root common + per-project
- **WHY reports** — every ingest explains its own decisions
- **Query log** — per-project Wiki Ratio gauge
- **Bilingual UI** — EN / 한국어 toggle
- **Model selector** — Opus / Sonnet / Haiku, pickable per project

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
- **Project selector** — header dropdown switches the active project (`Cmd/Ctrl + P` to focus). `+` creates a new project, `×` soft-deletes.
- **Model-linked** — the model dropdown syncs to the selected project's model. Different models per project are fine.
- **Categorized toolbar** — 13 operations in 5 dropdowns (Work, Analyze, Browse, Create, More).
- **Resizable sidebar** — drag the edge, or `Cmd/Ctrl + B` to collapse.
- **Folder continuous view** — click a folder *name* to read all its pages in one scroll.
- **Live status** — Claude CLI + Obsidian detection, raw facts only.
- **Wiki Ratio gauge** — per-project: how often Claude reached into wiki vs raw. Below 0.4 means the wiki isn't replacing raw yet.
- **Floating Claude character** — click for an in-dashboard chatbot that answers questions *about the dashboard*. Wiki-content questions get redirected to Query.

### Views

<table>
<tr>
<td width="50%"><img src="docs/screenshots/home.png" alt="Overview" /></td>
<td width="50%"><img src="docs/screenshots/graph.png" alt="Knowledge graph" /></td>
</tr>
<tr>
<td align="center"><sub><strong>Overview</strong> — wiki stats, coverage areas, getting started</sub></td>
<td align="center"><sub><strong>Graph</strong> — force-directed knowledge graph</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/ingest.png" alt="Ingest" /></td>
<td width="50%"><img src="docs/screenshots/history.png" alt="History" /></td>
</tr>
<tr>
<td align="center"><sub><strong>Ingest</strong> — paste source, Claude generates pages</sub></td>
<td align="center"><sub><strong>History</strong> — git-backed ingest timeline with revert</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/provenance.png" alt="Provenance" /></td>
<td width="50%"><img src="docs/screenshots/query.png" alt="Query" /></td>
</tr>
<tr>
<td align="center"><sub><strong>Provenance</strong> — per-page citation coverage</sub></td>
<td align="center"><sub><strong>Query</strong> — ask the wiki, tracks files read</sub></td>
</tr>
</table>

<sub><em>Want your own screenshots? Run <code>docs/capture.sh</code> while the server is up.</em></sub>

---

## How knowledge accumulates

Everything below happens inside `projects/<slug>/` (or at the root in legacy mode):

```
You drop a source ─────►  projects/<slug>/raw/article.md
                          │
                          ▼
  Claude runs with the project root as cwd and loads its CLAUDE.md:
  ├─ wiki/sources/source-article.md   (source summary)
  ├─ wiki/entities/entity-X.md        (new or updated)
  ├─ wiki/concepts/concept-Y.md       (new or updated, with citations)
  ├─ wiki/index.md                    (updated)
  ├─ wiki/log.md                      (appended)
  └─ ingest-reports/...md             (WHY report)

                          │
                          ▼
  git commit "ingest(<slug>): <title>"
                          │
                          ▼
  Dashboard shows: diff + reasoning + approve / revert
```

Every ingest is revertable. Every claim has a citation. Every contradiction gets one of three policies (Historical / Disputed / Superseded). Each project is fully isolated — an ingest in project A cannot touch project B's files.

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

**Per-project settings**
- `projects/<slug>/.settings.json` — current project's model. Editable via the header model dropdown.
- `projects/<slug>/CLAUDE.md` — Claude rules for that project. Starts from a template copy; edit freely.
- `projects.json` — registry + currently active project.

**Root common schema**
- `CLAUDE.md` (root) — universal rules across projects (truthfulness, git, modularization, performance). Per-project `CLAUDE.md` takes precedence, but the core principles stay.

Adjust frontmatter rules, citation rules, contradiction resolution, ingest workflow, and the lint checklist here — changes take effect on the next operation.

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
raw/                       (legacy) Immutable sources — moved under a project on migration
wiki/                      (legacy) Claude-maintained pages
  index.md                 Content catalog (auto flat/hierarchical)
  log.md                   Activity timeline
  overview.md              Stats + coverage areas
ingest-reports/            One WHY report per ingest
reflect-reports/           Weekly meta-analyses
projects/                  Multi-project root (see section below)
  <slug>/
    CLAUDE.md              Project schema
    .settings.json         Per-project model, etc.
    wiki/                  Project wiki (sources/entities/concepts/...)
    raw/                   Project sources
    ingest-reports/, reflect-reports/, plans/, query-log.jsonl
projects.json              Project registry (active + list)
templates/                 Project templates (generic + variants)
plans/                     Work queue / backlog / blocked
logs/                      Autonomous-mode session logs
dashboard/
  server.py                Zero-dep API server
  project_registry.py      Project resolver + registry
  index.html               Single-file dashboard UI
  provenance.py            Citation parsing + coverage
  index_strategy.py        Adaptive indexing
  claude_character.svg     The floating helper
CLAUDE.md                  Root common schema
.obsidian/                 Pre-configured vault
```

---

## Multi-project

Run multiple independent topics (projects) from a single dashboard. Each project has its own `wiki/ raw/ CLAUDE.md .settings.json`, with independently configurable model, template, and folder structure.

**In the dashboard**

- Header dropdown to switch the active project (Cmd/Ctrl+P to focus)
- `+` button opens the New Project modal (title / slug / description / template / model)
- `×` button moves the current project to `projects/.trash/` (soft delete; files preserved)
- Switching scopes every subsequent action (Ingest / Query / Lint / Write / Compare / ...) to that project's `raw/` and `wiki/`

**Templates**

Choosing a template at creation time automatically scaffolds `wiki/` subfolders:

| Template | Default folders |
|---|---|
| generic | `sources entities concepts techniques analyses` |
| llm-research | `sources models techniques concepts entities benchmarks analyses` |
| reading-log | `sources authors ideas quotes reviews` |
| personal-notes | `daily topics people projects` |

Template `CLAUDE.md` files live at `templates/<name>/CLAUDE.md` and are copied (with `{{TOPIC}}` / `{{PURPOSE}}` substitution) into the new project.

**API (available from the command line too)**

```bash
# List projects + active
curl http://localhost:8090/api/projects

# Create
curl -X POST http://localhost:8090/api/projects/create \
  -H 'Content-Type: application/json' \
  -d '{"slug":"ml-papers","title":"ML Papers","description":"papers",
       "model":"claude-sonnet-4-6","template":"llm-research"}'

# Switch
curl -X POST http://localhost:8090/api/projects/switch \
  -H 'Content-Type: application/json' -d '{"slug":"ml-papers"}'

# Scoped calls
curl "http://localhost:8090/api/wiki?project=ml-papers"
curl -X POST http://localhost:8090/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"project":"ml-papers","title":"...","content":"..."}'
```

**Legacy compatibility**

If `projects.json` is missing or empty, the server runs in legacy mode — treating the root `wiki/ raw/ CLAUDE.md` as the default project. Existing setups keep working unchanged until you create your first project.

---

## API

Dashboard talks to the server via 35+ endpoints. Most endpoints accept a project scope via the `?project=<slug>` query string (GET) or a `"project"` field in the JSON body (POST); omitting it falls back to the active project.

<details>
<summary><strong>Show all endpoints</strong></summary>

**Project management**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects + active + legacy info |
| GET | `/api/projects/active` | Current active project |
| GET | `/api/templates` | Available templates + recommended folders |
| POST | `/api/projects/create` | New project (slug / title / description / model / template) |
| POST | `/api/projects/switch` | Switch active project |
| POST | `/api/projects/update` | Update project model / title / description |
| POST | `/api/projects/delete` | Soft delete → `projects/.trash/` |

**Data / status**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Claude CLI + Obsidian — raw facts only |
| GET | `/api/wiki` | Full wiki data (project-scoped) |
| GET | `/api/folders` | Folder tree (project-scoped) |
| GET | `/api/hash` | Change detection (project-scoped) |
| GET | `/api/schema` | Read CLAUDE.md (project-scoped) |
| GET | `/api/history` | Ingest commits |
| GET | `/api/provenance` | Citation coverage (project-scoped) |
| GET | `/api/query-stats` | Wiki Ratio (project-scoped) |
| GET | `/api/index/status` | Strategy badge (project-scoped) |
| GET | `/api/raw/integrity` | raw/ tampering check |
| GET | `/api/reflect/status` | Last reflect date (project-scoped) |
| GET | `/api/review/list` | Stale pages (project-scoped) |
| GET | `/api/settings` | Model options + per-project current model |
| GET | `/api/claude/diagnose` | CLI quick check |

**Operations (all project-scoped)**

| Method | Path | Description |
|--------|------|-------------|
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
| POST | `/api/provenance/fix` | Add missing citations |
| POST | `/api/index/rebuild` | Force index rebuild |
| POST | `/api/revert` | Revert an ingest (repo-wide git) |
| POST | `/api/page` / `/update` / `/delete` | Page CRUD |
| POST | `/api/folder` | Create folder |
| POST | `/api/schema` | Update CLAUDE.md |
| POST | `/api/settings` | Change model (legacy → global; project → `.settings.json`) |
| POST | `/api/assistant` | Dashboard helper chatbot (project-agnostic) |
| POST | `/api/obsidian/register` | Add this folder to obsidian.json |

</details>

---

## Keyboard shortcuts

- `Cmd/Ctrl + P` — focus the project selector
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
