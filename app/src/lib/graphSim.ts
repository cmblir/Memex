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
  type Force,
} from "d3-force-3d";
import type { GraphSettings } from "./graphSettings";
import { seededUnit, type VaultGraph } from "./graphData";

// Mutated in place by d3 (it also adds vx/vy/vz/index at runtime). x/y/z are
// seeded from the graph before the sim runs, so they are always present.
export interface SimNode {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  deg: number;
  community: number; // Louvain community (-1 = field star); drives clustering
  isHub: boolean; // galaxy core — weighted heavily in the community centroid
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

// Cosmos: per-node repulsion + a per-community centroid pull contracts each
// Louvain community into a tight galaxy/star-cluster, while weak inter-community
// links + capped charge leave dark voids and faint filaments between galaxies.
const REPEL_SCALE = 9; // slider 10 → charge -90 (Barnes-Hut), range-capped below
const CENTER_SCALE = 0.13; // slider 0.5 → x/y/z strength ≈0.065 (cohesive)
const CLUSTER_SCALE = 0.18; // clusterForce 0.6 → effective ≈0.108 (stable band)
const HUB_PIN = 3; // the hub is pulled to its community centre this much harder,
// so each galaxy has ONE clear central node (bright core)
const ORBIT_BASE = 0.7; // member orbit radius = linkDistance·(BASE + GROW·√count)
const ORBIT_GROW = 0.45; // …bigger communities orbit wider
const DUST_PULL = 0.18; // orphans drift weakly toward their NEAREST galaxy; the
// charge then holds them off it, so they settle as cosmic dust around each galaxy
const BIGBANG_BURST = 22; // timelapse: outward spawn velocity (a burst from 0,0,0)
const INTER_LINK_DIST_MUL = 6; // inter-galaxy links sit ~6× longer (the voids)
const INTER_LINK_STR_MUL = 0.15; // ...and ~7× weaker (faint filaments)
const CLUSTERED_GRAVITY_MUL = 0.15; // clumped (galaxy) nodes feel weak gravity
const ORPHAN_GRAVITY_MUL = 0.04; // orphans feel the WEAKEST gravity, so the
// uncapped charge pushes them out past the galaxies into a sparse outer halo
// (a stronger pull would pile link-less nodes in the centre).

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
    community: a.community,
    isHub: a.isHub,
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

  // Both endpoints in the same sized community → intra-galaxy link; otherwise an
  // inter-galaxy filament. Drives the link distance/strength split below.
  const sameComm = (l: SimLink): boolean =>
    typeof l.source === "object" &&
    typeof l.target === "object" &&
    l.source.community >= 0 &&
    l.source.community === l.target.community;

  // Per-link strength, degree-normalized (d3's native rule), then weakened for
  // inter-galaxy links so communities pull apart into distinct galaxies.
  const linkStrength = (l: SimLink): number => {
    const sN = typeof l.source === "object" ? l.source.deg : 1;
    const tN = typeof l.target === "object" ? l.target.deg : 1;
    const base = cur.linkForce / (1 + Math.min(sN, tN));
    return base * (sameComm(l) ? 1 : INTER_LINK_STR_MUL);
  };
  // Intra-galaxy links stay short (leaves hug their hub); inter-galaxy links sit
  // far apart (the dark voids between galaxies).
  const linkDist = (l: SimLink): number =>
    sameComm(l) ? cur.linkDistance : cur.linkDistance * INTER_LINK_DIST_MUL;
  const centerOf = (g: GraphSettings): number =>
    Math.max(0.005, g.centerForce * CENTER_SCALE);
  // Galaxy nodes feel weak global gravity (the cluster force holds them); orphans
  // feel even weaker gravity so the uncapped charge flings them OUT to a sparse
  // halo instead of piling them in the centre. The spring (∝r) still beats the
  // 1/r² charge at large r, so the halo stays finite — nothing drifts to ∞.
  const gravityOf =
    (g: GraphSettings) =>
    (n: SimNode): number =>
      centerOf(g) *
      (n.community >= 0 ? CLUSTERED_GRAVITY_MUL : ORPHAN_GRAVITY_MUL);

  const linkF = forceLink<SimNode, SimLink>(links)
    .id((d) => d.id)
    .distance(linkDist)
    .strength(linkStrength)
    .iterations(1);
  // UNCAPPED repulsion (no distanceMax): galaxy clumps need to push EACH OTHER
  // apart at long range to open dark voids. A cap would zero inter-galaxy
  // repulsion past it, letting weak origin gravity pile every clump onto 0,0,0.
  const chargeF = forceManyBody<SimNode>()
    .strength(() => -cur.repelForce * REPEL_SCALE)
    .theta(0.9)
    .distanceMin(2);
  const xF = forceX<SimNode>(0).strength(gravityOf(s));
  const yF = forceY<SimNode>(0).strength(gravityOf(s));
  const zF = forceZ<SimNode>(0).strength(gravityOf(s));

