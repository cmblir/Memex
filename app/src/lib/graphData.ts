// Renderer-agnostic graph data: link/tag/folder filters + graphology graph
// construction. Ported from the cytoscape PageGraph; identical filter
// semantics, but emits a graphology Graph instead of cytoscape elements so
// sigma.js can render it.
import Graph from "graphology";
import type { Adjacency, FileNode } from "./ipc";

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
  resolvedColor: string;
  unresolvedColor: string;
  edgeColor: string; // rgba w/ alpha — sigma honors it
}

// Deterministic pseudo-random scatter for seed positions. Math.random is
// unavailable in some sandboxed contexts and would make runs non-reproducible,
// so we hash the id. Nodes must NOT start at 0,0 or the sim explodes.
function seededXY(id: string, i: number): { x: number; y: number } {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 0) * 2654435761) % 1000) / 1000;
  const r = 300 + a * 300;
  const theta = b * Math.PI * 2 + i * 0.0001;
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

export interface GraphNodeAttrs {
  label: string;
  x: number;
  y: number;
  deg: number;
  size: number;
  unresolved: 0 | 1;
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
  allFiles: string[],
  o: BuildGraphOpts,
): VaultGraph {
  const g: VaultGraph = new Graph({ multi: false, type: "undirected" });
  const resolved = new Set<string>(allFiles);
  for (const p of Object.keys(adjacency.forward)) resolved.add(p);

  const ensure = (id: string): void => {
    if (g.hasNode(id)) return;
    const i = g.order;
    const { x, y } = seededXY(id, i);
    g.addNode(id, {
      label: stem(id),
      x,
      y,
      deg: 0,
      size: 2, // real size set once degree is known
      unresolved: resolved.has(id) ? 0 : 1,
      color: resolved.has(id) ? o.resolvedColor : o.unresolvedColor,
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

  // Degree-driven size: leaves ~2px, hubs swell. sqrt keeps hubs from
  // dominating; the wide hub/leaf ratio gives the dandelion silhouette.
  g.forEachNode((id) => {
    const deg = g.degree(id);
    const base = Math.max(2, Math.min(14, 2 + Math.sqrt(deg) * 2.2));
    g.setNodeAttribute(id, "deg", deg);
    g.setNodeAttribute(id, "size", base * o.nodeSize);
  });
  return g;
}
