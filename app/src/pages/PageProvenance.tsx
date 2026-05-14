// Provenance page — scans every markdown file in the vault, counts claim
// lines, and flags those with citation coverage below the slider threshold.

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Icon } from "../lib/icons";
import type { Strings } from "../lib/i18n";
import { ipc } from "../lib/ipc";
import type { ClaudeStatus, ProvenanceRow } from "../lib/ipc";
import { useUIStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";

const LINT_PROMPT = `Run the wiki lint checklist from CLAUDE.md against the current vault:

Structure: frontmatter present, type field valid, status superseded → superseded_by exists, status disputed → ## Disputed section present.

Citation: inline [^src-*] citations on factual claims, source_count matches actual citations, dangling [^src-*] references, definitions of src-* point to existing source-summary pages.

Connection: orphan pages (no [[wikilinks]] pointing in), missing cross-references for entities/concepts mentioned but not linked, body mentions of concepts that don't have their own page.

Freshness: status: active pages with last_updated > 30 days, source_count: 1 pages making general claims ("대체로", "일반적으로", "in general"), confidence: high pages with source_count < 2.

Output as a Markdown report (sections Critical/Warning/Info) with concrete file paths and one-line fix suggestions. Do not modify files.`;

export default function PageProvenance({ t }: { t: Strings }): JSX.Element {
  const currentVault = useVaultStore((s) => s.currentVault);
  const setRoute = useUIStore((s) => s.setRoute);
  const [rows, setRows] = useState<ProvenanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  const [lintReport, setLintReport] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVault) return;
    setLoading(true);
    setError(null);
    ipc
      .scanProvenance(currentVault.path)
      .then(setRows)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentVault]);

  useEffect(() => {
    ipc.claudeCheck().then(setClaudeStatus).catch(() => undefined);
  }, []);

  async function runLint(): Promise<void> {
    if (!currentVault || !claudeStatus?.installed || lintBusy) return;
    setLintBusy(true);
    setLintReport("Running Claude lint…");
    try {
      const res = await ipc.claudeRun(LINT_PROMPT, currentVault.path);
      setLintReport(res.stdout.trim() || res.stderr.trim() || "(no output)");
    } catch (err) {
      setLintReport(`ERROR: ${String(err)}`);
    } finally {
      setLintBusy(false);
    }
  }

  const totals = useMemo(() => {
    if (!rows) return { cited: 0, total: 0 };
    return {
      cited: rows.reduce((s, r) => s + r.cited, 0),
      total: rows.reduce((s, r) => s + r.total, 0),
    };
  }, [rows]);

  return (
    <div className="workspace">
      <header className="page-head">
        <div className="page-eyebrow">{t.nav_provenance}</div>
        <h1 className="page-title">{t.p_title}</h1>
        <p className="page-lede">{t.p_lede}</p>
        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            onClick={() => void runLint()}
            disabled={
              !claudeStatus?.installed || !currentVault || lintBusy
            }
          >
            <Icon name="check" size={14} />{" "}
            {lintBusy ? "Linting…" : "Run lint via Claude"}
          </button>
          {!claudeStatus?.installed ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              claude CLI required
            </span>
          ) : null}
        </div>
      </header>

      {lintReport ? (
        <section
          className="card"
          style={{
            marginTop: 16,
            padding: 16,
            background: "var(--bg-soft)",
          }}
        >
          <div
            className="row"
            style={{ justifyContent: "space-between", marginBottom: 8 }}
          >
            <div className="section-title" style={{ fontSize: 14 }}>
              Lint report
            </div>
            <button
              type="button"
              className="btn-ghost btn"
              onClick={() => setLintReport(null)}
            >
              <Icon name="x" size={12} /> dismiss
            </button>
          </div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              margin: 0,
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            {lintReport}
          </pre>
        </section>
      ) : null}

      {!currentVault ? (
        <p className="muted">Open a vault to scan provenance.</p>
      ) : loading ? (
        <p className="muted">Scanning vault…</p>
      ) : error ? (
        <div className="card-flat" style={{ color: "#dc2626" }}>
          {error}
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="muted">No claim-bearing notes yet — add some prose.</p>
      ) : (
        <>
          <div className="row" style={{ marginTop: 16 }}>
            <div className="card-flat" style={{ flex: 1, padding: 14 }}>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div
                    className="muted"
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {t.p_threshold}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                    {Math.round(threshold * 100)}%
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  style={{ width: 200, accentColor: "var(--ink)" }}
                />
              </div>
            </div>
            <div className="card-flat" style={{ flex: 1, padding: 14 }}>
              <div
                className="muted"
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Overall
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                {totals.total > 0
                  ? Math.round((totals.cited / totals.total) * 100)
                  : 0}
                %
                <span
                  className="muted"
                  style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}
                >
                  {totals.cited} / {totals.total} claims cited
                </span>
              </div>
            </div>
          </div>

          <div className="section-head">
            <div className="section-title" style={{ fontSize: 14 }}>
              Pages, by claim coverage
            </div>
          </div>
          <div className="list">
            {rows.map((r) => {
              const pct = r.total > 0 ? r.cited / r.total : 1;
              const low = pct < threshold;
              return (
                <button
                  key={r.path}
                  className="list-row"
                  style={{
                    gridTemplateColumns: "20px 1.4fr 2fr auto auto",
                    background: "transparent",
                    border: 0,
                    textAlign: "left",
                  }}
                  onClick={() => setRoute(`page:${r.path}`)}
                >
                  <span className="ic">
                    <Icon name="page" size={13} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {r.name.replace(/\.md$/i, "")}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.path}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div className="cov-bar" style={{ flex: 1 }}>
                      <div
                        className="cov-bar-fill"
                        style={{
                          width: `${pct * 100}%`,
                          background: low ? "var(--c-technique)" : "var(--ink)",
                        }}
                      ></div>
                    </div>
                    <span
                      className="muted"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        minWidth: 56,
                        textAlign: "right",
                      }}
                    >
                      {r.cited}/{r.total}
                    </span>
                  </div>
                  <span
                    className="chip"
                    style={{
                      background: low
                        ? "rgba(220,38,38,0.08)"
                        : "rgba(22,163,74,0.08)",
                      color: low ? "var(--c-technique)" : "var(--c-entity)",
                    }}
                  >
                    {low ? t.p_low : t.p_ok}
                  </span>
                  <span className="ic">
                    <Icon name="chevR" size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
