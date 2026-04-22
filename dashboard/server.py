#!/usr/bin/env python3
"""
LLM Wiki Dashboard Server
- 대시보드 HTML 서빙
- Claude CLI / Obsidian 연결 상태 확인
- Ingest, Query, Lint, 폴더/페이지 CRUD API
- 의존성 없음 (Python 3.10+ stdlib only)
"""

import json, os, re, shutil, subprocess, sys, time, threading, urllib.parse
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from provenance import build_provenance_graph
from index_strategy import get_strategy, get_index_instruction, rebuild_index
from pathlib import Path

PORT = 8090
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
WIKI_DIR = PROJECT_ROOT / "wiki"
RAW_DIR = PROJECT_ROOT / "raw"

# subprocess가 claude CLI를 찾을 수 있도록 PATH 보장
_claude = shutil.which("claude")
if not _claude:
    # nvm, homebrew 등 일반적인 경로 추가
    for p in [os.path.expanduser("~/.nvm/versions/node"), "/usr/local/bin", "/opt/homebrew/bin"]:
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                if "claude" in files:
                    os.environ["PATH"] = root + ":" + os.environ.get("PATH", "")
                    _claude = os.path.join(root, "claude")
                    break
            if _claude:
                break

CLAUDE_TOOLS = "Edit,Write,Read,Glob,Grep"
CLAUDE_TIMEOUT = 180

RAW_ABS = os.path.abspath(str(RAW_DIR))


# ─── raw/ 보호 ───

def assert_writable(path):
    """raw/ 디렉토리 쓰기 차단. raw/는 불변."""
    abs_path = os.path.abspath(str(path))
    if abs_path.startswith(RAW_ABS + os.sep) or abs_path == RAW_ABS:
        raise PermissionError(f"raw/ is immutable: {path}")


def assert_raw_create_only(path):
    """raw/에 새 파일 생성만 허용 (기존 파일 수정/덮어쓰기 금지)."""
    abs_path = os.path.abspath(str(path))
    if not abs_path.startswith(RAW_ABS + os.sep):
        return  # raw/ 밖이면 패스
    if os.path.exists(abs_path):
        raise PermissionError(f"raw/ file already exists (immutable): {path}")


def dedupe_raw_path(raw_path: Path) -> Path:
    """raw/에 동일 파일명 있으면 -2, -3 등으로 자동 변경."""
    if not raw_path.exists():
        return raw_path
    stem = raw_path.stem
    suffix = raw_path.suffix
    parent = raw_path.parent
    n = 2
    while True:
        candidate = parent / f"{stem}-{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def _snapshot_raw():
    """raw/ 파일 해시 스냅샷 (변경 감지용)"""
    snap = {}
    for f in RAW_DIR.rglob("*"):
        if f.is_file() and not f.name.startswith("."):
            snap[str(f.relative_to(PROJECT_ROOT))] = f.stat().st_mtime
    return snap


_raw_snapshot_at_start = _snapshot_raw()


def check_raw_integrity():
    """raw/ 변경 감지 → 변경된 파일 리스트 반환"""
    current = _snapshot_raw()
    modified = []
    for path, mtime in _raw_snapshot_at_start.items():
        if path in current and current[path] != mtime:
            modified.append(path)
    deleted = [p for p in _raw_snapshot_at_start if p not in current]
    return {"modified": modified, "deleted": deleted, "ok": not modified and not deleted}


# ─── GitManager ───

