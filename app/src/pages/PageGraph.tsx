// Graph page — Obsidian-style interactive force-directed graph of the
// vault. cytoscape-d3-force runs the same family of forces Obsidian
// itself uses (forceLink + forceManyBody + forceX/Y), so dragging a
// node pulls its neighbours through the simulation and every slider
// in the right-side drawer maps 1:1 onto a real d3-force parameter.

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import cytoscape from "cytoscape";
import type {
  Core,
  ElementDefinition,
  StylesheetCSS,
  LayoutOptions,
} from "cytoscape";
import d3Force from "cytoscape-d3-force";
import GraphControls from "../components/GraphControls";
import {
  DEFAULT_GRAPH_SETTINGS,
  loadGraphSettings,
  saveGraphSettings,
  type GraphSettings,
} from "../lib/graphSettings";
import type { Strings } from "../lib/i18n";
import type { Adjacency, FileNode } from "../lib/ipc";
import { useUIStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { ipc } from "../lib/ipc";

// Obsidian's graph view uses a deliberately monochrome palette: every
// node is the same shade and structure comes from degree-driven sizing
// + a force layout, not from colour. We mirror that.
interface ThemeColors {
  bg: string;
  node: string;
  nodeUnresolved: string;
  ink: string;
  edge: string;
  edgeHi: string;
  accent: string;
}

// Decide light/dark from the ACTUAL rendered background, not the
// data-theme attribute. The attribute can read stale during the brief
// window between mount and App's theme effect, which left graph nodes
// painted with the light-theme (dark) colour on a dark canvas —
// invisible. The computed --bg is always whatever is really on screen.
function isDarkBackground(cs: CSSStyleDeclaration): boolean {
  const bg = cs.getPropertyValue("--bg").trim();
  const m =
    /^#([0-9a-f]{6})$/i.exec(bg) ??
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(bg);
  if (!m) return true; // default to dark — the app ships dark
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
  // Perceived luminance (0..255). < 128 → dark background.
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function readThemeColors(): ThemeColors {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const dark = isDarkBackground(cs);
  return {
    bg: cs.getPropertyValue("--bg").trim() || (dark ? "#0f1115" : "#fafaf9"),
    ink: cs.getPropertyValue("--ink").trim() || (dark ? "#e6e8eb" : "#111418"),
    node: dark ? "#c8c8c8" : "#3a3f47",
    nodeUnresolved: dark ? "#6e7079" : "#9aa0a8",
    // Faint hairline web like Obsidian — traceable but it whispers,
    // never shouts. 0.28 read as harsh solid wires; 0.13 (dark) / 0.10
    // (light) is the "gentle web" weight. Hover still snaps the
    // neighbourhood to full strength below.
    edge: dark ? "rgba(220, 224, 230, 0.13)" : "rgba(30, 35, 45, 0.10)",
    edgeHi: dark ? "rgba(220, 224, 230, 0.95)" : "rgba(30, 35, 45, 0.85)",
    accent:
      cs.getPropertyValue("--accent").trim() || (dark ? "#7aa7ff" : "#3b82f6"),
  };
}

let layoutRegistered = false;
function ensureLayoutRegistered(): void {
  if (!layoutRegistered) {
    cytoscape.use(d3Force);
    layoutRegistered = true;
  }
}

export default function PageGraph({ t }: { t: Strings }): JSX.Element {
  const adjacency = useVaultStore((s) => s.adjacency);
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentVault = useVaultStore((s) => s.currentVault);
  const setRoute = useUIStore((s) => s.setRoute);
  const theme = useUIStore((s) => s.theme);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const layoutRef = useRef<cytoscape.Layouts | null>(null);
  const settingsRef = useRef<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const [settings, setSettings] = useState<GraphSettings>(() =>
    loadGraphSettings(),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Timelapse state — animation that reveals nodes oldest-to-newest.
  // "Animate" — Obsidian's actual mechanic per the help docs:
  // "Initiates a time-lapse animation where nodes appear in
  // chronological order based on creation time." Nodes are inserted
  // into a live physics simulation one at a time; each insertion
  // perturbs the running graph so existing nodes wiggle as new edges
  // pull on them. Confirmed by Obsidian forum threads.
  const [tlPlaying, setTlPlaying] = useState(false);
  const tlTickRef = useRef<number | null>(null);
  const tlOrderRef = useRef<string[]>([]);
  const tlQueueRef = useRef<string[]>([]); // mutable, drains during play
  const tlAdjRef = useRef<Map<string, Set<string>> | null>(null);
  const tlFullElsRef = useRef<ElementDefinition[] | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    saveGraphSettings(settings);
  }, [settings]);

  const tags = useMemo(() => collectTags(adjacency?.tags ?? {}), [adjacency]);
  const folders = useMemo(
    () => collectFolders(currentVault?.path ?? "", adjacency),
    [adjacency, currentVault?.path],
  );
  // Every markdown file in the vault — including ones with no links at
  // all. Obsidian shows these as free-floating "orphan" dots; we only
  // had nodes that appeared in the link graph, so link-less files were
  // silently missing. Feeding the full list in lets them render.
  const allFiles = useMemo(() => flattenMarkdown(fileTree), [fileTree]);

  // (A) Mount cytoscape once. The instance is reused across every
  // settings change to avoid re-laying-out from scratch and to keep
  // the user's pan/zoom position stable.
  useEffect(() => {
    if (!containerRef.current) return;
    ensureLayoutRegistered();
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: makeStyle(readThemeColors(), settingsRef.current),
      wheelSensitivity: 0.2,
      minZoom: 0.02,
      maxZoom: 8,
      pixelRatio: window.devicePixelRatio,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (e) => {
      // Tap only — not the end of a drag. Cytoscape fires "tap" only
      // when click+release happens without movement past a small
      // threshold, so this matches Obsidian's "click to open".
      const id = e.target.id();
      setRoute(`page:${id}`);
    });

    cy.on("mouseover", "node", (e) => {
      const n = e.target;
      const nbh = n.closedNeighborhood();
      cy.elements().not(nbh).addClass("dimmed");
      nbh.addClass("highlight");
      nbh.nodes().addClass("labels-on");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("dimmed highlight");
      applyLabelVisibility(cy, settingsRef.current.textFadeThreshold);
    });

    cy.on("zoom", () => {
      applyLabelVisibility(cy, settingsRef.current.textFadeThreshold);
    });

    // Re-read the theme after mount. This effect runs before the app's
    // theme effect has set data-theme (confirmed: the first read sees
    // bg=#ffffff / data-theme=null and would paint light-on-dark colours
    // — invisible nodes). Re-applying once the palette has settled fixes
    // it. rAF catches the common case; the timeout is a slow-cold-start
    // safety net.
    const restyle = (): void => {
      if (cyRef.current) {
        cyRef.current.style(
          makeStyle(readThemeColors(), settingsRef.current),
        );
      }
    };
    const raf = requestAnimationFrame(restyle);
    const safety = window.setTimeout(restyle, 300);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
      layoutRef.current?.stop();
      layoutRef.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (B) Re-style when theme changes or visual options change. This is
  // cheap — cytoscape re-applies the stylesheet without re-laying out.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(makeStyle(readThemeColors(), settings));
    applyLabelVisibility(cy, settings.textFadeThreshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    theme,
    settings.arrows,
    settings.linkThickness,
    settings.textFadeThreshold,
  ]);

  // (C) Rebuild elements when the underlying graph or filter set
  // changes, then restart the layout so the new subgraph settles.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !adjacency) return;
    const allowed = computeAllowed(adjacency, allFiles, {
      tagFilter: settings.tagFilter,
      folderFilter: settings.folderFilter,
      vaultRoot: currentVault?.path ?? "",
      search: settings.search,
      existingOnly: settings.existingOnly,
      showOrphans: settings.showOrphans,
    });
    const elements = buildElements(
      adjacency,
      allowed,
      allFiles,
      settings.nodeSize,
    );
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
    setCounts({ nodes: cy.nodes().length, edges: cy.edges().length });
    if (elements.length === 0) return;
    // Fresh elements were just added → every node is at 0,0. Pass
    // randomize:true so the first run scatters them before settling.
    const layout = runLayout(cy, settings, true);
    // Frame the graph once it has actually SETTLED. The old code fit at
    // fixed 900/2400ms timers — both fire mid-simulation (it runs ~6s),
    // so the camera locked onto a half-spread graph and the final
    // resting layout drifted out of frame, leaving a sparse, off-centre
    // mess. An early fit keeps something on screen during the settle;
    // the layoutstop fit nails the final framing.
    const currentPath = currentVault?.path ?? "";
    if (cy.scratch("_graph.lastVaultPath") !== currentPath) {
      const early = window.setTimeout(() => {
        if (!cy.destroyed()) cy.fit(undefined, 40);
      }, 700);
      const onStop = (): void => {
        if (!cy.destroyed()) {
          cy.fit(undefined, 40);
          applyLabelVisibility(cy, settingsRef.current.textFadeThreshold);
        }
      };
      layout.one("layoutstop", onStop);
      cy.scratch("_graph.lastVaultPath", currentPath);
      cy.scratch("_graph.fitTimers", [early]);
    }
    applyLabelVisibility(cy, settings.textFadeThreshold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adjacency,
    allFiles,
    settings.tagFilter,
    settings.folderFilter,
    settings.search,
    settings.existingOnly,
    settings.showOrphans,
    settings.nodeSize,
    currentVault?.path,
  ]);

  // (D) Restart the d3-force simulation when any force slider changes.
  // d3-force exposes the four Obsidian sliders natively, so this is a
  // single re-run with the new parameter values.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    runLayout(cy, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.centerForce,
    settings.repelForce,
    settings.linkForce,
    settings.linkDistance,
  ]);

  // Fetch mtimes whenever the vault changes — drives the timelapse
  // node-insertion order (oldest file first).
  useEffect(() => {
    if (!currentVault?.path) return;
    let cancelled = false;
    ipc
      .fileMtimes(currentVault.path)
      .then((rows) => {
        if (cancelled) return;
        tlOrderRef.current = [...rows]
          .sort((a, b) => a[1] - b[1])
          .map((r) => r[0]);
      })
      .catch(() => {
        /* mtime unavailable — timelapse just won't fire */
      });
    return () => {
      cancelled = true;
    };
  }, [currentVault?.path]);

  // Play — Obsidian's actual time-lapse animation.
  //
  // Mechanism (per obsidian.md/help and forum verification):
  //   • Sort nodes by file creation time (we use mtime as proxy).
  //   • Start with an empty graph and an already-running simulation.
  //   • On a fast interval, add the next node + every edge whose
  //     other endpoint is *already in the graph*. Each insertion
  //     gives the simulation a small kick (alpha back up to 0.5),
  //     so the new node falls toward its hub and the existing graph
  //     wiggles in response.
  //   • When all nodes have been added, let the simulation cool
  //     normally and fit the camera.
  const startTimelapse = (): void => {
    const cy = cyRef.current;
    if (!cy) return;

    const fullEls = cy.elements().jsons() as ElementDefinition[];
    tlFullElsRef.current = fullEls;

    // Build a neighbour-set lookup from the full element list so the
    // per-tick "does this node have an already-visible friend?" check
    // is O(1) instead of O(edges).
    const adj = new Map<string, Set<string>>();
    fullEls.forEach((e) => {
      if (!e.data?.source) return;
      const src = e.data.source as string;
      const tgt = e.data.target as string;
      if (!adj.has(src)) adj.set(src, new Set());
      if (!adj.has(tgt)) adj.set(tgt, new Set());
      adj.get(src)!.add(tgt);
      adj.get(tgt)!.add(src);
    });
    tlAdjRef.current = adj;

    // file_mtimes returns EVERY .md file in the vault, but only files
    // that are actual graph nodes (have or receive a wikilink) appear
    // on the canvas. Insert order must be restricted to those, or the
    // timelapse spends its first many ticks "revealing" link-less notes
    // that never render — leaving the canvas blank for seconds before
    // anything appears. Filter to graph nodes, preserving mtime order.
    const nodeIds = new Set(
      fullEls
        .filter((e) => e.data && !e.data.source)
        .map((e) => e.data!.id as string),
    );
    const order = tlOrderRef.current.filter((p) => nodeIds.has(p));
    // Fallback: if mtimes never loaded (or matched nothing), reveal in
    // adjacency order so Play still does something rather than nothing.
    const insertOrder =
      order.length > 0 ? order : Array.from(nodeIds);
    if (insertOrder.length === 0) return;
    tlOrderRef.current = insertOrder;
    tlQueueRef.current = [...insertOrder];

    const prevLayout = cy.scratch("_graph.layout") as
      | cytoscape.Layouts
      | undefined;
    prevLayout?.stop();
    cy.elements().remove();
    runLayoutGrowing(cy, settingsRef.current);
    setTlPlaying(true);

    // Pace the reveal so the whole vault finishes in ~16s regardless of
    // size: a 130-node vault gets a leisurely ~120ms/node, an 800-node
    // vault speeds up to the 35ms floor. Every tick now adds a real
    // node (dead ticks were removed above), so the cadence is honest.
    const stepInterval = Math.max(
      35,
      Math.min(160, Math.round(16000 / insertOrder.length)),
    );
    tlTickRef.current = window.setInterval(() => {
      const cyNow = cyRef.current;
      const adjNow = tlAdjRef.current;
      const queue = tlQueueRef.current;
      const els = tlFullElsRef.current;
      if (!cyNow || !adjNow || !els) return;

      if (queue.length === 0) {
        if (tlTickRef.current != null) {
          window.clearInterval(tlTickRef.current);
          tlTickRef.current = null;
        }
        runLayoutAnimated(cyNow, settingsRef.current);
        window.setTimeout(() => {
          if (!cyNow.destroyed()) cyNow.fit(undefined, 30);
        }, 1500);
        setTlPlaying(false);
        return;
      }

      // Obsidian's "Orphans off" mode trick: prefer to insert a node
      // that already has a visible neighbour. That way every newly
      // appearing node visibly attaches to the growing graph instead
      // of popping in as a lonely dot. If nothing has a neighbour yet
      // (e.g. first insert), fall back to the head of the queue.
      let pickIdx = -1;
      for (let i = 0; i < queue.length; i++) {
        const candidate = queue[i];
        const neighbours = adjNow.get(candidate);
        if (!neighbours) continue;
        for (const n of neighbours) {
          if (cyNow.getElementById(n).length > 0) {
            pickIdx = i;
            break;
          }
        }
        if (pickIdx !== -1) break;
      }
      if (pickIdx === -1) pickIdx = 0;
      const path = queue.splice(pickIdx, 1)[0];
      const nodeJson = els.find(
        (e) => e.data?.id === path && !e.data?.source,
      );
      if (!nodeJson || cyNow.getElementById(path).length > 0) return;

      // Spawn position. A node with already-visible neighbours appears
      // RIGHT AT its hub so the hub-and-spoke shape builds outward. The
      // very first node lands dead-centre. Link-less orphans drop onto a
      // ring around the centre (random angle, near the current radius)
      // so they fan out evenly instead of piling at origin and trailing
      // off in one direction — the graph grows as a round, centred disk.
      let nbCount = 0;
      let avgX = 0;
      let avgY = 0;
      const neighbours = adjNow.get(path);
      if (neighbours) {
        for (const n of neighbours) {
          const node = cyNow.getElementById(n);
          if (node.length === 0) continue;
          const p = node.position();
          avgX += p.x;
          avgY += p.y;
          nbCount += 1;
        }
      }
      let spawnX: number;
      let spawnY: number;
      if (nbCount > 0) {
        spawnX = avgX / nbCount + (Math.random() - 0.5) * 30;
        spawnY = avgY / nbCount + (Math.random() - 0.5) * 30;
      } else if (cyNow.nodes().length === 0) {
        spawnX = 0;
        spawnY = 0;
      } else {
        const bb = cyNow.elements().boundingBox();
        const radius = Math.max(80, Math.max(bb.w, bb.h) / 2);
        const angle = Math.random() * Math.PI * 2;
        const r = radius * (0.7 + Math.random() * 0.4);
        spawnX = Math.cos(angle) * r;
        spawnY = Math.sin(angle) * r;
      }

      cyNow.batch(() => {
        cyNow.add(nodeJson);
        const newNode = cyNow.getElementById(path);
        newNode.position({ x: spawnX, y: spawnY });
        newNode.scratch("d3-force", {
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
        });
        // Add every edge whose other endpoint is already in cy.
        els.forEach((e) => {
          if (!e.data?.source) return;
          const src = e.data.source as string;
          const tgt = e.data.target as string;
          if (src !== path && tgt !== path) return;
          const other = src === path ? tgt : src;
          if (other === path) return;
          if (
            cyNow.getElementById(other).length > 0 &&
            cyNow.getElementById(e.data.id as string).length === 0
          ) {
            cyNow.add(e);
          }
        });
      });

      runLayoutGrowing(cyNow, settingsRef.current);

      // Refit every 4 inserts — gives the camera time to follow the
      // expanding cluster without jumping on every single node.
      const consumed = insertOrder.length - queue.length;
      if (consumed % 4 === 0) {
        cyNow.animate(
          { fit: { eles: cyNow.elements(), padding: 40 } },
          { duration: 220, easing: "ease-out-quad" },
        );
      }
    }, stepInterval);
  };

  const pauseTimelapse = (): void => {
    if (tlTickRef.current != null) {
      window.clearInterval(tlTickRef.current);
      tlTickRef.current = null;
    }
    const cy = cyRef.current;
    if (cy) {
      const layout = cy.scratch("_graph.layout") as
        | cytoscape.Layouts
        | undefined;
      layout?.stop();
    }
    setTlPlaying(false);
  };

  // Track visible-node and edge counts as state so the toolbar reflects
  // the *current* cytoscape state — cyRef changes don't trigger a
  // rerender on their own.
  const [counts, setCounts] = useState<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  });
  const nodeCount = counts.nodes;
  const edgeCount = counts.edges;
  const totalNodes = countAllNodes(adjacency);

  return (
    <div className="workspace workspace-wide">
      <header className="page-head">
        <div className="page-eyebrow">{t.nav_graph}</div>
        <h1 className="page-title">{t.gr_title}</h1>
        <p className="page-lede">{t.gr_lede}</p>
      </header>
      <div className="graph-shell">
        <div className="graph-toolbar">
          <span className="graph-stat">
            {nodeCount}/{totalNodes} {t.gr_node_count}
          </span>
          <span className="graph-stat">
            {edgeCount} {t.gr_edge_count}
          </span>
          <div className="graph-toolbar__spacer" />
          <button
            type="button"
            className="graph-toolbar__btn"
            onClick={tlPlaying ? pauseTimelapse : startTimelapse}
            aria-pressed={tlPlaying}
            aria-label={
              tlPlaying
                ? (t.gr_timelapse_pause ?? "Pause timelapse")
                : (t.gr_timelapse_play ?? "Play timelapse")
            }
            title={
              tlPlaying
                ? (t.gr_timelapse_pause ?? "Pause timelapse")
                : (t.gr_timelapse_play ?? "Play timelapse")
            }
          >
            {tlPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="3" height="8" />
                <rect x="7" y="2" width="3" height="8" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 2 L10 6 L3 10 Z" />
              </svg>
            )}
          </button>
          <ZoomButtons cyRef={cyRef} />
          <button
            type="button"
            className="graph-toolbar__btn"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-pressed={drawerOpen}
            aria-label={t.gr_settings ?? "Graph settings"}
            title={t.gr_settings ?? "Graph settings"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="3"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="graph-body">
          <div className="graph-canvas-wrap">
            {/* Cytoscape lives in this div for the page's entire lifetime.
                Conditionally toggling `visibility` breaks cytoscape's
                container measurement, so we keep it visible and put the
                empty-state overlay on top instead. */}
            <div ref={containerRef} className="graph-canvas" />
            {totalNodes === 0 ? (
              <p className="muted graph-empty">
                {t.gr_empty_pre ??
                  "No wikilinks found in the vault yet. Add some "}
                <code style={{ fontFamily: "var(--font-mono)" }}>
                  [[wikilinks]]
                </code>
                {t.gr_empty_post ?? " to see the graph grow."}
              </p>
            ) : null}
          </div>
          <GraphControls
            t={t}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((v) => !v)}
            settings={settings}
            onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onReset={() =>
              setSettings({ ...DEFAULT_GRAPH_SETTINGS, search: "" })
            }
            tags={tags}
            folders={folders}
            tlPlaying={tlPlaying}
            onTimelapse={tlPlaying ? pauseTimelapse : startTimelapse}
          />
        </div>
      </div>
    </div>
  );
}

