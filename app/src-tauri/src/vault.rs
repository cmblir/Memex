// Vault filesystem operations: open, list, read, write.
// All paths returned to the frontend are canonical absolute paths so the
// frontend can use them as stable file identifiers.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct VaultMeta {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FileNode {
    File {
        name: String,
        path: String,
    },
    Directory {
        name: String,
        path: String,
        children: Vec<FileNode>,
    },
}

// Creates and seeds Memex's own vault on first launch. We default to
// ~/Documents/Memex so the folder shows up in Finder/Files, alongside the
// user's other documents — Memex owns it, but it is plain markdown that
// can also be opened in Obsidian or any editor.
//
// Scaffolds the wiki workflow layout from CLAUDE.md:
//   raw/             — immutable source documents
//   wiki/            — LLM-maintained pages (with index.md, log.md)
//   daily/           — daily notes
//   ingest-reports/  — WHY reports for each ingest
// Plus a top-level welcome.md and a per-vault CLAUDE.md so Claude knows
// the wiki maintainer rules when invoked with this vault as cwd.
//
// Idempotent: only creates files that don't already exist.
pub fn ensure_default_vault() -> Result<String, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "no home directory found".to_string())?;
    let target = Path::new(&home).join("Documents").join("Memex");
    seed_vault(&target)?;
    Ok(target.to_string_lossy().into_owned())
}

fn seed_vault(target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| format!("create vault root: {e}"))?;
    for sub in ["raw", "wiki", "daily", "ingest-reports"] {
        let p = target.join(sub);
        if !p.exists() {
            std::fs::create_dir_all(&p).map_err(|e| format!("create {sub}: {e}"))?;
        }
    }
    write_if_missing(&target.join("welcome.md"), WELCOME)?;
    write_if_missing(&target.join("CLAUDE.md"), VAULT_CLAUDE_MD)?;
    write_if_missing(&target.join("wiki/index.md"), WIKI_INDEX)?;
    write_if_missing(&target.join("wiki/log.md"), WIKI_LOG)?;
    // A small set of interconnected starter notes so the Graph / Provenance /
    // Overview views have content on first launch. Idempotent and deletable.
    for (rel, content) in crate::sample_vault::SAMPLE_NOTES {
        write_if_missing(&target.join(rel), content)?;
    }
    Ok(())
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, content).map_err(|e| format!("write {path:?}: {e}"))
}

const WELCOME: &str = r#"# Welcome to Memex

This is your Memex vault. Everything you write here lives in plain
markdown on disk — you stay in control.

## Layout

- `raw/` — drop or paste sources here (PDF, text, articles). Treat as
  immutable; Memex never modifies these.
- `wiki/` — your maintained pages: entities, concepts, techniques,
  analyses, plus `index.md` and `log.md`.
- `daily/` — daily notes (`YYYY-MM-DD.md`). Use the sidebar
  **Today's note** button.
- `ingest-reports/` — auto-generated reports each time you ingest a
  source.

## Quick start

1. Type `[[` anywhere to autocomplete a wikilink to another note.
2. Click **Ingest** in the sidebar to drop a source — Claude will
   integrate it into your wiki with citations.
3. Click **Ask** to question your wiki; answers cite the pages they
   come from.
4. The **Graph** view shows every wikilink across the vault.

Your `wiki/` already holds a few interconnected starter notes (LLM
concepts) so the **Graph** isn't empty on day one — open it to explore,
then delete them whenever you like.

Open Settings → Connections to wire up your LLM provider (Claude CLI,
Anthropic API, OpenAI, Gemini, Ollama, or OpenRouter).
"#;

const VAULT_CLAUDE_MD: &str = r#"# Memex Vault — Maintenance Rules

This vault is maintained by Claude through the Memex desktop app. The
following rules govern how Claude reads and writes files when invoked
with this vault as cwd.

## Directory rules

- `raw/` is **immutable**. Read only. Never edit, rename, or delete.
- `wiki/` is the LLM-maintained area. You own this entirely.
- `daily/` holds daily journals; do not rewrite past dates.
- `ingest-reports/` is append-only.

## Page frontmatter

Every `wiki/` page MUST start with:

```yaml
---
title: "..."
type: source-summary | entity | concept | technique | analysis
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
source_count: N
confidence: high | medium | low
status: active | superseded | disputed
---
```

## Citation rules