class GitManager:
    def __init__(self):
        self.root = str(PROJECT_ROOT)
        # git repo가 아니면 초기화
        if not (PROJECT_ROOT / ".git").is_dir():
            self._run("init")
            self._run("add", "-A")
            self._run("commit", "-m", "init: wiki bootstrap")

    def _run(self, *args):
        r = subprocess.run(
            ["git"] + list(args),
            capture_output=True, text=True, cwd=self.root,
        )
        return r

    def _stage_all(self):
        """wiki/ + raw/ + ingest-reports/ 변경사항 스테이징"""
        self._run("add", "wiki/", "raw/")
        if (PROJECT_ROOT / "ingest-reports").is_dir():
            self._run("add", "ingest-reports/")

    def commit_ingest(self, source_name):
        """ingest 완료 후 커밋. commit hash 반환."""
        self._stage_all()
        # 변경이 없으면 스킵
        status = self._run("diff", "--cached", "--name-only")
        files = [f for f in status.stdout.strip().split("\n") if f]
        if not files:
            return {"hash": None, "files": []}
        msg = f"ingest: {source_name}"
        self._run("commit", "-m", msg)
        log = self._run("log", "-1", "--format=%H")
        return {"hash": log.stdout.strip(), "files": files}

    def commit_query_save(self, question):
        self._stage_all()
        msg = f"query: {question[:80]}"
        self._run("commit", "-m", msg)
        log = self._run("log", "-1", "--format=%H")
        return log.stdout.strip()

    def commit_lint_fix(self):
        self._stage_all()
        msg = "lint: auto-fix"
        self._run("commit", "-m", msg)
        log = self._run("log", "-1", "--format=%H")
        return log.stdout.strip()

    def list_ingests(self, limit=50):
        """ingest: 커밋만 추출 → [{hash, source, date, files_changed}]"""
        log = self._run(
            "log", f"--max-count={limit}", "--format=%H|%s|%aI",
            "--grep=^ingest:", "--extended-regexp",
        )
        results = []
        for line in log.stdout.strip().split("\n"):
            if not line or "|" not in line:
                continue
            parts = line.split("|", 2)
            if len(parts) < 3:
                continue
            h, subject, date = parts
            # 변경 파일 수
            stat = self._run("diff-tree", "--no-commit-id", "--name-only", "-r", h)
            files = [f for f in stat.stdout.strip().split("\n") if f]
            source = subject.replace("ingest: ", "", 1)
            results.append({
                "hash": h,
                "hash_short": h[:8],
                "source": source,
                "date": date[:19].replace("T", " "),
                "files_changed": len(files),
                "files": files,
            })
        return results

    def revert_ingest(self, commit_hash):
        """해당 커밋만 revert (git revert --no-edit)"""
        # 안전: ingest 커밋인지 확인
        log = self._run("log", "-1", "--format=%s", commit_hash)
        subject = log.stdout.strip()
        if not subject.startswith("ingest:"):
            return {"ok": False, "error": f"Not an ingest commit: {subject}"}
        r = self._run("revert", "--no-edit", commit_hash)
        if r.returncode != 0:
            # conflict 발생 시
            self._run("revert", "--abort")
            return {"ok": False, "error": f"Revert conflict: {r.stderr[:300]}"}
        new_log = self._run("log", "-1", "--format=%H|%s")
        parts = new_log.stdout.strip().split("|", 1)
        return {"ok": True, "revert_hash": parts[0], "message": parts[1] if len(parts) > 1 else ""}


git_mgr = GitManager()

# ─── helpers ───

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
LOG_ENTRY_RE = re.compile(r"^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$", re.MULTILINE)


def parse_fm(text):
    meta, body = {}, text
    m = FRONTMATTER_RE.match(text)
    if not m:
        return meta, body
    body = text[m.end():]
    raw = m.group(1)
    for ml in re.finditer(r"^(\w+):\s*\n((?:\s+-\s+.+\n?)+)", raw, re.MULTILINE):
        meta[ml.group(1)] = [x.strip().strip("'\"") for x in re.findall(r"-\s+(.+)", ml.group(2))]
    for line in raw.strip().split("\n"):
        if ":" not in line or line.startswith("  "):
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if k in meta:
            continue
        lm = re.search(r"\[(.*?)\]", v)
        if lm:
            meta[k] = [x.strip().strip("'\"") for x in lm.group(1).split(",") if x.strip()]
        elif v:
            meta[k] = v.strip("'\"")
    return meta, body


def extract_links(body):
    return sorted({m.group(1).strip() + (".md" if not m.group(1).strip().endswith(".md") else "") for m in WIKILINK_RE.finditer(body)})


def run_claude(prompt):
    """claude -p 실행 → (ok, output, error)"""
    try:
        r = subprocess.run(
            ["claude", "-p", "--allowedTools", CLAUDE_TOOLS, "--output-format", "text", prompt],
            capture_output=True, text=True, timeout=CLAUDE_TIMEOUT,
            cwd=str(PROJECT_ROOT),
        )
        return (r.returncode == 0, r.stdout[:4000], r.stderr[:500] if r.returncode != 0 else "")
    except subprocess.TimeoutExpired:
        return (False, "", f"Claude CLI timeout ({CLAUDE_TIMEOUT}s)")
    except FileNotFoundError:
        return (False, "", "claude CLI not found")