function ZoomButtons({
  cyRef,
}: {
  cyRef: React.MutableRefObject<Core | null>;
}): JSX.Element {
  const zoomBy = (factor: number): void => {
    const cy = cyRef.current;
    if (!cy) return;
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: center });
  };
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={() => zoomBy(0.7)}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={() => cyRef.current?.fit(undefined, 30)}
        aria-label="Fit"
      >
        fit
      </button>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={() => zoomBy(1.4)}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}

// Slider → d3-force mapping. This is the whole reason Obsidian's
// graph view spreads into discrete dandelions while a naive linear
// mapping balls everything up: Obsidian internally amplifies repel by
// ~×100, scales center by ×0.1, and divides each link's pull by
// sqrt(min(source.degree, target.degree)) so hub-to-hub springs
// barely tug while leaf-to-hub springs hold tight.
//
// Confirmed against the Obsidian-extended-graph plugin source and the
// `obsidian-typings` ForceOptions definition. With these numbers an
// 800-node tree-shaped vault renders as discrete dandelions instead
// of a single hairball; smaller vaults still look natural because the
// scaling is multiplicative.
const REPEL_SCALE = 100; // slider 10 → manyBodyStrength −1000
const CENTER_SCALE = 0.1; // slider 0.5 → xStrength 0.05

