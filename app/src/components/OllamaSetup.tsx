// OllamaSetup — three-state setup flow for the local Ollama provider.
//
//   1. Binary not on PATH         → Install button (opens download page).
//   2. Binary present, daemon off → instructions to start the app/daemon.
//   3. Daemon running             → preset model picker + pull progress.
//
// The pull uses the Ollama HTTP API directly from the WebView (CORS is
// permissive on localhost) so we can stream progress without an extra
// Tauri event channel.

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Icon } from "../lib/icons";
import { ipc } from "../lib/ipc";
import type { OllamaStatus } from "../lib/ipc";
import { useSettingsStore } from "../stores/settingsStore";

interface Preset {
  id: string;
  label: string;
  blurb: string;
  ram: string;
}

const PRESETS: Preset[] = [
  {
    id: "llama3.2:1b",
    label: "Light · Llama 3.2 1B",
    blurb: "~770 MB. Snappy Q&A on any Apple Silicon Mac.",
    ram: "1 GB RAM",
  },
  {
    id: "llama3.2:3b",
    label: "Balanced · Llama 3.2 3B",
    blurb: "~2 GB. Better reasoning, still fast.",
    ram: "3 GB RAM",
  },
  {
    id: "qwen2.5:7b",
    label: "Quality · Qwen 2.5 7B",
    blurb: "~4.7 GB. Strong overall; good for ingest.",
    ram: "8 GB RAM",
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Code · Qwen 2.5 Coder 7B",
    blurb: "~4.7 GB. Best at structured outputs / code.",
    ram: "8 GB RAM",
  },
];

interface PullState {
  model: string;
  total: number;
  completed: number;
  status: string;
  done: boolean;
  error: string | null;
}