def run_claude_tracked(prompt):
    """claude -p를 stream-json으로 실행하여 Read 호출을 추적.
    → (ok, answer, error, files_read, token_usage)"""
    try:
        r = subprocess.run(
            ["claude", "-p", "--allowedTools", CLAUDE_TOOLS,
             "--output-format", "stream-json", "--verbose", prompt],
            capture_output=True, text=True, timeout=CLAUDE_TIMEOUT,
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        return (False, "", f"Claude CLI timeout ({CLAUDE_TIMEOUT}s)", [], {})
    except FileNotFoundError:
        return (False, "", "claude CLI not found", [], {})

    files_read = []
    answer = ""
    token_usage = {}

    for line in r.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            evt = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Read tool result → filePath 추출
        if evt.get("type") == "user":
            msg = evt.get("message", {})
            tur = evt.get("tool_use_result")
            if tur and isinstance(tur, dict):
                fp = tur.get("file", {}).get("filePath", "")
                if fp:
                    # 프로젝트 상대경로로 변환
                    try:
                        rel = str(Path(fp).relative_to(PROJECT_ROOT))
                    except ValueError:
                        rel = fp
                    if rel not in files_read:
                        files_read.append(rel)
            # content 배열에서도 탐색 (tool_result)
            content = msg.get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        # 이건 이미 위에서 처리
                        pass

        # result 이벤트 → answer + usage
        if evt.get("type") == "result":
            answer = evt.get("result", "")
            token_usage = {
                "input_tokens": evt.get("usage", {}).get("input_tokens", 0),
                "output_tokens": evt.get("usage", {}).get("output_tokens", 0),
                "cost_usd": evt.get("total_cost_usd", 0),
            }

    ok = r.returncode == 0
    return (ok, answer[:4000], r.stderr[:500] if not ok else "", files_read, token_usage)


QUERY_LOG = PROJECT_ROOT / "query-log.jsonl"


def _log_query(question, files_read, wiki_ratio, answer_length):
    entry = {
        "timestamp": datetime.now().isoformat(),
        "question": question[:200],
        "files_read": files_read,
        "wiki_ratio": wiki_ratio,
        "answer_length": answer_length,
    }
    with open(QUERY_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _get_query_stats(n=20):
    """최근 n개 쿼리의 wiki_ratio 평균"""
    if not QUERY_LOG.exists():
        return {"avg_wiki_ratio": None, "count": 0}
    lines = QUERY_LOG.read_text("utf-8").strip().split("\n")
    recent = []
    for line in reversed(lines):
        if not line:
            continue
        try:
            recent.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(recent) >= n:
            break
    if not recent:
        return {"avg_wiki_ratio": None, "count": 0}
    ratios = [e["wiki_ratio"] for e in recent if e.get("wiki_ratio") is not None]
    avg = sum(ratios) / len(ratios) if ratios else 0
    return {"avg_wiki_ratio": round(avg, 3), "count": len(recent)}


# ─── wiki data ───

def build_wiki_data():
    pages, nodes, edges = [], [], []
    type_counts, node_ids = {}, set()
    for md in sorted(WIKI_DIR.rglob("*.md")):
        rel = md.relative_to(WIKI_DIR)
        filename = str(rel)
        text = md.read_text(encoding="utf-8")
        meta, body = parse_fm(text)
        links = extract_links(body)
        pt = meta.get("type", "unknown")
        type_counts[pt] = type_counts.get(pt, 0) + 1
        folder = str(rel.parent) if rel.parent != Path(".") else ""
        pages.append({
            "filename": filename, "folder": folder,
            "title": meta.get("title", md.stem.replace("-", " ").title()),
            "type": pt, "created": meta.get("created", ""), "updated": meta.get("updated", ""),
            "tags": meta.get("tags", []), "sources": meta.get("sources", []),
            "links": links, "word_count": len(body.split()), "content": body.strip(),
        })
        node_ids.add(filename)
        nodes.append({"id": filename, "label": meta.get("title", md.stem), "type": pt})
        for lnk in links:
            edges.append({"from": filename, "to": lnk})
    for e in edges:
        if e["to"] not in node_ids:
            node_ids.add(e["to"])
            nodes.append({"id": e["to"], "label": e["to"].replace(".md", "").replace("-", " ").title(), "type": "missing"})
    log_entries = []
    lf = WIKI_DIR / "log.md"
    if lf.exists():
        _, lb = parse_fm(lf.read_text("utf-8"))
        log_entries = [{"date": m.group(1), "action": m.group(2), "title": m.group(3)} for m in LOG_ENTRY_RE.finditer(lb)]
    raw_count = sum(1 for f in RAW_DIR.rglob("*") if f.is_file() and not f.name.startswith(".") and "assets" not in f.parts) if RAW_DIR.exists() else 0
    return {
        "pages": pages,
        "graph": {"nodes": nodes, "edges": edges},
        "log": log_entries,
        "stats": {"total_pages": len(pages), "raw_sources": raw_count, "type_counts": type_counts, "total_links": len(edges), "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M")},
    }


def get_folder_tree():
    tree = {"name": "wiki", "path": "", "children": [], "pages": []}
    for f in sorted(WIKI_DIR.glob("*.md")):
        tree["pages"].append(f.name)
    for d in sorted(WIKI_DIR.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            sub = {"name": d.name, "path": d.name, "children": [], "pages": []}
            for f in sorted(d.rglob("*.md")):
                sub["pages"].append(str(f.relative_to(WIKI_DIR)))
            for sd in sorted(d.iterdir()):
                if sd.is_dir() and not sd.name.startswith("."):
                    sub["children"].append({"name": sd.name, "path": str(sd.relative_to(WIKI_DIR)), "pages": [str(f.relative_to(WIKI_DIR)) for f in sorted(sd.rglob("*.md"))]})
            tree["children"].append(sub)
    return tree


def wiki_hash():
    """wiki/ 변경 감지용 간단 해시 — 파일 수 + 총 mtime"""
    total = 0
    count = 0
    for md in WIKI_DIR.rglob("*.md"):
        total += int(md.stat().st_mtime * 1000)
        count += 1
    return f"{count}:{total}"


# ─── status ───

def check_status():
    claude_ok, claude_ver = False, ""
    try:
        r = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            claude_ok = True
            claude_ver = r.stdout.strip().split("\n")[0]
    except Exception:
        pass
    obsidian_ok = False
    try:
        r = subprocess.run(["pgrep", "-x", "Obsidian"], capture_output=True, timeout=3)
        obsidian_ok = r.returncode == 0
    except Exception:
        pass
    return {"claude": {"connected": claude_ok, "version": claude_ver}, "obsidian": {"connected": obsidian_ok}}


# ─── operations ───

def _snapshot_wiki():
    """wiki/ 전체 파일의 내용을 dict로 스냅샷"""
    snap = {}
    for md in WIKI_DIR.rglob("*.md"):
        rel = str(md.relative_to(PROJECT_ROOT))
        try:
            snap[rel] = md.read_text("utf-8")
        except Exception:
            pass
    return snap


def _diff_snapshots(before, after):
    """before/after 스냅샷 비교 → created_pages, modified_pages"""
    import difflib
    created, modified = [], []
    for path, content in after.items():
        if path not in before:
            # 새 파일 — preview 첫 10줄
            lines = content.strip().split("\n")
            preview = "\n".join(lines[:12])
            created.append({"path": path, "preview_text": preview})
        elif before[path] != content:
            # 수정된 파일 — unified diff
            diff = difflib.unified_diff(
                before[path].splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"a/{path}", tofile=f"b/{path}", lineterm="",
            )
            modified.append({"path": path, "diff_unified": "\n".join(diff)})
    return created, modified


def do_ingest(title, content, folder=""):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or f"source-{int(time.time())}"
    raw_path = dedupe_raw_path(RAW_DIR / f"{slug}.md")
    raw_path.write_text(content, encoding="utf-8")
    slug = raw_path.stem  # dedupe로 변경됐을 수 있으므로 갱신

    # 1) 스냅샷 before
    snap_before = _snapshot_wiki()

    # 2) 프롬프트: ingest + reasoning + report
    ts = datetime.now().strftime("%Y-%m-%d-%H%M")
    report_path = f"ingest-reports/{ts}-{slug}.md"
    folder_inst = f" wiki/{folder}/ 폴더 하위에 페이지를 생성해." if folder else ""
    idx_inst = get_index_instruction(WIKI_DIR)

    prompt = f"""{idx_inst}
중요: raw/ 디렉토리의 파일을 절대 수정/삭제하지 마라. raw/는 불변이다. wiki/에만 쓰기.
Ingest raw/{slug}.md — 이 소스를 읽고 CLAUDE.md 지침대로 wiki 페이지들을 생성/갱신해. 핵심 내용 논의는 생략하고 바로 실행해.{folder_inst}

작업이 끝나면:
1. 마지막에 왜 이런 판단을 했는지 3~5줄로 요약해 (REASONING: 으로 시작).
2. {report_path} 파일을 생성해. 형식:
# Ingest Report: {title}
## Created
- wiki/path/file.md — WHY: 1줄 이유
## Modified
- wiki/path/file.md — WHY: 1줄 이유
## New cross-links
- [[a]] ↔ [[b]]"""

    ok, out, err = run_claude(prompt)

    # 2.5) 인덱스 재빌드 (전략에 따라)
    if ok:
        rebuild_index(WIKI_DIR)

    # 3) 스냅샷 after + diff
    snap_after = _snapshot_wiki()
    created, modified = _diff_snapshots(snap_before, snap_after)

    # 4) reasoning 추출
    reasoning = ""
    if "REASONING:" in out:
        reasoning = out.split("REASONING:")[-1].strip()

    # 5) 자동 커밋
    commit_hash = None
    if ok:
        c = git_mgr.commit_ingest(title)
        commit_hash = c.get("hash")

    return {
        "ok": ok,
        "raw_file": f"raw/{slug}.md",
        "claude_output": out,
        "error": err,
        "commit_hash": commit_hash,
        "created_pages": created,
        "modified_pages": modified,
        "reasoning": reasoning,
        "report_path": report_path,
    }


def do_query(question):
    idx_inst = get_index_instruction(WIKI_DIR)
    prompt = f"""다음 질문에 답해. {idx_inst}
관련 wiki 페이지를 찾아 읽은 뒤 답변을 합성해.
답변에 관련 위키 페이지를 [[wikilink]]로 인용해.
질문: {question}"""
    ok, answer, err, files_read, token_usage = run_claude_tracked(prompt)

    # wiki_ratio 계산
    wiki_files = [f for f in files_read if f.startswith("wiki/")]
    raw_files = [f for f in files_read if f.startswith("raw/")]
    total = len(files_read)
    wiki_ratio = len(wiki_files) / total if total > 0 else 0.0

    # 로그 기록
    _log_query(question, files_read, round(wiki_ratio, 3), len(answer))

    return {
        "ok": ok, "answer": answer, "error": err,
        "files_read": files_read,
        "wiki_files": len(wiki_files),
        "raw_files": len(raw_files),
        "wiki_ratio": round(wiki_ratio, 3),
        "token_usage": token_usage,
    }


def do_query_save(title, content):
    """Query 답변을 wiki에 analysis 페이지로 저장"""
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    filepath = WIKI_DIR / f"{slug}.md"
    today = datetime.now().strftime("%Y-%m-%d")
    md = f"""---
title: "{title}"
type: analysis
created: {today}
updated: {today}
sources: []
tags:
  - query-result
---

{content}
"""
    filepath.write_text(md, encoding="utf-8")
    # index, log 갱신은 claude에게 맡김
    prompt = f"wiki/{slug}.md 페이지를 방금 생성했다. wiki/index.md의 Analyses 섹션에 이 페이지를 추가하고, wiki/log.md에 query 로그를 남기고, wiki/overview.md 통계를 갱신해."
    run_claude(prompt)
    git_mgr.commit_query_save(title)
    return {"ok": True, "filename": f"{slug}.md"}


def do_fix_citations(page_filename):
    """특정 페이지의 citation을 Claude에게 보완시킴"""
    filepath = WIKI_DIR / page_filename
    if not filepath.exists():
        return {"ok": False, "error": "Page not found"}
    prompt = f"""wiki/{page_filename}을 읽어.
이 페이지에서 주장(claim)을 하는 문장 중 inline citation [^src-*]이 없는 것을 찾아.
각 claim에 적절한 [^src-소스슬러그] citation을 추가해.

규칙:
- citation 형식: 문장 끝에 [^src-소스슬러그]
- 페이지 하단에 정의 추가: [^src-소스슬러그]: [[source-소스슬러그]]
- wiki/index.md의 Sources 섹션에 있는 소스만 사용
- 해당하는 소스가 없으면 citation을 추가하지 마
- 기존 citation은 유지해

수정 후 결과를 보고해."""
    ok, out, err = run_claude(prompt)
    if ok:
        git_mgr._stage_all()
        git_mgr._run("commit", "-m", f"citation: fix {page_filename}")
    return {"ok": ok, "output": out, "error": err}


REFLECT_DIR = PROJECT_ROOT / "reflect-reports"
REFLECT_DIR.mkdir(exist_ok=True)


def _collect_reflect_context(window):
    """window에 따라 log 항목 + ingest-reports 텍스트 수집"""
    # log.md 파싱
    log_file = WIKI_DIR / "log.md"
    log_text = log_file.read_text("utf-8") if log_file.exists() else ""

    # ingest-reports 수집
    report_dir = PROJECT_ROOT / "ingest-reports"
    reports = []
    if report_dir.is_dir():
        for f in sorted(report_dir.glob("*.md"), reverse=True):
            reports.append({"name": f.name, "content": f.read_text("utf-8")[:2000]})

    # query-log.jsonl에서 wiki_ratio 낮은 쿼리 수집
    low_ratio_queries = []
    qlog = PROJECT_ROOT / "query-log.jsonl"
    if qlog.exists():
        for line in qlog.read_text("utf-8").strip().split("\n"):
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("wiki_ratio", 1.0) < 0.5:
                    low_ratio_queries.append(entry)
            except json.JSONDecodeError:
                pass

    # window로 범위 제한
    if window == "last-10-ingests":
        reports = reports[:10]
    elif window == "last-week":
        from datetime import timedelta
        cutoff = (datetime.now() - timedelta(days=7)).isoformat()[:10]
        reports = [r for r in reports if r["name"][:10] >= cutoff]

    return {
        "log_text": log_text[-3000:],  # 최근 3000자
        "reports": reports[:20],
        "low_ratio_queries": low_ratio_queries[:10],
    }


def do_reflect(window="last-10-ingests"):
    ctx = _collect_reflect_context(window)

    reports_summary = "\n\n".join(
        f"### {r['name']}\n{r['content']}" for r in ctx["reports"]
    ) or "(no ingest reports)"

    low_ratio = "\n".join(
        f"- Q: {q['question'][:80]}  (wiki_ratio: {q['wiki_ratio']})"
        for q in ctx["low_ratio_queries"]
    ) or "(none)"

    today = datetime.now().strftime("%Y-%m-%d")
    report_path = f"reflect-reports/{today}.md"

    prompt = f"""다음 데이터를 분석해:

## 최근 Wiki Log (발췌)
{ctx['log_text'][-1500:]}

## Ingest Reports
{reports_summary[:3000]}

## wiki_ratio 낮은 쿼리
{low_ratio}

위 데이터를 바탕으로 다음을 분석해:

1. **SUGGESTED_PAGES**: 반복적으로 등장하는 엔티티/컨셉 중 아직 wiki/에 전용 페이지가 없는 것을 찾아 리스트. 각 항목에 왜 필요한지 1줄.

2. **SUGGESTED_SCHEMA**: 여러 ingest에서 같은 판단 패턴이 보이면, CLAUDE.md에 추가할 규칙을 제안. diff 형태로.

3. **SUGGESTED_SOURCES**: wiki_ratio가 낮았던 쿼리의 주제에 대한 소스가 부족하다는 의미. 해당 주제를 보강할 검색어 리스트를 추천.

4. **CONTRADICTION_REVIEW**: 자주 충돌하는 소스 부류가 있으면 contradiction 정책 보완을 제안.

결과를 {report_path} 파일로 저장해. 형식:
# Reflect Report — {today}
## Suggested Pages
- page-name — 이유
## Suggested Schema Updates
(diff 또는 추가할 규칙 텍스트)
## Suggested Sources
- "검색어" — 이유
## Contradiction Review
(발견 사항 또는 "없음")

또한 각 섹션 제목 앞에 SUGGESTED_PAGES:, SUGGESTED_SCHEMA:, SUGGESTED_SOURCES:, CONTRADICTION_REVIEW: 마커를 넣어 파싱 가능하게 해."""

    ok, out, err = run_claude(prompt)
    if ok:
        git_mgr._stage_all()
        if REFLECT_DIR.is_dir():
            git_mgr._run("add", "reflect-reports/")
        git_mgr._run("commit", "-m", f"reflect: {today} ({window})")

    # 구조화된 섹션 파싱 — report 파일에서 직접 읽음
    sections = {"suggested_pages": "", "suggested_schema": "", "suggested_sources": "", "contradiction_review": ""}
    report_file = PROJECT_ROOT / report_path
    report_text = report_file.read_text("utf-8") if report_file.exists() else out
    # ## SUGGESTED_PAGES: 또는 ## Suggested Pages 형태 모두 처리
    section_patterns = [
        (r"##\s*(?:SUGGESTED_PAGES:?\s*)?Suggested Pages\b", "suggested_pages"),
        (r"##\s*(?:SUGGESTED_SCHEMA:?\s*)?Suggested Schema", "suggested_schema"),
        (r"##\s*(?:SUGGESTED_SOURCES:?\s*)?Suggested Sources", "suggested_sources"),
        (r"##\s*(?:CONTRADICTION_REVIEW:?\s*)?Contradiction Review", "contradiction_review"),
    ]
    import re as _re
    positions = []
    for pattern, key in section_patterns:
        m = _re.search(pattern, report_text, _re.IGNORECASE)
        if m:
            positions.append((m.end(), key))
    positions.sort(key=lambda x: x[0])
    for i, (start, key) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(report_text)
        # 끝에서 다음 ## 헤딩 찾기
        next_heading = _re.search(r"\n##\s", report_text[start:end])
        if next_heading:
            end = start + next_heading.start()
        sections[key] = report_text[start:end].strip().lstrip("#").strip()

    return {
        "ok": ok, "error": err,
        "raw_output": out,
        "report_path": report_path,
        "sections": sections,
    }


def get_last_reflect_date():
    """마지막 reflect-reports 날짜"""
    if not REFLECT_DIR.is_dir():
        return None
    files = sorted(REFLECT_DIR.glob("*.md"), reverse=True)
    if not files:
        return None
    # 파일명: YYYY-MM-DD.md
    return files[0].stem


def do_lint():
    today = datetime.now().strftime("%Y-%m-%d")
    idx_inst = get_index_instruction(WIKI_DIR)
    prompt = f"""{idx_inst}
CLAUDE.md의 "Lint 체크리스트" 섹션을 읽고 wiki 전체를 점검해.

아래 체크리스트를 **모두** 수행:

### 구조 검사
- frontmatter 없거나 type 필드가 허용 값이 아닌 페이지
- status: superseded인데 superseded_by 없는 페이지
- status: disputed인데 ## Disputed 섹션 없는 페이지
- superseded_by가 가리키는 페이지가 존재하지 않음

### Citation 검사
- inline citation [^src-*] 없는 사실적 claim 문장
- 페이지별 citation 비율 (claim 수 대비 cited 수)
- [^src-*] 참조인데 하단에 정의 없음
- 정의된 source-summary 페이지가 wiki/에 없음
- source_count가 실제 citation 수와 불일치

### 연결 검사
- orphan 페이지 (다른 페이지에서 [[wikilink]] 0개)
- 본문에서 언급되었지만 자체 페이지가 없는 컨셉/엔티티
- 관련 페이지인데 상호 링크 없음

### 신선도 검사
- last_updated가 30일 이상 지난 active 페이지 (오늘: {today})
- source_count: 1인데 일반화 주장하는 페이지
- confidence: high인데 source_count < 2인 페이지

보고 형식:
## Lint Report — {today}
### Critical (must fix)
- [ ] page.md — 문제 설명
### Warning (should fix)
- [ ] page.md — 문제 설명
### Info (nice to have)
- [ ] page.md — 문제 설명

각 항목에 수정 제안을 포함해."""
    ok, out, err = run_claude(prompt)
    return {"ok": ok, "report": out, "error": err}


def do_lint_fix():
    prompt = """방금 CLAUDE.md의 Lint 체크리스트로 점검을 했다. 발견된 모든 문제를 지금 수정해:

- frontmatter 누락/불일치 → 올바른 frontmatter 추가/수정
- inline citation 없는 claim → 적절한 [^src-*] 추가 (소스가 존재하는 경우에만)
- source_count 불일치 → 실제 citation 수로 갱신
- last_updated 갱신 → 오늘 날짜로
- orphan 페이지 → 관련 페이지에서 [[wikilink]] 추가
- 누락된 교차참조 추가
- 언급되었지만 페이지 없는 컨셉은 stub 페이지 생성 (최소 1개 citation 포함)
- status/superseded_by 불일치 수정
- disputed 페이지에 ## Disputed 섹션 추가
- index.md, log.md, overview.md 갱신

수정한 내용을 Critical/Warning/Info 별로 요약해서 보고해."""
    ok, out, err = run_claude(prompt)
    if ok:
        git_mgr.commit_lint_fix()
    return {"ok": ok, "result": out, "error": err}


# ─── CRUD ───

def create_folder(name, parent=""):
    base = WIKI_DIR / parent if parent else WIKI_DIR
    folder = base / name
    folder.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": str(folder.relative_to(WIKI_DIR))}


def create_page(title, page_type, folder="", content=""):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    base = WIKI_DIR / folder if folder else WIKI_DIR
    base.mkdir(parents=True, exist_ok=True)
    filepath = base / f"{slug}.md"
    today = datetime.now().strftime("%Y-%m-%d")
    body = content or f"# {title}\n\n<!-- Content will be added here -->"
    md = f"""---
title: "{title}"
type: {page_type}
created: {today}
updated: {today}
sources: []
tags: []
---

{body}
"""
    filepath.write_text(md, encoding="utf-8")
    return {"ok": True, "filename": str(filepath.relative_to(WIKI_DIR))}


def update_page(filename, content):
    filepath = WIKI_DIR / filename
    try:
        assert_writable(filepath)
    except PermissionError as e:
        return {"ok": False, "error": str(e)}
    if not filepath.exists():
        return {"ok": False, "error": "Page not found"}
    filepath.write_text(content, encoding="utf-8")
    return {"ok": True}


def delete_page(filename):
    filepath = WIKI_DIR / filename
    try:
        assert_writable(filepath)
    except PermissionError as e:
        return {"ok": False, "error": str(e)}
    if not filepath.exists():
        return {"ok": False, "error": "Page not found"}
    if filename in ("index.md", "log.md", "overview.md"):
        return {"ok": False, "error": "Cannot delete system page"}
    filepath.unlink()
    return {"ok": True}


# ─── HTTP Handler ───

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SCRIPT_DIR), **kw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/status":
            return self._json(check_status())
        if path == "/api/wiki":
            return self._json(build_wiki_data())
        if path == "/api/folders":
            return self._json(get_folder_tree())
        if path == "/api/hash":
            return self._json({"hash": wiki_hash()})
        if path == "/api/schema":
            schema_path = PROJECT_ROOT / "CLAUDE.md"
            content = schema_path.read_text("utf-8") if schema_path.exists() else ""
            return self._json({"ok": True, "content": content})
        if path == "/api/history":
            return self._json(git_mgr.list_ingests())
        if path == "/api/provenance":
            return self._json(build_provenance_graph(WIKI_DIR))
        if path == "/api/query-stats":
            return self._json(_get_query_stats())
        if path == "/api/index/status":
            return self._json(get_strategy(WIKI_DIR))
        if path == "/api/raw/integrity":
            return self._json(check_raw_integrity())
        if path == "/api/reflect/status":
            last = get_last_reflect_date()
            days_ago = None
            if last:
                try:
                    from datetime import timedelta
                    d = datetime.strptime(last, "%Y-%m-%d")
                    days_ago = (datetime.now() - d).days
                except Exception:
                    pass
            return self._json({"last_date": last, "days_ago": days_ago})
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_body()

        if path == "/api/ingest":
            return self._json(do_ingest(body.get("title", ""), body.get("content", ""), body.get("folder", "")))
        if path == "/api/query":
            return self._json(do_query(body.get("question", "")))
        if path == "/api/query/save":
            return self._json(do_query_save(body.get("title", ""), body.get("content", "")))
        if path == "/api/lint":
            return self._json(do_lint())
        if path == "/api/lint/fix":
            return self._json(do_lint_fix())
        if path == "/api/folder":
            return self._json(create_folder(body.get("name", ""), body.get("parent", "")))
        if path == "/api/page":
            return self._json(create_page(body.get("title", ""), body.get("type", "concept"), body.get("folder", ""), body.get("content", "")))
        if path == "/api/page/update":
            return self._json(update_page(body.get("filename", ""), body.get("content", "")))
        if path == "/api/page/delete":
            return self._json(delete_page(body.get("filename", "")))
        if path == "/api/schema":
            schema_path = PROJECT_ROOT / "CLAUDE.md"
            schema_path.write_text(body.get("content", ""), encoding="utf-8")
            return self._json({"ok": True})
        if path == "/api/revert":
            return self._json(git_mgr.revert_ingest(body.get("commit_hash", "")))
        if path == "/api/provenance/fix":
            return self._json(do_fix_citations(body.get("page", "")))
        if path == "/api/reflect":
            return self._json(do_reflect(body.get("window", "last-10-ingests")))
        if path == "/api/index/rebuild":
            result = rebuild_index(WIKI_DIR)
            if result["ok"]:
                git_mgr._stage_all()
                git_mgr._run("commit", "-m", f"index: rebuild ({result['mode']})")
            return self._json(result)
        self.send_error(404)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] {args[0]}" if args else "")


import socket

class DualStackHTTPServer(HTTPServer):
    address_family = socket.AF_INET6
    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

if __name__ == "__main__":
    print(f"LLM Wiki Dashboard → http://localhost:{PORT}")
    print(f"Project: {PROJECT_ROOT}")
    print(f"Wiki:    {WIKI_DIR} ({sum(1 for _ in WIKI_DIR.rglob('*.md'))} pages)")
    DualStackHTTPServer(("::", PORT), Handler).serve_forever()
