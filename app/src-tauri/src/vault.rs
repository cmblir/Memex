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
            let children = walk_dir(&path)?;
            if !children.is_empty() {
                nodes.push(FileNode::Directory {
                    name,
                    path: path_str,
                    children,
                });
            }
        } else if is_markdown(&path) {
            nodes.push(FileNode::File {
                name,
                path: path_str,
            });
        }
    }
    Ok(nodes)
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
    fn list_files_skips_empty_dirs() {
        let dir = temp_vault("empty");
        fs::create_dir_all(dir.join("only-empty")).unwrap();
        fs::write(dir.join("a.md"), "x").unwrap();

        let nodes = list_files(dir.to_str().unwrap()).unwrap();
        assert_eq!(nodes.len(), 1);
        assert!(matches!(nodes[0], FileNode::File { .. }));
    }
}