export default function OllamaSetup({
  status,
  refresh,
}: {
  status: OllamaStatus;
  refresh: () => void;
}): JSX.Element {
  const setProviderConnected = useSettingsStore((s) => s.setProviderConnected);
  const [customModel, setCustomModel] = useState("");
  const [pull, setPull] = useState<PullState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  async function pullModel(name: string): Promise<void> {
    if (!name.trim() || pull) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPull({
      model: name,
      total: 0,
      completed: 0,
      status: "starting…",
      done: false,
      error: null,
    });
    try {
      const resp = await fetch(`${status.endpoint}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, stream: true }),
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line) as {
              status?: string;
              total?: number;
              completed?: number;
              error?: string;
            };
            if (ev.error) {
              setPull((p) =>
                p ? { ...p, error: ev.error ?? "pull error", done: true } : p,
              );
            } else {
              setPull((p) =>
                p
                  ? {
                      ...p,
                      total: ev.total ?? p.total,
                      completed: ev.completed ?? p.completed,
                      status: ev.status ?? p.status,
                    }
                  : p,
              );
            }
          } catch {
            /* malformed line; skip */
          }
        }
      }
      setPull((p) => (p ? { ...p, done: true } : p));
      // Refresh status so the new model shows up in the list, and turn the
      // ollama flag on so settings picks it up immediately.
      refresh();
      await setProviderConnected("ollama", true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setPull((p) =>
        p ? { ...p, error: String(err), done: true } : p,
      );
    } finally {
      abortRef.current = null;
    }
  }

  // ── State 1: binary not on PATH ───────────────────────────────────────
  if (!status.binary_installed) {
    return (
      <div
        className="card-flat"
        style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
      >
        <Icon name="download" size={16} />
        <div style={{ flex: 1, fontSize: 13.5, color: "var(--ink-3)" }}>
          <div style={{ color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>
            Ollama not installed
          </div>
          Download Ollama from{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>ollama.com</code> —
          one click, runs as a tiny system daemon. After installing, come back
          here.
        </div>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const url = await ipc.ollamaInstallUrl();
            await ipc.openExternal(url);
          }}
        >
          <Icon name="download" size={13} /> Get Ollama
        </button>
      </div>
    );
  }

  // ── State 2: binary present, daemon not running ───────────────────────
  if (!status.daemon_running) {
    return (
      <div
        className="card-flat"
        style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
      >
        <Icon name="info" size={16} />
        <div style={{ flex: 1, fontSize: 13.5, color: "var(--ink-3)" }}>
          <div style={{ color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>
            Ollama installed but not running
          </div>
          Start the Ollama app from Spotlight (or run{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>ollama serve</code>{" "}
          in a terminal), then click <b>Recheck</b>.
        </div>
        <button className="btn" onClick={refresh}>
          <Icon name="revert" size={13} /> Recheck
        </button>
      </div>
    );
  }

  // ── State 3: daemon running — model picker + pull ─────────────────────
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, fontSize: 13 }}>
        <span
          className="chip"
          style={{
            background: "rgba(22,163,74,0.1)",
            color: "var(--c-entity)",
          }}
        >
          ● daemon ready
        </span>
        {status.version ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {status.version}
          </span>
        ) : null}
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          {status.models.length} model{status.models.length === 1 ? "" : "s"}{" "}
          installed
        </span>
        <button className="btn-ghost btn" onClick={refresh}>
          <Icon name="revert" size={13} />
        </button>
      </div>

      {status.models.length > 0 ? (
        <InstalledList models={status.models} />
      ) : null}

      <div>
        <div
          className="muted"
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: 8,
          }}
        >
          Pull a recommended model
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          {PRESETS.map((p) => {
            const installed = status.models.some((m) =>
              m.name.startsWith(p.id),
            );
            const busy = pull?.model === p.id && !pull.done;
            return (
              <button
                key={p.id}
                className="card-flat"
                onClick={() => void pullModel(p.id)}
                disabled={installed || busy || pull !== null}
                style={{
                  padding: 12,
                  textAlign: "left",
                  cursor: installed || busy ? "default" : "pointer",
                  opacity: installed ? 0.6 : 1,
                }}
              >
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>
                  {p.label}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 12, marginTop: 2 }}
                >
                  {p.blurb}
                </div>
                <div
                  className="muted"
                  style={{ fontSize: 11, marginTop: 4 }}
                >
                  {p.ram} · {installed ? "installed" : busy ? "pulling…" : "tap to pull"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="custom model, e.g. phi3.5 or gemma2:2b"
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13 }}
          disabled={pull !== null && !pull.done}
        />
        <button
          className="btn"
          onClick={() => void pullModel(customModel.trim())}
          disabled={
            !customModel.trim() || (pull !== null && !pull.done)
          }
        >
          Pull
        </button>
      </div>

      {pull ? <PullProgress pull={pull} onDismiss={() => setPull(null)} /> : null}
    </div>
  );
}

function InstalledList({
  models,
}: {
  models: { name: string; size: number }[];
}): JSX.Element {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div
        className="muted"
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Installed models
      </div>
      {models.map((m) => (
        <div
          key={m.name}
          className="row"
          style={{
            padding: "4px 8px",
            background: "var(--bg-soft)",
            borderRadius: 4,
            fontSize: 12.5,
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)" }}>{m.name}</span>
          <span className="muted">{formatBytes(m.size)}</span>
        </div>
      ))}
    </div>
  );
}

function PullProgress({
  pull,
  onDismiss,
}: {
  pull: PullState;
  onDismiss: () => void;
}): JSX.Element {
  const pct = useMemo(() => {
    if (pull.total === 0) return 0;
    return Math.min(100, (pull.completed / pull.total) * 100);
  }, [pull.total, pull.completed]);
  return (
    <div
      className="card-flat"
      style={{
        padding: 12,
        background: pull.error ? "rgba(220,38,38,0.06)" : "var(--bg-soft)",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 6 }}
      >
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {pull.model}
          <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
            {pull.error ? "failed" : pull.done ? "ready" : pull.status}
          </span>
        </div>
        {pull.done ? (
          <button className="btn-ghost btn" onClick={onDismiss}>
            <Icon name="x" size={12} /> dismiss
          </button>
        ) : null}
      </div>
      {!pull.error ? (
        <div className="cov-bar">
          <div
            className="cov-bar-fill"
            style={{
              width: `${pct}%`,
              background: pull.done ? "var(--c-entity)" : "var(--ink)",
            }}
          />
        </div>
      ) : (
        <div style={{ color: "#dc2626", fontSize: 12.5 }}>{pull.error}</div>
      )}
      {pull.total > 0 ? (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {formatBytes(pull.completed)} / {formatBytes(pull.total)}
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(v < 10 ? 2 : 1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}