interface D3Node {
  id: string;
  size?: number;
  deg?: number;
}
interface D3Link {
  source: D3Node | string;
  target: D3Node | string;
}

function buildForceOpts(settings: GraphSettings): Record<string, unknown> {
  // Per-link strength is degree-normalised the same way Obsidian does:
  // a leaf with degree 1 attached to a hub of degree 30 contributes
  // strength linkForce / sqrt(1) = linkForce, but two hubs of degree
  // 30 linked together pull each other with only linkForce / sqrt(30)
  // ≈ 0.18 × linkForce. That's what lets clusters drift apart instead
  // of collapsing along their shared spine.
  const linkStrength = (link: D3Link): number => {
    const s = typeof link.source === "object" ? Number(link.source.deg ?? 1) : 1;
    const t = typeof link.target === "object" ? Number(link.target.deg ?? 1) : 1;
    return settings.linkForce / Math.max(1, Math.sqrt(Math.min(s, t)));
  };
  return {
    name: "d3-force",
    animate: true,
    fit: false,
    infinite: false,
    ungrabifyWhileSimulating: false,
    fixedAfterDragging: false,
    // cytoscape-d3-force re-seeds EVERY node's position on each
    // layout.run() — with randomize:true it scatters them all to fresh
    // random spots in the viewport. That's only wanted for the very
    // first layout of a freshly-added graph (otherwise all nodes pile
    // at 0,0 and the sim explodes). For re-runs — force-slider tweaks,
    // and especially the timelapse which re-runs every insert — it must
    // be false, or the accumulated layout is wiped out on every tick
    // and the graph reads as a tangled web of long crossing edges.
    // Callers opt in via runLayout(cy, settings, /*randomize*/ true).
    randomize: false,
    padding: 30,
    linkId: (d: { id: string }) => d.id,
    linkDistance: settings.linkDistance,
    linkStrength,
    linkIterations: 1,
    manyBodyStrength: -settings.repelForce * REPEL_SCALE,
    manyBodyTheta: 0.9,
    manyBodyDistanceMin: 1,
    // manyBodyDistanceMax is set per-run in runLayoutWith, scaled to the
    // node count: a small vault needs a tight cap so orphans bunch into a
    // small disk, a big vault needs a wide cap so its many clusters can
    // spread. A single fixed value can't serve both.
    manyBodyDistanceMax: 600,
    xStrength: Math.max(0.005, settings.centerForce * CENTER_SCALE),
    xX: 0,
    yStrength: Math.max(0.005, settings.centerForce * CENTER_SCALE),
    yY: 0,
    // Generous personal-space ring around every node. A large, firm
    // collision radius is what gives Obsidian its even spacing — nodes
    // (including orphans) settle into a roughly uniform minimum gap
    // instead of clumping. 2 iterations make the constraint hold.
    collideRadius: (n: D3Node) => (Number(n.size) || 6) / 2 + 10,
    collideStrength: 1,
    collideIterations: 2,
  };
}

