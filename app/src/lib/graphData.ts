// Renderer-agnostic graph data: link/tag/folder filters + graphology graph
// construction. Ported from the cytoscape PageGraph; identical filter
// semantics, but emits a graphology Graph instead of cytoscape elements so
// sigma.js can render it.
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Adjacency, FileNode } from "./ipc";

// Cosmic palette — soft-bright hues on black so each connected community reads
// as its own coloured star cluster / nebula region within the galaxy.
const PALETTE = [
  "#6fb3ff",
  "#b58cff",
  "#5fe0c0",
  "#ff9ec4",
  "#ffd27a",
  "#8affc1",
  "#ff9e6d",
  "#9ab0ff",
  "#7fe1ff",
  "#c9a0ff",
  "#ffb38a",
  "#a0ffd6",
];

// Colour nodes by connected community (Louvain): each community of 3+ nodes
// gets a distinct palette hue; orphans and tiny groups stay dim field stars.
function colorByCommunity(graph: VaultGraph, dim: string): void {
  let comm: Record<string, number>;
  try {
    comm = louvain(graph) as Record<string, number>;
  } catch {
    return; // empty/edgeless graph — leave dim
  }
  const size = new Map<number, number>();
  for (const id in comm) size.set(comm[id], (size.get(comm[id]) ?? 0) + 1);
  const ranked = [...size.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  const colorOf = new Map<number, string>();
  ranked.forEach((c, i) => colorOf.set(c, PALETTE[i % PALETTE.length]));
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, "color", colorOf.get(comm[id]) ?? dim);
  });
}

export interface AllowFilterOpts {
  tagFilter: string | null;
  folderFilter: string | null;
  vaultRoot: string;
  search: string;
  existingOnly: boolean;
  showOrphans: boolean;
}

export function stem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function inFolder(root: string, path: string, folder: string): boolean {
  const trimmed = root.replace(/[\\/]+$/, "");
  if (!path.startsWith(trimmed)) return false;
  const rel = path.slice(trimmed.length).replace(/^[\\/]+/, "");
  return rel.startsWith(`${folder}/`) || rel.startsWith(`${folder}\\`);
}

// Flatten the recursive vault tree into every .md path — including link-less
// files, so orphans render like they do in Obsidian.
export function flattenMarkdown(tree: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: FileNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "directory") walk(n.children);
      else if (n.path.toLowerCase().endsWith(".md")) out.push(n.path);
    }
  };
  walk(tree);
  return out;
}

export function collectTags(map: Record<string, string[]>): string[] {
  const set = new Set<string>();
  for (const arr of Object.values(map)) for (const t of arr) set.add(t);
  return Array.from(set).sort();
}

export function collectFolders(
  root: string,
  adjacency: Adjacency | null,
): string[] {
  if (!adjacency || !root) return [];
  const trimmed = root.replace(/[\\/]+$/, "");
  const set = new Set<string>();
  const paths = new Set<string>();
  for (const p of Object.keys(adjacency.forward)) paths.add(p);
  for (const arr of Object.values(adjacency.forward)) {
    for (const p of arr) paths.add(p);
  }
  for (const p of Object.keys(adjacency.tags)) paths.add(p);
  for (const p of paths) {
    if (!p.startsWith(trimmed)) continue;
    const rel = p.slice(trimmed.length).replace(/^[\\/]+/, "");
    const idx = rel.indexOf("/");
    if (idx > 0) set.add(rel.slice(0, idx));
  }
  return Array.from(set).sort();
}

export function countAllNodes(adjacency: Adjacency | null): number {
  if (!adjacency) return 0;
  const set = new Set<string>();
  for (const p of Object.keys(adjacency.forward)) set.add(p);
  for (const arr of Object.values(adjacency.forward)) {
    for (const p of arr) set.add(p);
  }
  for (const p of Object.keys(adjacency.tags)) set.add(p);
  return set.size;
}

