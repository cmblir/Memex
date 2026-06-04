// Live "mission control" panel shown while an ingest run is in flight.
// Streams real claude activity (operational transparency beats a blind
// spinner): pulsing orb + current action headline, a constellation of files
// the model has touched so far, a scrolling activity feed, counters, and a
// cancel button. All data comes from ingestStore so the panel resumes
// seamlessly after navigating away and back.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Icon } from "../lib/icons";
import type { IconName } from "../lib/icons";
import type { Strings } from "../lib/i18n";
import { formatTicker } from "../lib/time";
import { useIngestStore } from "../stores/ingestStore";
import type { IngestEvent, TouchedFile } from "../stores/ingestStore";
import { useUIStore } from "../stores/uiStore";

const TOOL_ICONS: Record<string, IconName> = {
  Read: "book",
  Write: "edit",
  Edit: "edit",
  NotebookEdit: "edit",
  Grep: "search",
  Glob: "search",
  Bash: "terminal",
};

function describe(ev: IngestEvent): string {
  if (ev.kind === "tool") {
    const target = ev.detail ?? "";
    return `${ev.tool} ${target}`.trim();
  }
  if (ev.kind === "init") return ev.text ? `model: ${ev.text}` : "session started";
  return ev.text ?? "";
}

export default function IngestProgress({ t }: { t: Strings }): JSX.Element {
  const stage = useIngestStore((s) => s.stage);
  const events = useIngestStore((s) => s.events);
  const touched = useIngestStore((s) => s.touched);
  const readCount = useIngestStore((s) => s.readCount);
  const writeCount = useIngestStore((s) => s.writeCount);
  const model = useIngestStore((s) => s.model);
  const startedAt = useIngestStore((s) => s.startedAt);
  const vaultPath = useIngestStore((s) => s.vaultPath);
  const cancelIngest = useIngestStore((s) => s.cancelIngest);
  const setRoute = useUIStore((s) => s.setRoute);

  // 1 Hz elapsed ticker while the run is live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll the feed to the newest entry.
  const feedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const last = events.length > 0 ? events[events.length - 1] : null;
  const currentAction = last ? describe(last) : t.ing_live_warmup;
  const elapsed = startedAt ? formatTicker(now - startedAt) : "0:00";

  return (
    <div className="ingest-live" role="status" aria-live="polite">
      <div className="ingest-live-hero">
        <div className="ingest-orb" aria-hidden="true">
          <span className="ingest-orb-ring r1" />
          <span className="ingest-orb-ring r2" />
          <span className="ingest-orb-core" />
        </div>
        <div className="ingest-live-headline">
          <div className="ingest-live-title">{t.ing_live_title}</div>
          <div className="ingest-live-action" title={currentAction}>
            {currentAction}
          </div>
          <div className="ingest-live-meta muted">
            {model ? `${model} · ` : ""}
            {elapsed}
          </div>
        </div>
        <button
          className="btn ingest-cancel"
          onClick={cancelIngest}
          disabled={stage !== "claude"}
        >
          <Icon name="x" size={13} /> {t.ing_cancel}
        </button>
      </div>

      <Constellation
        touched={touched}
        title={t.ing_live_files}
        onOpen={(rel) => {
          if (vaultPath) setRoute(`page:${vaultPath}/${rel}`);
        }}
      />

      <div className="card ingest-feed-card">
        <div className="section-title" style={{ fontSize: 13.5, marginBottom: 6 }}>
          {t.ing_live_activity}
        </div>
        <div className="ingest-feed" ref={feedRef}>
          {events.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {t.ing_live_warmup}
            </div>
          ) : (
            events.map((ev, i) => <FeedRow key={i} ev={ev} />)
          )}
        </div>
        <div className="ingest-live-stats">
          <span className="chip">
            <Icon name="book" size={11} /> {readCount} {t.ing_live_reads}
          </span>
          <span className="chip">
            <Icon name="edit" size={11} /> {writeCount} {t.ing_live_writes}
          </span>
          <span className="chip">
            <Icon name="history" size={11} /> {elapsed}
          </span>
        </div>
      </div>
    </div>
  );
}

function FeedRow({ ev }: { ev: IngestEvent }): JSX.Element {
  const icon: IconName =
    ev.kind === "tool"
      ? (TOOL_ICONS[ev.tool ?? ""] ?? "bolt")
      : ev.kind === "text"
        ? "msg"
        : ev.kind === "init"
          ? "bolt"
          : "info";
  const time = new Date(ev.at).toLocaleTimeString(undefined, {
    hour12: false,
  });
  return (
    <div className={`ingest-feed-row kind-${ev.kind}`}>
      <span className="ingest-feed-time">{time}</span>
      <Icon name={icon} size={12} />
      <span className="ingest-feed-text">{describe(ev)}</span>
    </div>
  );
}

// Files the run has touched, laid out on a golden-angle spiral around a hub.
// Written pages glow with the entity green; read-only ones stay muted. Click
// a node to open that page in the reader.
function Constellation({
  touched,
  title,
  onOpen,
}: {
  touched: TouchedFile[];
  title: string;
  onOpen: (relPath: string) => void;
}): JSX.Element | null {
  const W = 640;
  const H = 260;
  const cx = W / 2;
  const cy = H / 2;
  const shown = touched.slice(0, 48); // beyond this the spiral leaves the box
  if (shown.length === 0) return null;
  return (
    <div className="card ingest-constellation-card">
      <div className="section-title" style={{ fontSize: 13.5, marginBottom: 4 }}>
        {title} · {touched.length}
      </div>
      <svg
        className="ingest-constellation"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
      >
        <circle className="ingest-hub" cx={cx} cy={cy} r={6} />
        {shown.map((f, i) => {
          const angle = i * 2.39996; // golden angle in radians
          const radius = 34 + 13 * Math.sqrt(i);
          const x = cx + radius * Math.cos(angle) * 1.9; // stretch horizontally
          const y = cy + radius * Math.sin(angle) * 0.78;
          const name = f.path.split("/").pop() ?? f.path;
          return (
            <g key={f.path} className="ingest-star-g">
              <line
                className={"ingest-edge" + (f.write ? " write" : "")}
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
              />
              <circle
                className={"ingest-star" + (f.write ? " write" : "")}
                cx={x}
                cy={y}
                r={f.write ? 5 : 3.5}
                onClick={() => onOpen(f.path)}
                role="button"
                aria-label={f.path}
              >
                <title>{f.path}</title>
              </circle>
              {f.write ? (
                <text className="ingest-star-label" x={x} y={y - 9}>
                  {name.length > 26 ? `${name.slice(0, 25)}…` : name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