// Repulsion-range cap scaled to graph size. Roughly the radius the node
// disk wants to occupy: small vaults get a tight cap (orphans hug the
// core), big vaults a wide one (clusters spread). Clamped to a sane band.
function scaledDistanceMax(nodeCount: number): number {
  return Math.max(300, Math.min(1600, Math.round(300 + 0.72 * nodeCount)));
}

function runLayoutWith(
  cy: Core,
  settings: GraphSettings,
  override: Record<string, unknown>,
): cytoscape.Layouts {
  const layoutOpts = {
    ...buildForceOpts(settings),
    manyBodyDistanceMax: scaledDistanceMax(cy.nodes().length),
    ...override,
  } as unknown as LayoutOptions;
  cy.stop();
  const prev =
    (cy.scratch("_graph.layout") as cytoscape.Layouts | undefined) ?? null;
  prev?.stop();
  const layout = cy.layout(layoutOpts);
  cy.scratch("_graph.layout", layout);
  layout.run();
  return layout;
}

// `randomize` should be true ONLY when the graph was just (re)built and
// every node is sitting at 0,0 — that's the one case where we need
// cytoscape-d3-force to scatter them before the sim runs. A re-run on an
// already-laid-out graph (slider tweak) passes false to preserve it.
function runLayout(
  cy: Core,
  settings: GraphSettings,
  randomize = false,
): cytoscape.Layouts {
  // d3-force default alphaDecay 0.0228 settles in ~300 ticks; we slow
  // it slightly so dense graphs have enough cooling time to find the
  // dandelion configuration before the simulation freezes.
  return runLayoutWith(cy, settings, {
    randomize,
    alpha: 1,
    alphaDecay: 0.018,
    alphaMin: 0.001,
    velocityDecay: 0.45,
  });
}