  // Per-community centroid attraction — each tick contracts every sized
  // community toward its degree-weighted (hub-anchored) centroid so it clumps
  // into a galaxy. Reads the live node set via .initialize, so it is
  // timelapse/liveAdd subset-correct; alpha-coupled; skips dragged nodes. A
  // dead-zone (CLUSTER_DIST_MIN) keeps a clump a finite ball, not a point.
  let clusterStrength = cur.clusterForce * CLUSTER_SCALE;
  const clusterForce = (): Force<SimNode, SimLink> => {
    let ns: SimNode[] = [];
    const force: Force<SimNode, SimLink> = (alpha) => {
      const cx = new Map<number, number>();
      const cy = new Map<number, number>();
      const cz = new Map<number, number>();
      const cw = new Map<number, number>();
      const cn = new Map<number, number>(); // raw member count → orbit radius
      const hub = new Map<number, SimNode>(); // the galaxy core per community
      for (const n of ns) {
        if (n.community < 0) continue;
        const w = n.isHub ? 8 : 1;
        cx.set(n.community, (cx.get(n.community) ?? 0) + n.x * w);
        cy.set(n.community, (cy.get(n.community) ?? 0) + n.y * w);
        cz.set(n.community, (cz.get(n.community) ?? 0) + n.z * w);
        cw.set(n.community, (cw.get(n.community) ?? 0) + w);
        cn.set(n.community, (cn.get(n.community) ?? 0) + 1);
        if (n.isHub) hub.set(n.community, n);
      }
      // Galaxy centroids — orphans get pulled toward the nearest one (dust).
      const cents: { x: number; y: number; z: number }[] = [];
      for (const [cm, w] of cw) {
        cents.push({ x: cx.get(cm)! / w, y: cy.get(cm)! / w, z: cz.get(cm)! / w });
      }
      const k = clusterStrength * alpha;
      for (const n of ns) {
        if (n.fx != null) continue;
        if (n.community < 0) {
          // Orphan → drift weakly toward the nearest galaxy centroid; the charge
          // holds it off the core, so orphans pool as cosmic dust around galaxies.
          if (cents.length === 0) continue;
          let bx = 0;
          let by = 0;
          let bz = 0;
          let bd = Infinity;
          for (const c of cents) {
            const ddx = c.x - n.x;
            const ddy = c.y - n.y;
            const ddz = c.z - n.z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < bd) {
              bd = d2;
              bx = ddx;
              by = ddy;
              bz = ddz;
            }
          }
          const dk = k * DUST_PULL;
          n.vx = (n.vx ?? 0) + bx * dk;
          n.vy = (n.vy ?? 0) + by * dk;
          n.vz = (n.vz ?? 0) + bz * dk;
          continue;
        }
        const w = cw.get(n.community);
        if (!w) continue;
        const mx = cx.get(n.community)! / w;
        const my = cy.get(n.community)! / w;
        const mz = cz.get(n.community)! / w;
        if (n.isHub) {
          // Pin the hub at the community centre → one clear bright core.
          n.vx = (n.vx ?? 0) + (mx - n.x) * k * HUB_PIN;
          n.vy = (n.vy ?? 0) + (my - n.y) * k * HUB_PIN;
          n.vz = (n.vz ?? 0) + (mz - n.z) * k * HUB_PIN;
          continue;
        }
        // Members orbit the hub (fallback: centroid) at a per-node radius so they
        // fill a disk/halo around the core instead of collapsing onto it.
        const h = hub.get(n.community);
        const ox = h ? h.x : mx;
        const oy = h ? h.y : my;
        const oz = h ? h.z : mz;
        let dx = n.x - ox;
        let dy = n.y - oy;
        let dz = n.z - oz;
        let dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-3) {
          dx = 1;
          dy = 0;
          dz = 0;
          dist = 1; // nudge a coincident member off the core
        }
        const count = cn.get(n.community) ?? 1;
        const ringR = cur.linkDistance * (ORBIT_BASE + ORBIT_GROW * Math.sqrt(count));
        // Vary each member's target radius deterministically → a filled disk
        // (dense near the core, thinning outward), not a hollow shell.
        const rTarget = ringR * (0.4 + 0.6 * seededUnit(n.id, 14));
        const corr = (rTarget - dist) * k; // + push out toward the ring, - pull in
        n.vx = (n.vx ?? 0) + (dx / dist) * corr;
        n.vy = (n.vy ?? 0) + (dy / dist) * corr;
        n.vz = (n.vz ?? 0) + (dz / dist) * corr;
      }
    };
    force.initialize = (init: SimNode[]): void => {
      ns = init;
    };
    return force;
  };

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
    .force("cluster", clusterForce())
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
      clusterStrength = next.clusterForce * CLUSTER_SCALE;
      // linkDist/linkStrength/gravityOf close over `cur` (just reassigned), so
      // re-applying the accessors picks up the new slider values.
      linkF.distance(linkDist).strength(linkStrength);
      chargeF.strength(() => -next.repelForce * REPEL_SCALE);
      xF.strength(gravityOf(next));
      yF.strength(gravityOf(next));
      zF.strength(gravityOf(next));
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
        const theta = seededUnit(id, 11) * Math.PI * 2;
        const phi = Math.acos(2 * seededUnit(id, 12) - 1);
        const sinPhi = Math.sin(phi);
        const ux = Math.cos(theta) * sinPhi;
        const uy = Math.sin(theta) * sinPhi;
        const uz = Math.cos(phi);
        const r = 1 + seededUnit(id, 13) * 3; // tight near the singularity
        n.x = ux * r;
        n.y = uy * r;
        n.z = uz * r;
        // Big bang: hurl each new star outward from the centre; the forces then
        // reel them back into galaxies as the cosmos expands.
        n.vx = ux * BIGBANG_BURST;
        n.vy = uy * BIGBANG_BURST;
        n.vz = uz * BIGBANG_BURST;
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
          community: a.community,
          isHub: a.isHub,
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
