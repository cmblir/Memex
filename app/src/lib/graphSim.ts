// d3-force-3d simulation over a graphology graph — the 3D port of the original
// 2D graphSim. Same Obsidian-derived force mapping (uncapped Barnes-Hut
// repulsion, long links, gentle center gravity, per-link degree normalization
// that turns a hairball into separated radial "dandelions"), now run in three
// dimensions so the galaxy has real volume. The public API is unchanged from
// the 2D version (reheat / update / timelapse* / liveAdd / stop) so PageGraph's
// drag, timelapse and live-ingest orchestration ports verbatim.
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceZ,
  forceCollide,
  type Simulation,
} from "d3-force-3d";
import type { GraphSettings } from "./graphSettings";
import type { VaultGraph } from "./graphData";

// Mutated in place by d3 (it also adds vx/vy/vz/index at runtime). x/y/z are
// seeded from the graph before the sim runs, so they are always present.
export interface SimNode {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  deg: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  // Velocities — d3 owns these at runtime; we zero them when (re)spawning a
  // node at the centre during the timelapse.
  vx?: number;
  vy?: number;
  vz?: number;
}
interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

// Galaxy: uniform per-node repulsion + uniform gravity gives one cohesive
// volume with a dense core that fades to a sparse star halo (not separated
// clusters).
const REPEL_SCALE = 9; // slider 10 → charge -90 (uncapped, Barnes-Hut)
const CENTER_SCALE = 0.13; // slider 0.5 → x/y/z strength ≈0.065 (cohesive)

export interface GraphSim {
  nodes: SimNode[];
  sim: Simulation<SimNode, SimLink>;
  reheat(alpha: number): void;
  // Re-apply force parameters from changed sliders without rebuilding the sim,
  // then gently reheat so the layout eases to the new configuration.
  update(next: GraphSettings): void;
  // --- Live timelapse: grow the simulation one cohort at a time. Only revealed
  // nodes exert/feel forces, so each new star spawned at the centre physically
  // shoves its neighbours outward as the galaxy assembles in real time. ---
  // Empty the active set — the sim falls silent until the first reveal.
  timelapseReset(): void;
  // Spawn the given nodes at the centre and add them (plus any links to nodes
  // already revealed) to the live sim, kept hot so they push outward.
  timelapseReveal(ids: string[]): void;
  // Reveal is done — let the live galaxy cool to rest.
  timelapseSettle(): void;
  // Mid-flight injection for the live-ingest view: add brand-new nodes (their
  // x/y/z/size/deg already written to the graph) and new links between any two
  // known nodes, then gently reheat so newcomers tug into place without
  // exploding the settled layout.
  liveAdd(newIds: string[], newEdges: [string, string][]): void;
  stop(): void;
}

