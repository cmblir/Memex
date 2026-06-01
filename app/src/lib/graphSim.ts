// d3-force simulation over a graphology graph. Mirrors the Obsidian force
// mapping the cytoscape port arrived at: uncapped Barnes-Hut repulsion, long
// links, gentle center gravity, and per-link degree normalization
// (linkStrength = slider / (1 + min(deg))) — the rule that turns a hairball
// into separated radial "dandelions".
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
} from "d3-force";
import type { GraphSettings } from "./graphSettings";
import type { VaultGraph } from "./graphData";

// Mutated in place by d3 (it also adds vx/vy/index at runtime). x/y are seeded
// from the graph before the sim runs, so they are always present.
export interface SimNode {
  id: string;
  x: number;
  y: number;
  size: number;
  deg: number;
  fx?: number | null;
  fy?: number | null;
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

const REPEL_SCALE = 20; // slider 10 → manyBody -200 (uncapped, Barnes-Hut)
// slider 0.5 → x/y strength ≈0.075 — the gentle gravity the design intends.
// (The cytoscape port used 0.4 here = 0.2, which over-compressed the graph
// into a uniform disk; this lets clusters drift into separated dandelions.)
const CENTER_SCALE = 0.15;

export interface GraphSim {
  nodes: SimNode[];
  sim: Simulation<SimNode, SimLink>;
  reheat(alpha: number): void;
  stop(): void;
}

export function createSim(
  graph: VaultGraph,
  s: GraphSettings,
  onTick: (nodes: SimNode[]) => void,
): GraphSim {
  const nodes: SimNode[] = graph.mapNodes((id, a) => ({
    id,
    x: a.x,
    y: a.y,
    size: a.size,
    deg: a.deg,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = graph.mapEdges((_e, _a, src, tgt) => ({
    source: byId.get(src) as SimNode,
    target: byId.get(tgt) as SimNode,
  }));

  // Per-link strength, degree-normalized (d3's native rule). A leaf (deg 1) on
  // a hub pulls at 1/2; two hubs (deg 30) pull each other at only 1/31, so
  // leaves hug their hub while clusters drift apart.
  const linkStrength = (l: SimLink): number => {
    const sN = typeof l.source === "object" ? l.source.deg : 1;
    const tN = typeof l.target === "object" ? l.target.deg : 1;
    return s.linkForce / (1 + Math.min(sN, tN));
  };

  const center = Math.max(0.005, s.centerForce * CENTER_SCALE);
  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(s.linkDistance)
        .strength(linkStrength)
        .iterations(1),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength(-s.repelForce * REPEL_SCALE)
        .theta(0.9)
        .distanceMin(1), // distanceMax left at Infinity (uncapped) — no orphan ring
    )
    .force("x", forceX<SimNode>(0).strength(center))
    .force("y", forceY<SimNode>(0).strength(center))
    .force(
      "collide",
      forceCollide<SimNode>((n) => n.size / 2 + 6)
        .strength(1)
        .iterations(1),
    )
    .alpha(1)
    .alphaDecay(0.035)
    .alphaMin(0.004)
    .velocityDecay(0.5);

  sim.on("tick", () => onTick(nodes));

  return {
    nodes,
    sim,
    // Gentle re-activation for interactive drag — tows neighbours, then cools.
    reheat(alpha) {
      sim.alpha(alpha).alphaTarget(0).restart();
    },
    stop() {
      sim.stop();
    },
  };
}