- Every factual claim ends with `[^src-<slug>]`.
- Footnote definitions at the bottom point to a `[[source-<slug>]]` page.
- Each citation slug corresponds to a real file in `raw/<slug>.md`.

## On ingest

When the user drops a source via Memex's Ingest page, Claude is called
with the prompt and the new `raw/<slug>.md` already written. Steps:

1. Read the full source.
2. Identify pages in `wiki/` that this source affects.
3. Update those pages with new claims + citations.
4. Create the `wiki/source-<slug>.md` summary (300–500 words).
5. Update `wiki/index.md` (catalog) and append to `wiki/log.md`.
6. Write `ingest-reports/<datetime>-<slug>.md` with the WHY.
"#;

const WIKI_INDEX: &str = r#"# Index

Catalog of all wiki pages, grouped by type. These starter notes ship with a
fresh vault so the Graph has something to show — delete them anytime.

## Sources
- [[source-attention-is-all-you-need]] — the 2017 paper that introduced the transformer
- [[source-scaling-laws-paper]] — power-law scaling of loss with size and compute

## Entities
- [[openai]] — AI research lab
- [[anthropic]] — AI safety lab

## Concepts
- [[transformer-architecture]] — attention-based neural network architecture
- [[scaling-laws]] — loss as a power law in size, data, and compute
- [[embeddings]] — tokens as vectors in a semantic space
- [[alignment]] — making model behaviour match human intent

## Techniques
- [[attention-mechanism]] — weigh every token against every other
- [[tokenization]] — split text into model-readable units
- [[rlhf]] — preference-based fine-tuning for alignment
- [[fine-tuning]] — specialise a pretrained model

## Analyses
- [[analysis-scaling-vs-data]] — does scale or data quality matter more?
"#;

const WIKI_LOG: &str = r#"# Log

Chronological record of vault activity.
"#;

pub fn open_vault(path: &str) -> Result<VaultMeta, String> {
    if path.is_empty() {
        return Err("vault path is empty".into());
    }

    let candidate = Path::new(path);
    if !candidate.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    if !candidate.is_dir() {
        return Err(format!("not a directory: {path}"));
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize {path}: {e}"))?;

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    Ok(VaultMeta {
        path: canonical.to_string_lossy().into_owned(),
        name,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub frontmatter: serde_json::Value,
}

pub fn read_file(path: &str) -> Result<FileContent, String> {
    let resolved = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed for {path}: {e}"))?;
    if !resolved.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let raw = std::fs::read_to_string(&resolved).map_err(|e| format!("read failed: {e}"))?;
    let (frontmatter, content) =
        match gray_matter::Matter::<gray_matter::engine::YAML>::new().parse(&raw) {
            Ok(parsed) => {
                let fm = parsed
                    .data
                    .map(pod_to_json)
                    .unwrap_or(serde_json::Value::Null);
                (fm, parsed.content)
            }
            Err(_) => (serde_json::Value::Null, raw.clone()),
        };
    Ok(FileContent {
        path: resolved.to_string_lossy().into_owned(),
        content,
        frontmatter,
    })
}

fn pod_to_json(pod: gray_matter::Pod) -> serde_json::Value {
    use gray_matter::Pod;
    use serde_json::{Map, Number, Value};
    match pod {
        Pod::Null => Value::Null,
        Pod::String(s) => Value::String(s),
        Pod::Boolean(b) => Value::Bool(b),
        Pod::Integer(i) => Value::Number(Number::from(i)),
        Pod::Float(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
        Pod::Array(arr) => Value::Array(arr.into_iter().map(pod_to_json).collect()),
        Pod::Hash(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                out.insert(k, pod_to_json(v));
            }
            Value::Object(out)
        }
    }
}

pub fn create_file(parent: &str, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let parent_path = Path::new(parent);
    if !parent_path.is_dir() {
        return Err(format!("parent is not a directory: {parent}"));
    }
    let target = parent_path.join(name);
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    std::fs::write(&target, "").map_err(|e| format!("create failed: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn create_folder(parent: &str, name: &str) -> Result<String, String> {
    validate_name(name)?;
    let parent_path = Path::new(parent);
    if !parent_path.is_dir() {
        return Err(format!("parent is not a directory: {parent}"));
    }
    let target = parent_path.join(name);
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    std::fs::create_dir(&target).map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

pub fn delete_path(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("not found: {path}"));
    }
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| format!("rmdir failed: {e}"))
    } else {
        std::fs::remove_file(target).map_err(|e| format!("rm failed: {e}"))
    }
}

pub fn rename_path(from: &str, to_name: &str) -> Result<String, String> {
    validate_name(to_name)?;
    let src = Path::new(from);
    if !src.exists() {
        return Err(format!("not found: {from}"));
    }
    let parent = src.parent().ok_or_else(|| "no parent dir".to_string())?;
    let target = parent.join(to_name);
    if target.exists() {
        return Err(format!("destination exists: {}", target.display()));
    }
    std::fs::rename(src, &target).map_err(|e| format!("rename failed: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("name is empty".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("name contains invalid characters".into());
    }
    if name == "." || name == ".." {
        return Err("name reserved".into());
    }
    Ok(())
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| format!("no parent dir for {path}"))?;
    if !parent.exists() {
        return Err(format!("parent does not exist: {}", parent.display()));
    }

    use std::io::Write;
    let mut tmp = tempfile::Builder::new()
        .prefix(".memex-tmp-")
        .suffix(".md")
        .tempfile_in(parent)
        .map_err(|e| format!("tempfile create failed: {e}"))?;
    tmp.write_all(content.as_bytes())
        .map_err(|e| format!("tempfile write failed: {e}"))?;
    tmp.as_file_mut()
        .sync_all()
        .map_err(|e| format!("tempfile sync failed: {e}"))?;
    tmp.persist(target)
        .map_err(|e| format!("rename failed: {}", e.error))?;
    Ok(())
}

pub fn list_files(root: &str) -> Result<Vec<FileNode>, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed for {root}: {e}"))?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    walk_dir(&root_path).map_err(|e| format!("walk failed: {e}"))
}

/// Flat (path, mtime_unix_seconds) list for every .md file under root.
/// Drives the graph timelapse — nodes are revealed in mtime order.
pub fn file_mtimes(root: &str) -> Result<Vec<(String, i64)>, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed for {root}: {e}"))?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let mut out = Vec::new();
    collect_mtimes(&root_path, &mut out).map_err(|e| format!("walk failed: {e}"))?;
    Ok(out)
}

