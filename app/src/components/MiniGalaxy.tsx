// Generic interactive mini force-graph ("mini galaxy") shared by the ingest
// progress panel and the query answers. d3-force physics rendered as plain
// SVG (node counts stay ≤ ~50): a fixed hub star sits at the centre, every
// node is tethered to it faintly, and caller-supplied real links draw as
// solid edges. New nodes are born at the hub and flung outward by the
// charge force. Drag tows a star (the sim reheats), hover shows its label,
// a precise click reports the node to the caller (for an in-place preview).

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

const W = 640;
const H = 280;
const PAD = 24; // render clamp so stars never leave the card
const HUB_ID = "::hub";

export interface GalaxyNode {
  id: string;
  /** Short label drawn above bright stars / on hover. */
  label: string;
  /** Bright (gold, larger) vs dim (ice). */
  bright: boolean;
}
export interface GalaxyLink {
  a: string;
  b: string;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  bright: boolean;
  hub: boolean;
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  real: boolean;
}

function endpointId(e: SimNode | string): string {
  return typeof e === "string" ? e : e.id;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export default function MiniGalaxy({
  nodes,
  links,
  selected,
  onSelect,
  ariaLabel,
  hubLabel,
}: {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  ariaLabel: string;
  /** Optional label drawn at the hub — e.g. the question the answer's
   * cited pages orbit around. */
  hubLabel?: string;
}): JSX.Element | null {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const byIdRef = useRef<Map<string, SimNode>>(new Map());
  const labelsRef = useRef<Map<string, string>>(new Map());
  const dragRef = useRef<{ node: SimNode; moved: boolean } | null>(null);
  const [, setTick] = useState(0);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Build the simulation once; structure syncs in as props change.
  useEffect(() => {
    const hub: SimNode = { id: HUB_ID, bright: false, hub: true, fx: 0, fy: 0, x: 0, y: 0 };
    nodesRef.current = [hub];
    byIdRef.current = new Map([[HUB_ID, hub]]);
    linksRef.current = [];
    const sim = forceSimulation<SimNode, SimLink>(nodesRef.current)
      .force(
        "link",
        forceLink<SimNode, SimLink>(linksRef.current)
          .id((d) => d.id)
          .distance((l) => (l.real ? 64 : 92))
          .strength((l) => (l.real ? 0.45 : 0.06)),
      )
      .force("charge", forceManyBody<SimNode>().strength(-150))
      .force("x", forceX<SimNode>(0).strength(0.07))
      .force("y", forceY<SimNode>(0).strength(0.09))
      .force("collide", forceCollide<SimNode>(15))
      .velocityDecay(0.5)
      .on("tick", () => setTick((n) => n + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, []);

  // Sync caller nodes/links into the live structure (additive — removing a
  // node mid-flight isn't needed by either consumer).
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const byId = byIdRef.current;
    const simNodes = nodesRef.current;
    const simLinks = linksRef.current;
    let changed = false;

    for (const n of nodes) {
      labelsRef.current.set(n.id, n.label);
      const existing = byId.get(n.id);
      if (existing) {
        if (n.bright && !existing.bright) {
          existing.bright = true;
          changed = true;
        }
        continue;
      }
      // Born at the hub with a nudge — charge flings it out.
      const a = Math.random() * Math.PI * 2;
      const sn: SimNode = {
        id: n.id,
        bright: n.bright,
        hub: false,
        x: Math.cos(a) * 10,
        y: Math.sin(a) * 10,
        vx: 0,
        vy: 0,
      };
      simNodes.push(sn);
      byId.set(n.id, sn);
      simLinks.push({ source: HUB_ID, target: n.id, real: false });
      changed = true;
    }

    const have = new Set(
      simLinks
        .filter((l) => l.real)
        .map((l) => `${endpointId(l.source)}→${endpointId(l.target)}`),
    );
    for (const l of links) {
      if (l.a === l.b || !byId.has(l.a) || !byId.has(l.b)) continue;
      if (have.has(`${l.a}→${l.b}`) || have.has(`${l.b}→${l.a}`)) continue;
      simLinks.push({ source: l.a, target: l.b, real: true });
      have.add(`${l.a}→${l.b}`);
      changed = true;
    }

    if (!changed) return;
    sim.nodes(simNodes);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(
      simLinks,
    );
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Settle instantly instead of animating the physics.
      sim.alpha(1).stop();
      for (let i = 0; i < 160; i++) sim.tick();
      setTick((n) => n + 1);
    } else {
      sim.alpha(0.7).alphaTarget(0).restart();
    }
  }, [nodes, links]);

  // Drag — pointer capture keeps move/up flowing even when the cursor
  // outruns the star.
  const svgPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W - W / 2,
      y: ((e.clientY - r.top) / r.height) * H - H / 2,
    };
  };
  const onNodeDown = (n: SimNode) => (e: React.PointerEvent) => {
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
  const onPointerUp = (n: SimNode) => (): void => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    d.node.fx = null;
    d.node.fy = null;
    simRef.current?.alphaTarget(0);
    // Precise click (no drag movement) toggles the selection.
    if (!d.moved && !n.hub) {
      onSelect(selected === n.id ? null : n.id);
    }
  };

  const files = nodesRef.current.filter((n) => !n.hub);
  if (files.length === 0) return null;

  const cx = (n: SimNode): number => clamp(n.x ?? 0, -W / 2 + PAD, W / 2 - PAD);
  const cy = (n: SimNode): number => clamp(n.y ?? 0, -H / 2 + PAD, H / 2 - PAD);

  return (
    <svg
      ref={svgRef}
      className="ingest-minigraph"
      viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
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
      <circle className="ingest-hub" cx={0} cy={0} r={hubLabel ? 8 : 6} />
      {hubLabel ? (
        <text className="ingest-hub-label" x={0} y={20}>
          {hubLabel.length > 36 ? `${hubLabel.slice(0, 35)}…` : hubLabel}
        </text>
      ) : null}
      {files.map((n) => {
        const hovered = hoverId === n.id;
        const label = labelsRef.current.get(n.id) ?? n.id;
        return (
          <g key={n.id} className="ingest-star-g">
            <circle
              className={
                "ingest-star" +
                (n.bright ? " write" : "") +
                (hovered ? " hovered" : "") +
                (selected === n.id ? " selected" : "")
              }
              cx={cx(n)}
              cy={cy(n)}
              r={n.bright ? 6 : 4.5}
              onPointerDown={onNodeDown(n)}
              onPointerUp={onPointerUp(n)}
              onPointerEnter={() => setHoverId(n.id)}
              onPointerLeave={() => setHoverId(null)}
              role="button"
              aria-label={n.id}
            />
            {hovered || (n.bright && files.length <= 14) ? (
              <text
                className={"ingest-star-label" + (hovered ? " hovered" : "")}
                x={cx(n)}
                y={cy(n) - 11}
              >
                {hovered
                  ? n.id
                  : label.length > 26
                    ? `${label.slice(0, 25)}…`
                    : label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
