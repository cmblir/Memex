// Graph theme colours (read from the live CSS variables / rendered background)
// and the sigma Settings derived from theme + the user's display sliders.
import type { Settings } from "sigma/settings";
import type { GraphSettings } from "./graphSettings";

export interface GraphTheme {
  bg: string;
  node: string;
  nodeUnresolved: string;
  ink: string;
  edge: string; // rgba w/ alpha — sigma honours the alpha channel (unlike cytoscape WebGL)
  edgeHi: string;
  accent: string;
}

// Decide light/dark from the ACTUAL rendered --bg, not data-theme: the
// attribute can read stale in the window between mount and the app's theme
// effect, which would paint invisible (dark-on-dark) nodes.
function isDarkBackground(cs: CSSStyleDeclaration): boolean {
  const bg = cs.getPropertyValue("--bg").trim();
  const m =
    /^#([0-9a-f]{6})$/i.exec(bg) ??
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(bg);
  if (!m) return true;
  let r: number, g: number, b: number;
  if (m[0].startsWith("#")) {
    const h = m[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    r = +m[1];
    g = +m[2];
    b = +m[3];
  }
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

export function readTheme(): GraphTheme {
  const cs = getComputedStyle(document.documentElement);
  const dark = isDarkBackground(cs);
  return {
    bg: cs.getPropertyValue("--bg").trim() || (dark ? "#0f1115" : "#fafaf9"),
    ink: cs.getPropertyValue("--ink").trim() || (dark ? "#e6e8eb" : "#111418"),
    node: dark ? "#c8c8c8" : "#3a3f47",
    nodeUnresolved: dark ? "#6e7079" : "#9aa0a8",
    // Faint hairline edges, Obsidian-style. Alpha is honoured by sigma.
    edge: dark ? "rgba(220,224,230,0.18)" : "rgba(30,35,45,0.14)",
    edgeHi: dark ? "rgba(220,224,230,0.95)" : "rgba(30,35,45,0.85)",
    accent:
      cs.getPropertyValue("--accent").trim() || (dark ? "#7aa7ff" : "#3b82f6"),
  };
}

// textFadeThreshold (0.1..3, default 1.1) → labelRenderedSizeThreshold. sigma
// shows a node's label only once its RENDERED size clears the threshold, and
// picks the largest node per grid cell — so hubs label first and the overview
// shows none. Higher slider → higher threshold → labels appear later.
export function buildSigmaSettings(
  theme: GraphTheme,
  s: GraphSettings,
): Partial<Settings> {
  const sansFont =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-sans")
      .trim() || "Inter, system-ui, sans-serif";
  return {
    // edges — faint straight hairlines
    defaultEdgeColor: theme.edge,
    defaultEdgeType: s.arrows ? "arrow" : "line",
    minEdgeThickness: 0.4,
    enableEdgeEvents: false,
    // labels — Obsidian-style hub-first zoom reveal
    renderLabels: true,
    labelColor: { color: theme.ink },
    labelDensity: 0.6,
    labelGridCellSize: 130,
    labelRenderedSizeThreshold: Math.max(
      1,
      8 + (s.textFadeThreshold - 1.1) * 8,
    ),
    labelFont: sansFont,
    labelSize: 12,
    // nodes
    defaultNodeColor: theme.node,
    zIndex: true,
  };
}