fn collect_mtimes(dir: &Path, out: &mut Vec<(String, i64)>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        if is_hidden(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_mtimes(&path, out)?;
        } else if is_markdown(&path) {
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            out.push((path.to_string_lossy().into_owned(), mtime));
        }
    }
    Ok(())
}

fn walk_dir(dir: &Path) -> std::io::Result<Vec<FileNode>> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| !is_hidden(&e.file_name()))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut nodes = Vec::with_capacity(entries.len());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let path_str = path.to_string_lossy().into_owned();
        if path.is_dir() {
            // Always emit directories, including empty ones, so the seeded
            // scaffold folders (raw/, ingest-reports/) are visible and
            // navigable before they contain any .md file — like Obsidian.
            let children = walk_dir(&path)?;
            nodes.push(FileNode::Directory {
                name,
                path: path_str,
                children,
            });
        } else if is_markdown(&path) {
            nodes.push(FileNode::File {
                name,
                path: path_str,
            });
        }
    }
    Ok(nodes)
}

/// Concatenate the vault's markdown (CLAUDE.md schema + wiki/ + raw/) into a
/// single text blob, bounded to `max_bytes`. This lets non-tool providers
/// (Anthropic/OpenAI/Google/Ollama HTTP APIs) answer questions and run lint
/// against real vault content. Tool-capable providers (the Claude CLI) read
/// files directly and never need this.
pub fn read_vault_context(root: &str, max_bytes: usize) -> Result<String, String> {
    let root_path = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed for {root}: {e}"))?;
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    let claude = root_path.join("CLAUDE.md");
    if claude.is_file() {
        files.push(claude);
    }
    for sub in ["wiki", "raw"] {
        let dir = root_path.join(sub);
        if dir.is_dir() {
            collect_markdown(&dir, &mut files).map_err(|e| format!("walk failed: {e}"))?;
        }
    }
    files.sort();
    files.dedup();

    let mut out = String::new();
    let mut truncated = false;
    for path in files {
        if out.len() >= max_bytes {
            truncated = true;
            break;
        }
        let rel = path.strip_prefix(&root_path).unwrap_or(&path);
        let body = match std::fs::read_to_string(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        out.push_str(&format!("\n\n===== {} =====\n", rel.to_string_lossy()));
        let remaining = max_bytes.saturating_sub(out.len());
        if body.len() > remaining {
            out.push_str(safe_truncate(&body, remaining));
            out.push_str("\n…(truncated)…");
            truncated = true;
            break;
        }
        out.push_str(&body);
    }
    if truncated {
        out.push_str("\n\n(Note: vault context was truncated to fit the size budget.)");
    }
    Ok(out)
}

fn collect_markdown(dir: &Path, out: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        if is_hidden(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_markdown(&path, out)?;
        } else if is_markdown(&path) {
            out.push(path);
        }
    }
    Ok(())
}