// Cinematic form-up for the timelapse "play" button — same forces,
// just slower decay so the eye can follow each node falling into
// place. velocityDecay 0.65 cuts momentum each tick so leaves drift
// toward their hub at a watchable speed. randomize stays false: by the
// time this runs the timelapse has placed every node, and re-scattering
// would throw the finished graph back into chaos.
function runLayoutAnimated(
  cy: Core,
  settings: GraphSettings,
): cytoscape.Layouts {
  return runLayoutWith(cy, settings, {
    alpha: 1,
    alphaDecay: 0.006,
    alphaMin: 0.001,
    velocityDecay: 0.65,
  });
}

// Variant used during per-node-insert animation: very low alpha gives
// each insertion a small kick rather than restarting the whole
// simulation, so the already-placed graph barely flinches.
function runLayoutGrowing(
  cy: Core,
  settings: GraphSettings,
): cytoscape.Layouts {
  return runLayoutWith(cy, settings, {
    alpha: 0.2,
    alphaDecay: 0.04,
    alphaMin: 0.001,
    velocityDecay: 0.75,
  });
}

function applyLabelVisibility(cy: Core, threshold: number): void {
  // Three-tier label visibility, matching how Obsidian feels at
  // different zoom levels:
  //   • zoom < hubThreshold       → only hovered labels (handled
  //                                  separately via .highlight class)
  //   • hubThreshold ≤ zoom < full → only hubs (degree ≥ 2) show
  //   • zoom ≥ full                → everything shows
  // Small graphs (≤ 80 nodes) always show every label — there's room,
  // and hiding them on a 21-node vault just looked broken.
  const zoom = cy.zoom();
  const smallGraph = cy.nodes().length <= 80;
  const showAll = smallGraph || zoom >= threshold;
  const showHubs = zoom >= threshold * 0.5;
  cy.batch(() => {
    cy.nodes().forEach((n) => {
      if (n.hasClass("highlight")) {
        n.addClass("labels-on");
        return;
      }
      const deg = Number(n.data("deg") ?? 0);
      if (showAll || (showHubs && deg >= 2)) n.addClass("labels-on");
      else n.removeClass("labels-on");
    });
  });
}

