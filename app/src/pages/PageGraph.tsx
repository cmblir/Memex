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
    // Hairline web like Obsidian — visible enough to read the
    // connections, quiet enough not to shout. 0.18 (dark) / 0.14 (light).
    // Hover still snaps the neighbourhood to full strength below.
    edge: dark ? "rgba(220, 224, 230, 0.18)" : "rgba(30, 35, 45, 0.14)",
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
  // Timelapse — reveals nodes oldest-to-newest. Earlier versions re-ran
  // the whole force layout on every insert, which on an 1800-node vault
  // meant thousands of physics rebuilds: severe lag, and the camera
  // lurched as it kept re-fitting a partial graph. This version is a
  // pure REVEAL: the graph is already settled, so we just un-hide nodes
  // in mtime order at their final positions with the camera fixed. Zero
  // physics → smooth even on mobile.
  const [tlPlaying, setTlPlaying] = useState(false);
  const tlRafRef = useRef<number | null>(null);
  const tlOrderRef = useRef<string[]>([]);
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

    // Obsidian-style drag: the layout settles then stops, so by default a
    // dragged node just sits where you drop it — dead. Re-heat the
    // simulation when a node is grabbed so dragging pulls its neighbours
    // along and, on release, the forces spring it back to its resting
    // place. cytoscape-d3-force itself wires up the grab/drag/free
    // handling once a layout is running again; idle stays physics-free
    // (cheap on mobile). Skip while the timelapse reveal is playing.
    cy.on("grab", "node", (e) => {
      if (tlRafRef.current != null) return;
      // Pin the grabbed node at its current spot BEFORE re-heating, so
      // the restarting sim can't fling it away from the cursor in the
      // frame before cytoscape-d3-force's own drag handler takes over.
      // (cytoscape-d3-force only fixes a node on 'drag', not 'grab'.)
      const n = e.target;
      const p = n.position();
      const sc =
        (n.scratch("d3-force") as Record<string, number> | undefined) ?? {};
      n.scratch("d3-force", { ...sc, x: p.x, y: p.y, fx: p.x, fy: p.y });
      reheatLayout(cy, settingsRef.current);
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
      if (tlRafRef.current != null) {
        cancelAnimationFrame(tlRafRef.current);
        tlRafRef.current = null;
      }
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
        if (!cy.destroyed()) robustFit(cy);
      }, 700);
      const onStop = (): void => {
        if (!cy.destroyed()) {
          robustFit(cy);
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

  // Play — reveal the already-settled graph oldest-to-newest. No physics
  // runs: we hide every element, then un-hide nodes in mtime order at
  // their final positions while the camera stays fixed on the whole
  // graph. Cheap (just class toggles in a rAF loop), so it's smooth on
  // big vaults and on mobile.
  const startTimelapse = (): void => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    // Freeze any settling simulation so positions don't drift mid-reveal.
    (
      cy.scratch("_graph.layout") as cytoscape.Layouts | undefined
    )?.stop();

    // Reveal order: nodes oldest-first by mtime, then any node the mtime
    // list didn't cover (defensive) appended at the end.
    const nodeIds = new Set(cy.nodes().map((n) => n.id()));
    const byMtime = tlOrderRef.current.filter((p) => nodeIds.has(p));
    const seen = new Set(byMtime);
    const order = [
      ...byMtime,
      ...[...nodeIds].filter((id) => !seen.has(id)),
    ];
    if (order.length === 0) return;

    // Frame the bulk of the graph once; the camera then stays put so
    // nodes appear in place instead of the view lurching around.
    robustFit(cy);

    // Hide only NODES — cytoscape won't draw an edge whose endpoint is
    // display:none, so an edge reappears automatically the moment BOTH
    // its nodes are revealed. (Hiding the edges too left them stuck
    // hidden, since the reveal loop only un-hides nodes — that's why the
    // graph lost all its lines after a timelapse.)
    cy.batch(() => cy.nodes().addClass("tl-hidden"));
    setTlPlaying(true);

    // Finish in ~12s regardless of size. At ~60fps that's
    // ceil(count / 720) nodes per frame.
    const perFrame = Math.max(1, Math.ceil(order.length / (12 * 60)));
    let i = 0;
    const step = (): void => {
      const cyNow = cyRef.current;
      if (!cyNow || cyNow.destroyed()) {
        tlRafRef.current = null;
        return;
      }
      cyNow.batch(() => {
        for (let k = 0; k < perFrame && i < order.length; k++, i++) {
          cyNow.getElementById(order[i]).removeClass("tl-hidden");
        }
      });
      if (i < order.length) {
        tlRafRef.current = requestAnimationFrame(step);
      } else {
        tlRafRef.current = null;
        setTlPlaying(false);
      }
    };
    tlRafRef.current = requestAnimationFrame(step);
  };

  const pauseTimelapse = (): void => {
    if (tlRafRef.current != null) {
      cancelAnimationFrame(tlRafRef.current);
      tlRafRef.current = null;
    }
    // Reveal whatever's still hidden so pausing never strands nodes.
    const cy = cyRef.current;
    if (cy) cy.batch(() => cy.elements().removeClass("tl-hidden"));
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
const CENTER_SCALE = 1; // slider 0.75 → xStrength 0.75 (strong gravity)

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
    collideRadius: (n: D3Node) => (Number(n.size) || 6) / 2 + 6,
    collideStrength: 1,
    // 1 iteration (not 2) — half the collision cost per tick, which
    // matters on an 1800-node vault / on mobile. The spacing is still
    // even enough.
    collideIterations: 1,
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

// Re-heat the simulation for an interactive drag. A gentle alpha (0.3)
// re-activates the forces from the CURRENT positions (randomize:false),
// so the grabbed node tows its neighbours and everything springs back to
// rest when released, then the sim cools and stops on its own (~150
// ticks) — no idle CPU.
function reheatLayout(cy: Core, settings: GraphSettings): cytoscape.Layouts {
  return runLayoutWith(cy, settings, {
    randomize: false,
    // Gentle: a low alpha re-activates the forces enough that the
    // dragged node's neighbours follow, without a big kick that reflows
    // the whole graph (which read as "the node jumps where I didn't
    // click"). It cools to rest in ~1s.
    alpha: 0.12,
    alphaDecay: 0.03,
    alphaMin: 0.001,
    velocityDecay: 0.45,
  });
}

// Fit the camera to the BULK of the graph, ignoring a handful of far
// outlier orphans. cy.fit() frames the literal bounding box, so a couple
// of stray dots shrink the whole graph to a tiny clump in a corner. We
// instead centre on the centroid and zoom to the 95th-percentile radius,
// so the dense disk fills the view (a few outliers may sit just past the
// edge, which is fine).
function robustFit(cy: Core, padding = 40): void {
  const nodes = cy.nodes(":visible");
  if (nodes.length === 0) return;
  const pos = nodes.map((n) => n.position());
  const cx = pos.reduce((a, p) => a + p.x, 0) / pos.length;
  const cyc = pos.reduce((a, p) => a + p.y, 0) / pos.length;
  const dists = pos
    .map((p) => Math.hypot(p.x - cx, p.y - cyc))
    .sort((a, b) => a - b);
  const r = Math.max(60, dists[Math.floor(dists.length * 0.88)] ?? 0);
  const w = cy.width();
  const h = cy.height();
  const z = Math.max(
    cy.minZoom(),
    Math.min(cy.maxZoom(), Math.min(w - 2 * padding, h - 2 * padding) / (2 * r)),
  );
  cy.zoom(z);
  cy.pan({ x: w / 2 - cx * z, y: h / 2 - cyc * z });
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
    {
      // Timelapse reveal: hidden elements are removed from the render
      // (and so are their edges), then un-hidden oldest-first.
      selector: ".tl-hidden",
      css: {
        display: "none",
      },
    },
  ];
}
