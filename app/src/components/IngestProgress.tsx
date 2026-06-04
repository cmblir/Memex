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
import type { IngestEvent } from "../stores/ingestStore";
import IngestMiniGraph from "./IngestMiniGraph";

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
  const readCount = useIngestStore((s) => s.readCount);
  const writeCount = useIngestStore((s) => s.writeCount);
  const model = useIngestStore((s) => s.model);
  const startedAt = useIngestStore((s) => s.startedAt);
  const cancelIngest = useIngestStore((s) => s.cancelIngest);

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

      <IngestMiniGraph t={t} />

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