// The set of node ids that survive the active filters. Two passes: filters
// that don't depend on the surviving subgraph first (tag/folder/search/
// existingOnly), then optionally drop edge-less nodes when orphans are hidden.
export function computeAllowed(
  adjacency: Adjacency,
  allFiles: string[],
  o: AllowFilterOpts,
): Set<string> {
  const all = new Set<string>();
  for (const p of allFiles) all.add(p);
  for (const p of Object.keys(adjacency.forward)) all.add(p);
  for (const targets of Object.values(adjacency.forward)) {
    for (const p of targets) all.add(p);
  }
  for (const p of Object.keys(adjacency.tags)) all.add(p);

  const resolved = new Set<string>(allFiles);
  for (const p of Object.keys(adjacency.forward)) resolved.add(p);
  const needle = o.search.trim().toLowerCase();

  const candidates = new Set<string>();
  for (const p of all) {
    if (o.tagFilter && !(adjacency.tags[p] ?? []).includes(o.tagFilter)) continue;
    if (o.folderFilter && !inFolder(o.vaultRoot, p, o.folderFilter)) continue;
    if (o.existingOnly && !resolved.has(p)) continue;
    if (needle && !stem(p).toLowerCase().includes(needle)) continue;
    candidates.add(p);
  }
  if (o.showOrphans) return candidates;

  const degree = new Map<string, number>();
  for (const [s, ts] of Object.entries(adjacency.forward)) {
    if (!candidates.has(s)) continue;
    for (const t of ts) {
      if (!candidates.has(t)) continue;
      degree.set(s, (degree.get(s) ?? 0) + 1);
      degree.set(t, (degree.get(t) ?? 0) + 1);
    }
  }
  return new Set([...candidates].filter((p) => (degree.get(p) ?? 0) > 0));
}

export interface BuildGraphOpts {
  nodeSize: number; // GraphSettings.nodeSize multiplier
  // Fallback dim colour for nodes outside any sized community. Community hues
  // (colorByCommunity) override it for the rest.
  starDim: string;
  edgeColor: string; // rgba w/ alpha — sigma honors it
}


// Deterministic pseudo-random scatter for seed positions on a SPHERE SHELL —
// the 3D analogue of the old ring scatter. Math.random is unavailable in some
// sandboxed contexts and would make runs non-reproducible, so we hash the id.
// Nodes must NOT start at 0,0,0 or the sim explodes; the shell also gives the
// d3-force-3d layout an immediate volumetric spread to relax from.
function seededXYZ(id: string, i: number): { x: number; y: number; z: number } {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 0) * 2654435761) % 1000) / 1000;
  const c = (((h >>> 0) * 40503) % 997) / 997;
  const r = 300 + a * 300;
  const theta = b * Math.PI * 2 + i * 0.0001; // azimuth
  const phi = Math.acos(2 * c - 1); // polar angle — uniform over the sphere
  const sinPhi = Math.sin(phi);
  return {
    x: Math.cos(theta) * r * sinPhi,
    y: Math.sin(theta) * r * sinPhi,
    z: Math.cos(phi) * r,
  };
}

export interface GraphNodeAttrs {
  label: string;
  x: number;
  y: number;
  z: number;
  deg: number;
  size: number;
  color: string;
  hidden?: boolean;
}
export interface GraphEdgeAttrs {
  color: string;
  size: number;
}
export type VaultGraph = Graph<GraphNodeAttrs, GraphEdgeAttrs>;

export function buildGraph(
  adjacency: Adjacency,
  allowed: Set<string>,
  o: BuildGraphOpts,
): VaultGraph {
  const g: VaultGraph = new Graph({ multi: false, type: "undirected" });

  const ensure = (id: string): void => {
    if (g.hasNode(id)) return;
    const i = g.order;
    const { x, y, z } = seededXYZ(id, i);
    g.addNode(id, {
      label: stem(id),
      x,
      y,
      z,
      deg: 0,
      size: 2, // real size + colour set once degree is known
      color: o.starDim,
    });
  };

  for (const [source, targets] of Object.entries(adjacency.forward)) {
    if (!allowed.has(source)) continue;
    ensure(source);
    for (const target of targets) {
      if (!allowed.has(target)) continue;
      ensure(target);
      // Auto edge key (paths can contain spaces, so a manual key would clash).
      // Undirected: hasEdge(s,t) === hasEdge(t,s).
      if (!g.hasEdge(source, target)) {
        g.addEdge(source, target, { color: o.edgeColor, size: 0.6 });
      }
    }
  }
  for (const p of allowed) ensure(p); // isolated/orphan nodes

  // Tiny star cores: leaves/orphans ~1px, hubs grow with sqrt(degree) capped
  // ~5px. The glow node program wraps each in a soft halo, so the cores stay
  // small and point-like while still reading as stars.
  g.forEachNode((id) => {
    const deg = g.degree(id);
    const base = Math.max(1, Math.min(5, 1 + Math.sqrt(deg) * 0.7));
    g.setNodeAttribute(id, "deg", deg);
    g.setNodeAttribute(id, "size", base * o.nodeSize);
  });
  // Colour each connected community its own hue.
  colorByCommunity(g, o.starDim);
  return g;
}
