// Ingest page — drop a file or paste raw text, then call `claude` to write
// it into `raw/<slug>.md` and ingest into the wiki per CLAUDE.md instructions.

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Icon } from "../lib/icons";
import type { Strings } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import { useVaultStore } from "../stores/vaultStore";
import { useSettingsStore } from "../stores/settingsStore";
import { complete } from "../lib/chat";

type Stage = "idle" | "writing-raw" | "claude" | "done" | "error";

const INGEST_PROMPT = (slug: string, title: string) =>
  `New source has been added at \`raw/${slug}.md\` (title: "${title}"). Please ingest it into the wiki following the workflow in CLAUDE.md:

1. Read the source completely.
2. Identify pages it affects (entities, concepts, techniques, analyses).
3. Update existing pages with inline citations, or create new pages with required frontmatter.
4. Create the source-summary page \`wiki/source-${slug}.md\`.
5. Update \`wiki/index.md\` and append a \`wiki/log.md\` entry.
6. Write an ingest report at \`ingest-reports/<datetime>-${slug}.md\` summarising what was created/modified and why.

When done, output a one-line confirmation.`;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "source"
  );
}

export default function PageIngest({ t }: { t: Strings }): JSX.Element {
  const currentVault = useVaultStore((s) => s.currentVault);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const refreshLinkGraph = useVaultStore((s) => s.refreshLinkGraph);
  const settings = useSettingsStore((s) => s.settings);
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [log, setLog] = useState<string>("");
  const [dropError, setDropError] = useState<string | null>(null);

  // Tauri intercepts drag-drop at the OS level (so the browser drop event
  // never fires inside the WebView). Subscribe to its native event instead
  // and read the file via Rust IPC — we get a real path + UTF-8 contents.
  //
  // Subscription is set up exactly once per mount. `cancelled` handles the
  // race where the user navigates away before onDragDropEvent resolves;
  // the functional setState for title avoids re-subscribing on every
  // keystroke.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const webview = getCurrentWebview();
      const u = await webview.onDragDropEvent(async (event) => {
        if (event.payload.type === "over") {
          setOver(true);
          return;
        }
        if (event.payload.type === "leave") {
          setOver(false);
          return;
        }
        if (event.payload.type === "drop") {
          setOver(false);
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) return;
          const first = paths[0];
          setDropError(null);
          const base = first.split(/[\\/]/).pop() ?? "";
          setTitle((prev) => prev || base.replace(/\.[^.]+$/, ""));
          try {
            const text = await ipc.readExternalText(first);
            setBody(text);
          } catch (err) {
            setDropError(`Could not read ${first}: ${String(err)}`);
          }
        }
      });
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const canRun = !!currentVault && (title.trim() || body.trim());

  async function run(): Promise<void> {
    if (!canRun || !currentVault) return;
    const finalTitle = title.trim() || `untitled-${Date.now()}`;
    const slug = slugify(finalTitle);
    setStage("writing-raw");
    setLog(`Writing raw/${slug}.md…`);
    try {
      const rawDir = `${currentVault.path}/raw`;
      try {
        await ipc.createFolder(currentVault.path, "raw");
      } catch {
        /* already exists */
      }
      const payload =
        body.trim().length > 0
          ? `# ${finalTitle}\n\n${body.trim()}\n`
          : `# ${finalTitle}\n\n_(empty)_\n`;
      await ipc.writeFile(`${rawDir}/${slug}.md`, payload);
      await refreshTree();

      setStage("claude");
      setLog((l) => `${l}\nInvoking model…`);
      const out = await complete({
        task: "ingest",
        cwd: currentVault.path,
        messages: [{ role: "user", content: INGEST_PROMPT(slug, finalTitle) }],
      });
      setLog((l) => `${l}\n\n${out}`);
      await refreshTree();
      void refreshLinkGraph();
      setStage("done");
    } catch (err) {
      setStage("error");
      setLog((l) => `${l}\n\nERROR: ${String(err)}`);
    }
  }

  async function browseAndLoad(): Promise<void> {
    setDropError(null);
    const path = await ipc.pickTextFile();
    if (!path) return;
    if (!title) {
      const base = path.split(/[\\/]/).pop() ?? "";
      setTitle(base.replace(/\.[^.]+$/, ""));
    }
    try {
      const text = await ipc.readExternalText(path);
      setBody(text);
    } catch (err) {
      setDropError(`Could not read ${path}: ${String(err)}`);
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <div className="page-eyebrow">{t.nav_ingest}</div>
        <h1 className="page-title">{t.ing_title}</h1>
        <p className="page-lede">{t.ing_lede}</p>
      </header>

      {settings ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          via {settings.ingest_provider} · {settings.ingest_model}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 24,
          marginTop: 16,
        }}
      >
        <div className="col">
          <div className={"dropzone" + (over ? " over" : "")}>
            <Icon name="upload" size={26} />
            <div className="dropzone-title">{t.ing_drop}</div>
            <div className="dropzone-sub">
              Drop a text/markdown file anywhere on this window — or
            </div>
            <button
              className="btn"
              style={{ marginTop: 10 }}
              onClick={() => void browseAndLoad()}
            >
              {t.ing_browse}
            </button>
            {dropError ? (
              <div
                style={{
                  marginTop: 10,
                  color: "#dc2626",
                  fontSize: 12,
                }}
              >
                {dropError}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label>Title</label>
            <input
              className="input"
              placeholder="e.g. Byte Pair Encoding"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field">
            <label>{t.ing_or_paste}</label>
            <textarea
              className="textarea"
              rows={10}
              placeholder={t.ing_paste_ph}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="row">
            <span className="chip">
              <Icon name="bolt" size={11} />{" "}
              {settings?.ingest_model ?? "claude-cli"}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              vault: {currentVault?.path ?? "(none)"}
            </span>
            <button
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              onClick={() => void run()}
              disabled={
                !canRun || stage === "claude" || stage === "writing-raw"
              }
            >
              <Icon name="sparkles" size={14} />{" "}
              {stage === "claude" || stage === "writing-raw"
                ? "Running…"
                : t.ing_run}
            </button>
          </div>
        </div>

        <aside className="col">
          <div className="card">
            <div
              className="section-title"
              style={{ fontSize: 13.5, marginBottom: 12 }}
            >
              {t.ing_pipeline}
            </div>
            <div className="stepper">
              <StepRow
                idx={1}
                title={t.ing_step_read}
                active={stage === "writing-raw"}
                done={
                  stage === "claude" || stage === "done" || stage === "error"
                }
              />
              <StepRow
                idx={2}
                title="Claude reads & writes wiki"
                active={stage === "claude"}
                done={stage === "done"}
              />
              <StepRow
                idx={3}
                title="Index & link graph refresh"
                active={false}
                done={stage === "done"}
              />
            </div>
          </div>
          <div className="card" style={{ minHeight: 80 }}>
            <div
              className="section-title"
              style={{ fontSize: 13.5, marginBottom: 6 }}
            >
              Log
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: stage === "error" ? "#dc2626" : "var(--ink-3)",
                margin: 0,
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {log || "—"}
            </pre>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StepRow({
  idx,
  title,
  active,
  done,
}: {
  idx: number;
  title: string;
  active: boolean;
  done: boolean;
}): JSX.Element {
  return (
    <div className={"step " + (done ? "done" : active ? "active" : "")}>
      <div className="step-bullet">
        {done ? <Icon name="check" size={11} /> : idx}
      </div>
      <div className="step-body">
        <div className="step-title">{title}</div>
        {active ? <div className="step-sub">working…</div> : null}
      </div>
    </div>
  );
}