interface AllowFilterOpts {
  tagFilter: string | null;
  folderFilter: string | null;
  vaultRoot: string;
  search: string;
  existingOnly: boolean;
  showOrphans: boolean;
}

function computeAllowed(
  adjacency: Adjacency,
  allFiles: string[],
  {
    tagFilter,
    folderFilter,
    vaultRoot,
    search,
    existingOnly,
    showOrphans,
  }: AllowFilterOpts,
): Set<string> {
  const all = new Set<string>();
  // Every real markdown file is a candidate node — even link-less ones,
  // so orphans show up like they do in Obsidian.
  for (const p of allFiles) all.add(p);
  for (const p of Object.keys(adjacency.forward)) all.add(p);
  for (const targets of Object.values(adjacency.forward)) {
    for (const p of targets) all.add(p);
  }
  for (const p of Object.keys(adjacency.tags)) all.add(p);

  // A node is "resolved" (a real file) if it exists on disk. Targets of
  // wikilinks that resolved are real too.
  const resolved = new Set<string>(allFiles);
  for (const p of Object.keys(adjacency.forward)) resolved.add(p);
  const needle = search.trim().toLowerCase();

  // First pass: apply filters that don't depend on the surviving
  // subgraph (tag, folder, search, existingOnly).
  const candidates = new Set<string>();
  for (const p of all) {
    if (tagFilter && !(adjacency.tags[p] ?? []).includes(tagFilter)) continue;
    if (folderFilter && !inFolder(vaultRoot, p, folderFilter)) continue;
    if (existingOnly && !resolved.has(p)) continue;
    if (needle && !stem(p).toLowerCase().includes(needle)) continue;
    candidates.add(p);
  }

  if (showOrphans) return candidates;

  // Second pass: drop nodes with no edges into the surviving subgraph.
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

function buildElements(
  adjacency: Adjacency,
  allowed: Set<string>,
  allFiles: string[],
  sizeMultiplier: number,
): ElementDefinition[] {
  const nodes = new Set<string>();
  const edges: ElementDefinition[] = [];
  const degree = new Map<string, number>();
  // Real files (on disk) render as solid nodes; only unresolved wikilink
  // targets are ghosts. Files with no out-links are still real.
  const resolved = new Set<string>(allFiles);
  for (const p of Object.keys(adjacency.forward)) resolved.add(p);

  for (const [source, targets] of Object.entries(adjacency.forward)) {
    if (!allowed.has(source)) continue;
    nodes.add(source);
    for (const target of targets) {
      if (!allowed.has(target)) continue;
      nodes.add(target);
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
      edges.push({
        data: { id: `${source}::${target}`, source, target },
      });
    }
  }

  // Allow allowed-but-isolated nodes through (showOrphans = true).
  for (const p of allowed) nodes.add(p);

  return [
    ...Array.from(nodes).map((p) => {
      const deg = degree.get(p) ?? 0;
      // Obsidian-style sizing: leaves are small dots (~4px), hubs
      // swell up to ~22px. Wide hub/leaf ratio is what makes the
      // dandelion silhouette pop — leaves recede into the periphery
      // while the hub anchors each cluster.
      const base = Math.max(4, Math.min(22, 4 + Math.sqrt(deg) * 3.2));
      return {
        data: {
          id: p,
          label: stem(p),
          deg,
          size: base * sizeMultiplier,
          unresolved: resolved.has(p) ? 0 : 1,
        },
        classes: resolved.has(p) ? "resolved" : "unresolved",
      };
    }),
    ...edges,
  ];
}

function collectTags(map: Record<string, string[]>): string[] {
  const set = new Set<string>();
  for (const arr of Object.values(map)) {
    for (const tag of arr) set.add(tag);
  }
  return Array.from(set).sort();
}

// Flatten the recursive vault tree into a flat list of every .md file
// path. Used to seed the graph with link-less "orphan" nodes.
function flattenMarkdown(tree: FileNode[]): string[] {
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

function collectFolders(root: string, adjacency: Adjacency | null): string[] {
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

function inFolder(root: string, path: string, folder: string): boolean {
  const trimmed = root.replace(/[\\/]+$/, "");
  if (!path.startsWith(trimmed)) return false;
  const rel = path.slice(trimmed.length).replace(/^[\\/]+/, "");
  return rel.startsWith(`${folder}/`) || rel.startsWith(`${folder}\\`);
}

function stem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function countAllNodes(adjacency: Adjacency | null): number {
  if (!adjacency) return 0;
  const set = new Set<string>();
  for (const p of Object.keys(adjacency.forward)) set.add(p);
  for (const arr of Object.values(adjacency.forward)) {
    for (const p of arr) set.add(p);
  }
  for (const p of Object.keys(adjacency.tags)) set.add(p);
  return set.size;
}

function makeStyle(c: ThemeColors, s: GraphSettings): StylesheetCSS[] {
  // Obsidian-thin hairlines. 0.55 base × thickness slider; 0.4px floor
  // keeps edges from disappearing entirely at the slider's minimum.
  const edgeWidth = Math.max(0.4, 0.55 * s.linkThickness);
  return [
    {
      selector: "node",
      css: {
        "background-color": c.node,
        label: "data(label)",
        color: c.ink,
        // 6px was unreadable at any sane fit zoom; 11px is the smallest
        // that stays legible once the camera zooms out to frame the graph.
        "font-size": 11,
        "font-weight": 400,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 3,
        "text-outline-width": 0,
        "text-outline-opacity": 0,
        "text-wrap": "ellipsis",
        "text-max-width": "120px",
        "text-opacity": 0,
        width: "data(size)",
        height: "data(size)",
        "border-width": 0,
        "transition-property":
          "opacity, text-opacity, border-width, background-color",
        "transition-duration": 120,
      },
    },
    {
      selector: "node.unresolved",
      css: {
        "background-color": c.nodeUnresolved,
        "background-opacity": 0.7,
      },
    },
    {
      selector: "edge",
      css: {
        "line-color": c.edge,
        // Always haystack — straight pixel-thin lines, Obsidian style.
        // Bezier curves with arrows make the visual look more like a
        // workflow diagram than a knowledge graph.
        "curve-style": s.arrows ? "bezier" : "haystack",
        "haystack-radius": 0,
        width: edgeWidth,
        "target-arrow-shape": s.arrows ? "triangle" : "none",
        "target-arrow-color": c.edge,
        "arrow-scale": 0.6,
        "transition-property": "line-color, opacity, width",
        "transition-duration": 120,
      },
    },
    {
      selector: "node.highlight",
      css: {
        "border-width": 2,
        "border-color": c.ink,
        "text-opacity": 1,
        color: c.ink,
      },
    },
    {
      selector: "edge.highlight",
      css: {
        "line-color": c.edgeHi,
        "target-arrow-color": c.edgeHi,
        // Triple the width on hover — combined with the jump from 6%
        // to 95% opacity it makes the neighbourhood "snap into focus".
        width: Math.max(edgeWidth * 3, 1.3),
      },
    },
    {
      selector: ".dimmed",
      css: {
        // Obsidian dims non-neighbour nodes to ~25%, not all the way
        // down — keeps the rest of the graph as gentle context
        // instead of erasing it.
        opacity: 0.25,
      },
    },
    {
      selector: "node:selected",
      css: {
        "border-width": 2,
        "border-color": c.accent,
        "text-opacity": 1,
      },
    },
    {
      selector: "node.labels-on",
      css: {
        "text-opacity": 1,
      },
    },
    {
      selector: "node:grabbed",
      css: {
        "border-width": 2,
        "border-color": c.accent,
        "text-opacity": 1,
      },
    },
  ];
}
