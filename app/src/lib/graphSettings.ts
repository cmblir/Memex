// Graph view settings — persisted to localStorage so the user's slider
// positions survive reloads. Mirrors Obsidian's graph settings panel:
// Filters / Display / Forces. Field names and value ranges follow the
// `obsidian-typings` `GraphPluginInstanceOptions` interface so behaviour
// matches the real Obsidian sliders unit-for-unit. References:
//   - github.com/Fevol/obsidian-typings
//   - github.com/ElsaTam/obsidian-extended-graph (default values)
//   - github.com/ycnmhd/obsidian-graph-presets (slider ranges)

export interface GraphSettings {
  // Filters
  search: string;
  showOrphans: boolean;
  existingOnly: boolean;
  tagFilter: string | null;
  folderFilter: string | null;

  // Display
  arrows: boolean;
  textFadeThreshold: number; // zoom level at which labels appear (0.1..3)
  nodeSize: number; // multiplier 0.5..3
  linkThickness: number; // 0.3..3
  brightness: number; // 0.2..2.5 — scene exposure + bloom strength (light intensity)

  // Forces — names and ranges mirror Obsidian's `ForceOptions`.
  centerForce: number; // 0..1 — center pull strength (Obsidian: centerStrength)
  repelForce: number; // 0..20 — node repulsion (Obsidian: repelStrength)
  linkForce: number; // 0..1 — link spring stiffness (Obsidian: linkStrength)
  linkDistance: number; // 30..500 — ideal edge length (Obsidian: linkDistance)
  clusterForce: number; // 0..1 — per-community clump tightness (galaxy clustering)
}

// Defaults are slider values (matching Obsidian's panel) — they are
// scaled inside runLayout() to the actual d3-force numbers Obsidian
// uses internally. The mapping there is:
//   manyBodyStrength = -repelForce  × 100
//   xStrength/yStrength =  centerForce × 0.1   (linear, not log)
//   linkStrength = linkForce / sqrt(min(deg(a), deg(b)))   (per link)
// That scaling is what produces discrete dandelion clusters on
// vaults of any size; an 800-node tree with the old linear mapping
// crushed every cluster into a single hairball.
export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  search: "",
  showOrphans: true,
  existingOnly: false,
  tagFilter: null,
  folderFilter: null,
  arrows: false,
  textFadeThreshold: 1.1,
  nodeSize: 1,
  linkThickness: 1,
  brightness: 1,
  // Obsidian's real defaults (obsidian-extended-graph EngineOptions):
  // centerStrength ≈0.52, repelStrength 10, linkStrength 1, linkDistance 250.
  // linkDistance 250 (NOT 30, which is Obsidian's slider MINIMUM) is what
  // separates the dandelions instead of collapsing them onto a central spine.
  centerForce: 0.5, // → x/y strength ≈0.04 (gentle, uniform gravity)
  repelForce: 10, // → per-node charge -13×(deg+1): hubs separate, leaves pack
  linkForce: 1, // → ÷ (1+min-degree) per link (d3 native normalisation)
  // SHORT links — leaves hug their hub into a dense full circle (Obsidian),
  // not a sparse far-flung arc. Cluster separation comes from hub repulsion.
  linkDistance: 40,
  // Each Louvain community contracts toward its degree-weighted centroid so it
  // reads as a distinct galaxy/star-cluster; 0 = today's single cohesive cloud.
  clusterForce: 0.6,
};

// v22: added the galaxy clusterForce (per-community centroid attraction) — the
// universe graph now clumps communities into separated galaxies. Bumping the
// key drops stale persisted blobs so the new field picks up its default.
const KEY = "memex.graph.settings.v22";

export function loadGraphSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GRAPH_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GraphSettings>;
    return { ...DEFAULT_GRAPH_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_GRAPH_SETTINGS };
  }
}

export function saveGraphSettings(s: GraphSettings): void {
  try {
    // Don't persist the search box — it's transient.
    const { search: _ignored, ...rest } = s;
    void _ignored;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* quota or disabled — ignore */
  }
}