export function createSim(
  graph: VaultGraph,
  s: GraphSettings,
  onTick: (nodes: SimNode[]) => void,
): GraphSim {
  let cur = s;
  // ALL nodes take part — orphans included — so everything settles into one
  // cohesive "galaxy": a dense core fading to a sparse halo of field stars.
  const nodes: SimNode[] = graph.mapNodes((id, a) => ({
    id,
    x: a.x,
    y: a.y,
    z: a.z,
    size: a.size,
    deg: a.deg,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = graph.mapEdges((_e, _a, src, tgt) => ({
    source: byId.get(src) as SimNode,
    target: byId.get(tgt) as SimNode,
  }));
  // Links incident to each node — lets the timelapse add only the edges whose
  // both endpoints are already revealed, without rescanning every edge.
  const linksByNode = new Map<string, SimLink[]>();
  for (const l of links) {
    const a = (l.source as SimNode).id;
    const b = (l.target as SimNode).id;
    (linksByNode.get(a) ?? linksByNode.set(a, []).get(a)!).push(l);
    (linksByNode.get(b) ?? linksByNode.set(b, []).get(b)!).push(l);
  }

  // Per-link strength, degree-normalized (d3's native rule). A leaf (deg 1) on
  // a hub pulls at 1/2; two hubs (deg 30) pull each other at only 1/31, so
  // leaves hug their hub while clusters drift apart.
  const linkStrength = (l: SimLink): number => {
    const sN = typeof l.source === "object" ? l.source.deg : 1;
    const tN = typeof l.target === "object" ? l.target.deg : 1;
    return cur.linkForce / (1 + Math.min(sN, tN));
  };
  const centerOf = (g: GraphSettings): number =>
    Math.max(0.005, g.centerForce * CENTER_SCALE);

  const linkF = forceLink<SimNode, SimLink>(links)
    .id((d) => d.id)
    .distance(s.linkDistance)
    .strength(linkStrength)
    .iterations(1);
  const chargeF = forceManyBody<SimNode>()
    .strength(() => -cur.repelForce * REPEL_SCALE)
    .theta(0.9)
    .distanceMin(2); // distanceMax left at Infinity (uncapped)
  const xF = forceX<SimNode>(0).strength(centerOf(s));
  const yF = forceY<SimNode>(0).strength(centerOf(s));
  const zF = forceZ<SimNode>(0).strength(centerOf(s));

  // numDimensions 3 — run the layout in full 3D (d3-force-3d default, set
  // explicitly so the intent is clear and z is always integrated).
  const sim = forceSimulation<SimNode, SimLink>(nodes, 3)
    .force("link", linkF)
    .force("charge", chargeF)
    .force("x", xF)
    .force("y", yF)
    .force("z", zF)
    .force(
      "collide",
      forceCollide<SimNode>((n) => n.size / 2 + 1.5)
        .strength(0.9)
        .iterations(1),
    )
    .alpha(1)
    .alphaDecay(0.018)
    .alphaMin(0.002)
    .velocityDecay(0.45);

  // During a timelapse the sim runs over a growing subset; otherwise the full
  // node set. onTick always reports the live set so positions render back.
  let tlActive: SimNode[] | null = null;
  sim.on("tick", () => onTick(tlActive ?? nodes));

  // Timelapse growth state (null = not running a timelapse).
  const activeIds = new Set<string>();
  const activeLinks: SimLink[] = [];

  return {
    nodes,
    sim,
    // Gentle re-activation for interactive drag — tows neighbours, then cools.
    reheat(alpha) {
      sim.alpha(alpha).alphaTarget(0).restart();
    },
    update(next) {
      cur = next;
      linkF.distance(next.linkDistance).strength(linkStrength);
      chargeF.strength(() => -next.repelForce * REPEL_SCALE);
      xF.strength(centerOf(next));
      yF.strength(centerOf(next));
      zF.strength(centerOf(next));
      if (tlActive) {
        // A timelapse keeps the sim hot (alphaTarget 0.1); don't reset the
        // target to 0 or the galaxy cools between reveal batches. Just nudge
        // alpha so the new force values take effect.
        sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
      } else {
        sim.alpha(0.3).alphaTarget(0).restart();
      }
    },
    timelapseReset() {
      activeIds.clear();
      activeLinks.length = 0;
      tlActive = [];
      linkF.links(activeLinks);
      sim.nodes(tlActive).alpha(0).alphaTarget(0).stop();
    },
    timelapseReveal(ids) {
      if (!tlActive) tlActive = [];
      for (const id of ids) {
        const n = byId.get(id);
        if (!n || activeIds.has(id)) continue;
        // Spawn near the centre on a tiny sphere (so a cohort doesn't perfectly
        // stack) with zero velocity — the live charge force flings it outward,
        // which is what shoves the already-placed neighbours aside.
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = Math.random() * 6;
        const sinPhi = Math.sin(phi);
        n.x = Math.cos(theta) * r * sinPhi;
        n.y = Math.sin(theta) * r * sinPhi;
        n.z = Math.cos(phi) * r;
        n.vx = 0;
        n.vy = 0;
        n.vz = 0;
        n.fx = null;
        n.fy = null;
        n.fz = null;
        // Seed the rendered position now so the node doesn't flash at its old
        // settled spot for a frame before the first tick moves it.
        graph.mergeNodeAttributes(id, { x: n.x, y: n.y, z: n.z });
        activeIds.add(id);
        tlActive.push(n);
        for (const l of linksByNode.get(id) ?? []) {
          const other = (l.source as SimNode).id === id ? l.target : l.source;
          if (typeof other === "object" && activeIds.has(other.id))
            activeLinks.push(l);
        }
      }
      // Re-bind the growing sets and keep the sim hot (charge/link scale with
      // alpha, so it must stay high for the push to read while nodes arrive).
      linkF.links(activeLinks);
      sim.nodes(tlActive).alpha(0.8).alphaTarget(0.1).restart();
    },
    timelapseSettle() {
      sim.alphaTarget(0);
    },
    liveAdd(newIds, newEdges) {
      for (const id of newIds) {
        if (byId.has(id) || !graph.hasNode(id)) continue;
        const a = graph.getNodeAttributes(id);
        const n: SimNode = {
          id,
          x: a.x,
          y: a.y,
          z: a.z,
          size: a.size,
          deg: a.deg,
          vx: 0,
          vy: 0,
          vz: 0,
        };
        nodes.push(n);
        byId.set(id, n);
        // If a timelapse is mid-flight, surface the newcomer in its active
        // set too so it participates instead of waiting frozen.
        if (tlActive) {
          activeIds.add(id);
          tlActive.push(n);
        }
      }
      for (const [s, t] of newEdges) {
        const sn = byId.get(s);
        const tn = byId.get(t);
        if (!sn || !tn) continue;
        const l: SimLink = { source: sn, target: tn };
        links.push(l);
        (linksByNode.get(s) ?? linksByNode.set(s, []).get(s)!).push(l);
        (linksByNode.get(t) ?? linksByNode.set(t, []).get(t)!).push(l);
        sn.deg += 1;
        tn.deg += 1;
        if (tlActive && activeIds.has(s) && activeIds.has(t)) {
          activeLinks.push(l);
        }
      }
      // Re-bind so d3 initialises the new nodes/links, then ease them in.
      linkF.links(tlActive ? activeLinks : links);
      sim
        .nodes(tlActive ?? nodes)
        .alpha(Math.max(sim.alpha(), 0.5))
        .alphaTarget(0)
        .restart();
    },
    stop() {
      tlActive = null;
      sim.stop();
    },
  };
}