/// Largest prefix of `s` no longer than `max` bytes that ends on a UTF-8 char
/// boundary (so we never slice a multi-byte character in half).
fn safe_truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn is_hidden(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|s| s.starts_with('.') || s == "node_modules" || s == "target")
}

fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("md")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;

    #[test]
    fn open_vault_rejects_empty() {
        assert!(open_vault("").is_err());
    }

    #[test]
    fn open_vault_rejects_missing_path() {
        let missing = env::temp_dir().join("memex-does-not-exist-xyz");
        assert!(open_vault(missing.to_str().unwrap()).is_err());
    }

    #[test]
    fn open_vault_returns_meta_for_existing_dir() {
        let tmp = env::temp_dir();
        let meta = open_vault(tmp.to_str().unwrap()).unwrap();
        assert!(!meta.name.is_empty());
        assert!(!meta.path.is_empty());
    }

    fn temp_vault(name: &str) -> std::path::PathBuf {
        let dir = env::temp_dir().join(format!("memex-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn list_files_returns_only_markdown() {
        let dir = temp_vault("list");
        fs::write(dir.join("note.md"), "# hi").unwrap();
        fs::write(dir.join("ignored.txt"), "x").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/inner.md"), "# inner").unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/secret.md"), "x").unwrap();

        let nodes = list_files(dir.to_str().unwrap()).unwrap();

        let names: Vec<&str> = nodes
            .iter()
            .map(|n| match n {
                FileNode::File { name, .. } => name.as_str(),
                FileNode::Directory { name, .. } => name.as_str(),
            })
            .collect();
        assert_eq!(names, vec!["note.md", "sub"]);
    }

    #[test]
    fn read_file_parses_yaml_frontmatter() {
        let dir = temp_vault("read");
        let p = dir.join("a.md");
        fs::write(
            &p,
            "---\ntitle: Hello\ntags:\n  - alpha\n  - beta\n---\n# Body\n",
        )
        .unwrap();
        let fc = read_file(p.to_str().unwrap()).unwrap();
        assert!(fc.content.starts_with("# Body"));
        assert_eq!(fc.frontmatter["title"], "Hello");
        assert_eq!(fc.frontmatter["tags"][0], "alpha");
    }

    #[test]
    fn read_file_handles_missing_frontmatter() {
        let dir = temp_vault("read-plain");
        let p = dir.join("a.md");
        fs::write(&p, "no frontmatter here").unwrap();
        let fc = read_file(p.to_str().unwrap()).unwrap();
        assert_eq!(fc.content, "no frontmatter here");
        assert!(fc.frontmatter.is_null());
    }

    #[test]
    fn write_file_replaces_atomically() {
        let dir = temp_vault("write");
        let p = dir.join("note.md");
        fs::write(&p, "old").unwrap();
        write_file(p.to_str().unwrap(), "new content").unwrap();
        let actual = fs::read_to_string(&p).unwrap();
        assert_eq!(actual, "new content");
    }

    #[test]
    fn write_file_creates_new_file() {
        let dir = temp_vault("write-new");
        let p = dir.join("brand-new.md");
        write_file(p.to_str().unwrap(), "fresh").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "fresh");
    }

    #[test]
    fn write_file_fails_if_parent_missing() {
        let p = env::temp_dir().join("memex-no-parent-xyz/file.md");
        assert!(write_file(p.to_str().unwrap(), "x").is_err());
    }

    #[test]
    fn create_file_writes_empty_md() {
        let dir = temp_vault("create-file");
        let path = create_file(dir.to_str().unwrap(), "alpha.md").unwrap();
        assert!(std::path::Path::new(&path).exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn create_file_rejects_collision() {
        let dir = temp_vault("create-file-collide");
        fs::write(dir.join("x.md"), "old").unwrap();
        assert!(create_file(dir.to_str().unwrap(), "x.md").is_err());
    }

    #[test]
    fn create_folder_rejects_traversal() {
        let dir = temp_vault("create-folder");
        assert!(create_folder(dir.to_str().unwrap(), "../escape").is_err());
        assert!(create_folder(dir.to_str().unwrap(), "ok").is_ok());
    }

    #[test]
    fn delete_path_removes_file_and_dir() {
        let dir = temp_vault("del");
        let f = dir.join("a.md");
        fs::write(&f, "x").unwrap();
        delete_path(f.to_str().unwrap()).unwrap();
        assert!(!f.exists());
        let sub = dir.join("sub");
        fs::create_dir_all(sub.join("inner")).unwrap();
        delete_path(sub.to_str().unwrap()).unwrap();
        assert!(!sub.exists());
    }

    #[test]
    fn rename_path_moves_within_parent() {
        let dir = temp_vault("ren");
        fs::write(dir.join("old.md"), "x").unwrap();
        let new_path = rename_path(dir.join("old.md").to_str().unwrap(), "new.md").unwrap();
        assert!(std::path::Path::new(&new_path).exists());
        assert!(!dir.join("old.md").exists());
    }

    #[test]
    fn seed_vault_creates_full_layout() {
        let dir = temp_vault("seed");
        seed_vault(&dir).unwrap();
        for sub in ["raw", "wiki", "daily", "ingest-reports"] {
            assert!(dir.join(sub).is_dir(), "missing {sub}/");
        }
        for file in ["welcome.md", "CLAUDE.md", "wiki/index.md", "wiki/log.md"] {
            assert!(dir.join(file).is_file(), "missing {file}");
        }
    }

    #[test]
    fn seed_vault_preserves_existing_files() {
        let dir = temp_vault("seed-preserve");
        seed_vault(&dir).unwrap();
        // User edits the welcome note.
        fs::write(dir.join("welcome.md"), "user edits here\n").unwrap();
        // Re-seed (e.g. on relaunch).
        seed_vault(&dir).unwrap();
        let contents = fs::read_to_string(dir.join("welcome.md")).unwrap();
        assert_eq!(
            contents, "user edits here\n",
            "must not clobber user content"
        );
    }

    #[test]
    fn seed_vault_writes_sample_graph() {
        let dir = temp_vault("seed-sample");
        seed_vault(&dir).unwrap();
        assert!(dir.join("wiki/transformer-architecture.md").is_file());
        assert!(dir.join("wiki/source-attention-is-all-you-need.md").is_file());
        // The starter notes cross-link, so the link graph has resolved edges.
        let adj = crate::index::build_link_graph(dir.to_str().unwrap()).unwrap();
        assert!(
            adj.forward.values().any(|v| !v.is_empty()),
            "sample notes should form resolved graph edges"
        );
    }

    #[test]
    fn list_files_shows_empty_dirs() {
        let dir = temp_vault("empty");
        fs::create_dir_all(dir.join("only-empty")).unwrap();
        fs::write(dir.join("a.md"), "x").unwrap();

        let nodes = list_files(dir.to_str().unwrap()).unwrap();
        // Empty directories are now shown so seeded scaffold folders (raw/,
        // ingest-reports/) are visible. Sorted by name: "a.md" then "only-empty".
        assert_eq!(nodes.len(), 2);
        assert!(matches!(&nodes[0], FileNode::File { name, .. } if name == "a.md"));
        assert!(
            matches!(&nodes[1], FileNode::Directory { name, children, .. } if name == "only-empty" && children.is_empty())
        );
    }

    #[test]
    fn read_vault_context_concatenates_wiki_and_truncates() {
        let dir = temp_vault("ctx");
        fs::create_dir_all(dir.join("wiki")).unwrap();
        fs::write(dir.join("CLAUDE.md"), "schema rules").unwrap();
        fs::write(dir.join("wiki/alpha.md"), "alpha body").unwrap();
        fs::write(dir.join("wiki/beta.md"), "beta body").unwrap();

        let full = read_vault_context(dir.to_str().unwrap(), 100_000).unwrap();
        assert!(full.contains("schema rules"));
        assert!(full.contains("alpha body"));
        assert!(full.contains("beta body"));
        assert!(full.contains("CLAUDE.md"));

        // Tiny budget forces truncation without panicking on char boundaries.
        let small = read_vault_context(dir.to_str().unwrap(), 20).unwrap();
        assert!(small.contains("truncated"));
    }
}
