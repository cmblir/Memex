// Interactive mini force-graph of the pages an ingest run touches — a small
// live galaxy for the Ingest page. d3-force physics rendered as plain SVG
// (node count is ≤ ~50, no GPU needed): the hub star is the run itself,
// every touched page is tethered to it faintly, and real wikilinks between
// touched pages (from ingestStore.liveAdjacency rescans) draw as solid
// edges. New pages are born at the hub and flung outward by the charge
// force. Drag a star to tow it (the sim reheats), hover for its label,
// click to open the page in the reader.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { Strings } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { ipc } from "../lib/ipc";
import { useIngestStore } from "../stores/ingestStore";
import { useUIStore } from "../stores/uiStore";
import Viewer from "./Viewer";

const W = 640;
const H = 280;
const PAD = 24; // render clamp so stars never leave the card
const HUB_ID = "::run";

interface MiniNode extends SimulationNodeDatum {
  id: string; // vault-relative path (or HUB_ID)
  write: boolean;
  hub: boolean;
}
interface MiniLink {
  source: MiniNode | string;
  target: MiniNode | string;
  real: boolean; // real wikilink vs hub tether
}

function endpointId(e: MiniNode | string): string {
  return typeof e === "string" ? e : e.id;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export default function IngestMiniGraph({ t }: { t: Strings }): JSX.Element | null {
  const touched = useIngestStore((s) => s.touched);
  const liveAdjacency = useIngestStore((s) => s.liveAdjacency);
  const vaultPath = useIngestStore((s) => s.vaultPath);
  const setRoute = useUIStore((s) => s.setRoute);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<MiniNode, MiniLink> | null>(null);
  const nodesRef = useRef<MiniNode[]>([]);
  const linksRef = useRef<MiniLink[]>([]);
  const byIdRef = useRef<Map<string, MiniNode>>(new Map());
  const dragRef = useRef<{ node: MiniNode; moved: boolean } | null>(null);
  const [, setTick] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Clicking a star opens this page's content in-place below the graph —
  // navigating to the reader mid-run would hide the live progress.
  const [selected, setSelected] = useState<string | null>(null);

  // Build the simulation once; structure syncs into it as the run streams.
  useEffect(() => {
    const hub: MiniNode = { id: HUB_ID, write: false, hub: true, fx: 0, fy: 0, x: 0, y: 0 };
    nodesRef.current = [hub];
    byIdRef.current = new Map([[HUB_ID, hub]]);
    linksRef.current = [];
    const sim = forceSimulation<MiniNode, MiniLink>(nodesRef.current)
      .force(
        "link",
        forceLink<MiniNode, MiniLink>(linksRef.current)
          .id((d) => d.id)
          .distance((l) => (l.real ? 64 : 92))
          .strength((l) => (l.real ? 0.45 : 0.06)),
      )
      .force("charge", forceManyBody<MiniNode>().strength(-150))
      .force("x", forceX<MiniNode>(0).strength(0.07))
      .force("y", forceY<MiniNode>(0).strength(0.09))
      .force("collide", forceCollide<MiniNode>(15))
      .velocityDecay(0.5)
      .on("tick", () => setTick((n) => n + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, []);

  // Sync touched files + rescanned wikilinks into the live structure.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const byId = byIdRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    let changed = false;

    for (const f of touched) {
      const existing = byId.get(f.path);
      if (existing) {
        if (f.write && !existing.write) {
          existing.write = true;
          changed = true;
        }
        continue;
      }
      // Born at the hub with a nudge — charge flings it out.
      const a = Math.random() * Math.PI * 2;
      const n: MiniNode = {
        id: f.path,
        write: f.write,
        hub: false,
        x: Math.cos(a) * 10,
        y: Math.sin(a) * 10,
        vx: 0,
        vy: 0,
      };
      nodes.push(n);
      byId.set(f.path, n);
      links.push({ source: HUB_ID, target: f.path, real: false });
      changed = true;
    }

    // Real wikilinks among touched pages, from the latest mid-run rescan.
    if (liveAdjacency && vaultPath) {
      const rel = (p: string): string =>
        p.startsWith(vaultPath) ? p.slice(vaultPath.length).replace(/^\//, "") : p;
      const have = new Set(
        links.filter((l) => l.real).map((l) => `${endpointId(l.source)}→${endpointId(l.target)}`),
      );
      for (const [srcAbs, targets] of Object.entries(liveAdjacency.forward)) {
        const src = rel(srcAbs);
        if (!byId.has(src)) continue;
        for (const tgtAbs of targets) {
          const tgt = rel(tgtAbs);
          if (tgt === src || !byId.has(tgt)) continue;
          if (have.has(`${src}→${tgt}`) || have.has(`${tgt}→${src}`)) continue;
          links.push({ source: src, target: tgt, real: true });
          have.add(`${src}→${tgt}`);
          changed = true;
        }
      }
    }

    if (!changed) return;
    sim.nodes(nodes);
    (sim.force("link") as ReturnType<typeof forceLink<MiniNode, MiniLink>>).links(links);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Settle instantly instead of animating the physics.
      sim.alpha(1).stop();
      for (let i = 0; i < 160; i++) sim.tick();
      setTick((n) => n + 1);
    } else {
      sim.alpha(0.7).alphaTarget(0).restart();
    }
  }, [touched, liveAdjacency, vaultPath]);

  // Drag — pointer events at the SVG level; capture keeps move/up flowing
  // even when the cursor outruns the star.
  const svgPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W - W / 2,
      y: ((e.clientY - r.top) / r.height) * H - H / 2,
    };
  };
  const onNodeDown = (n: MiniNode) => (e: React.PointerEvent) => {
    if (n.hub) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { node: n, moved: false };
    simRef.current?.alphaTarget(0.3).restart();
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    const p = svgPoint(e);
    d.node.fx = clamp(p.x, -W / 2 + PAD, W / 2 - PAD);
    d.node.fy = clamp(p.y, -H / 2 + PAD, H / 2 - PAD);
    d.moved = true;
  };
  const onPointerUp = (n: MiniNode) => (): void => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    d.node.fx = null;
    d.node.fy = null;
    simRef.current?.alphaTarget(0);
    // Precise click (no drag movement) opens the in-place content preview.
    if (!d.moved && !n.hub) {
      setSelected((cur) => (cur === n.id ? null : n.id));
    }
  };

  const files = nodesRef.current.filter((n) => !n.hub);
  if (files.length === 0) return null;

  const cx = (n: MiniNode): number => clamp(n.x ?? 0, -W / 2 + PAD, W / 2 - PAD);
  const cy = (n: MiniNode): number => clamp(n.y ?? 0, -H / 2 + PAD, H / 2 - PAD);
  const nameOf = (id: string): string => id.split("/").pop() ?? id;

  return (
    <div className="card ingest-constellation-card">
      <div className="section-title" style={{ fontSize: 13.5, marginBottom: 4 }}>
        {t.ing_live_files} · {files.length}
      </div>
      <svg
        ref={svgRef}
        className="ingest-minigraph"
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        role="img"
        aria-label={t.ing_live_files}
        onPointerMove={onPointerMove}
      >
        {linksRef.current.map((l, i) => {
          const s = byIdRef.current.get(endpointId(l.source));
          const tn = byIdRef.current.get(endpointId(l.target));
          if (!s || !tn) return null;
          return (
            <line
              key={i}
              className={l.real ? "ingest-edge write" : "ingest-edge"}
              x1={cx(s)}
              y1={cy(s)}
              x2={cx(tn)}
              y2={cy(tn)}
            />
          );
        })}
        <circle className="ingest-hub" cx={0} cy={0} r={6} />
        {files.map((n) => {
          const hovered = hoverId === n.id;
          return (
            <g key={n.id} className="ingest-star-g">
              <circle
                className={
                  "ingest-star" +
                  (n.write ? " write" : "") +
                  (hovered ? " hovered" : "") +
                  (selected === n.id ? " selected" : "")
                }
                cx={cx(n)}
                cy={cy(n)}
                r={n.write ? 6 : 4.5}
                onPointerDown={onNodeDown(n)}
                onPointerUp={onPointerUp(n)}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId(null)}
                role="button"
                aria-label={n.id}
              />
              {hovered || (n.write && files.length <= 14) ? (
                <text
                  className={
                    "ingest-star-label" + (hovered ? " hovered" : "")
                  }
                  x={cx(n)}
                  y={cy(n) - 11}
                >
                  {hovered
                    ? n.id
                    : nameOf(n.id).length > 26
                      ? `${nameOf(n.id).slice(0, 25)}…`
                      : nameOf(n.id)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {selected && vaultPath ? (
        <NodePreview
          t={t}
          relPath={selected}
          vaultPath={vaultPath}
          onOpen={() => setRoute(`page:${vaultPath}/${selected}`)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

// In-place content preview for a clicked star. Re-fetches whenever the run
// writes again, so a page that claude is still expanding stays current.
function NodePreview({
  t,
  relPath,
  vaultPath,
  onOpen,
  onClose,
}: {
  t: Strings;
  relPath: string;
  vaultPath: string;
  onOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  const writeCount = useIngestStore((s) => s.writeCount);
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipc
      .readFile(`${vaultPath}/${relPath}`)
      .then((f) => {
        if (cancelled) return;
        setContent(f.content);
        setMissing(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Tool event fired before the file landed on disk.
        setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, relPath, writeCount]);

  return (
    <div className="ingest-preview" role="region" aria-label={relPath}>
      <div className="ingest-preview-head">
        <span className="ingest-preview-path" title={relPath}>
          {relPath}
        </span>
        <button className="btn" onClick={onOpen}>
          {t.ing_preview_open}
        </button>
        <button
          className="icon-btn"
          onClick={onClose}
          aria-label={t.ing_preview_close}
          title={t.ing_preview_close}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="ingest-preview-body">
        {missing ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {t.ing_preview_writing}
          </div>
        ) : content === null ? (
          <div className="muted" style={{ fontSize: 12 }}>
            …
          </div>
        ) : (
          <Viewer content={content} />
        )}
      </div>
    </div>
  );
}
