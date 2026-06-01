// Graph page — Obsidian-style interactive force-directed graph of the vault.
// d3-force (lib/graphSim) runs the layout — the same family of forces Obsidian
// uses, including the degree-normalized link strength that produces separated
// radial "dandelion" clusters. sigma.js renders it on the GPU: sigma honours
// edge alpha (so edges stay faint instead of the bright hairball cytoscape's
// WebGL renderer produced) and drives label visibility off rendered node size,
// so the overview shows no labels and hubs label first as you zoom in.

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import Sigma from "sigma";
import {
  fitViewportToNodes,
  getCameraStateToFitViewportToNodes,
} from "@sigma/utils";
import GraphControls from "../components/GraphControls";
import {
  DEFAULT_GRAPH_SETTINGS,
  loadGraphSettings,
  saveGraphSettings,
  type GraphSettings,
} from "../lib/graphSettings";
import {
  buildGraph,
  collectFolders,
  collectTags,
  computeAllowed,
  countAllNodes,
  flattenMarkdown,
  type VaultGraph,
} from "../lib/graphData";
import { createSim, type GraphSim } from "../lib/graphSim";
import { readTheme, buildSigmaSettings } from "../lib/graphTheme";
import type { Strings } from "../lib/i18n";
import { useUIStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { ipc } from "../lib/ipc";

export default function PageGraph({ t }: { t: Strings }): JSX.Element {
  const adjacency = useVaultStore((s) => s.adjacency);
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentVault = useVaultStore((s) => s.currentVault);
  const setRoute = useUIStore((s) => s.setRoute);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const simRef = useRef<GraphSim | null>(null);
  const settingsRef = useRef<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const tlRafRef = useRef<number | null>(null);
  const tlOrderRef = useRef<string[]>([]);

  const [settings, setSettings] = useState<GraphSettings>(() =>
    loadGraphSettings(),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tlPlaying, setTlPlaying] = useState(false);
  const [counts, setCounts] = useState<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  });
  settingsRef.current = settings;

  useEffect(() => {
    saveGraphSettings(settings);
  }, [settings]);

  const tags = useMemo(() => collectTags(adjacency?.tags ?? {}), [adjacency]);
  const folders = useMemo(
    () => collectFolders(currentVault?.path ?? "", adjacency),
    [adjacency, currentVault?.path],
  );
  // Every markdown file — including link-less ones, which render as Obsidian's
  // free-floating "orphan" dots.
  const allFiles = useMemo(() => flattenMarkdown(fileTree), [fileTree]);

  // Fetch mtimes whenever the vault changes — drives the timelapse reveal order.
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
        /* mtime unavailable — timelapse just won't order by age */
      });
    return () => {
      cancelled = true;
    };
  }, [currentVault?.path]);

  // Build + render + settle. Re-runs when the underlying graph or any FILTER
  // changes (force-slider re-tuning is handled without a rebuild in a later
  // step). Each run tears the old instance down and creates a fresh one.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !adjacency) return;
    const s = settingsRef.current;
    const theme = readTheme();

    const allowed = computeAllowed(adjacency, allFiles, {
      tagFilter: s.tagFilter,
      folderFilter: s.folderFilter,
      vaultRoot: currentVault?.path ?? "",
      search: s.search,
      existingOnly: s.existingOnly,
      showOrphans: s.showOrphans,
    });
    const graph: VaultGraph = buildGraph(adjacency, allowed, allFiles, {
      nodeSize: s.nodeSize,
      resolvedColor: theme.node,
      unresolvedColor: theme.nodeUnresolved,
      edgeColor: theme.edge,
    });
    setCounts({ nodes: graph.order, edges: graph.size });
    if (graph.order === 0) return;

    const renderer = new Sigma(graph, container, buildSigmaSettings(theme, s));
    sigmaRef.current = renderer;

    renderer.on("clickNode", ({ node }) => setRoute(`page:${node}`));

    // Camera framing: keep the spreading disk in view during the settle, then
    // nail the final framing on the sim's "end". A user wheel/drag hands the
    // camera over so the settle never fights manual pan/zoom.
    let userTookOver = false;
    const fitNow = (): void => {
      if (renderer.getGraph().order < 2) return;
      const state = getCameraStateToFitViewportToNodes(
        renderer,
        renderer.getGraph().nodes(),
      );
      renderer.getCamera().setState(state);
    };
    const takeOver = (): void => {
      userTookOver = true;
    };
    container.addEventListener("wheel", takeOver, { passive: true, once: true });
    container.addEventListener("pointerdown", takeOver, { once: true });

    let killed = false;
    const sim = createSim(graph, s, (nodes) => {
      // d3 mutated node x/y in place; write them back for sigma to render.
      for (const n of nodes) graph.mergeNodeAttributes(n.id, { x: n.x, y: n.y });
      renderer.refresh({ skipIndexation: true });
    });
    simRef.current = sim;

    const fitTimer = window.setInterval(() => {
      if (!userTookOver) fitNow();
    }, 300);
    // First frame: reveal once a few ticks have spread the seed ring.
    const revealTimer = window.setTimeout(() => {
      container.classList.add("graph-ready");
    }, 250);
    sim.sim.on("end", () => {
      window.clearInterval(fitTimer);
      if (killed) return;
      if (!userTookOver && renderer.getGraph().order >= 2) {
        void fitViewportToNodes(renderer, renderer.getGraph().nodes(), {
          animate: true,
        });
      }
      renderer.refresh(); // re-grid labels at final positions
      container.classList.add("graph-ready");
    });

    return () => {
      killed = true;
      window.clearInterval(fitTimer);
      window.clearTimeout(revealTimer);
      container.removeEventListener("wheel", takeOver);
      container.removeEventListener("pointerdown", takeOver);
      sim.stop();
      renderer.kill();
      sigmaRef.current = null;
      simRef.current = null;
      container.classList.remove("graph-ready");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adjacency,
    allFiles,
    currentVault?.path,
    settings.tagFilter,
    settings.folderFilter,
    settings.search,
    settings.existingOnly,
    settings.showOrphans,
    settings.nodeSize,
  ]);

  // Timelapse — physics-free reveal of the already-settled graph, oldest file
  // first. Hide every node, then un-hide in mtime order; sigma skips edges with
  // a hidden endpoint, so the web fills in as nodes appear.
  const startTimelapse = (): void => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const graph = renderer.getGraph();
    if (graph.order === 0) return;
    simRef.current?.stop();

    const present = new Set(graph.nodes());
    const order = tlOrderRef.current.filter((p) => present.has(p));
    const seen = new Set(order);
    graph.forEachNode((n) => {
      if (!seen.has(n)) order.push(n);
    });
    graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", true));
    setTlPlaying(true);

    const perFrame = Math.max(1, Math.ceil(order.length / (12 * 60)));
    let i = 0;
    const step = (): void => {
      const r = sigmaRef.current;
      if (!r) {
        tlRafRef.current = null;
        return;
      }
      const g = r.getGraph();
      for (let k = 0; k < perFrame && i < order.length; k++, i++) {
        g.setNodeAttribute(order[i], "hidden", false);
      }
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
    const renderer = sigmaRef.current;
    if (renderer) {
      const graph = renderer.getGraph();
      graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", false));
    }
    setTlPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (tlRafRef.current != null) cancelAnimationFrame(tlRafRef.current);
    };
  }, []);

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
            {counts.nodes}/{totalNodes} {t.gr_node_count}
          </span>
          <span className="graph-stat">
            {counts.edges} {t.gr_edge_count}
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
          <ZoomButtons sigmaRef={sigmaRef} />
          <button
            type="button"
            className="graph-toolbar__btn"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-pressed={drawerOpen}
            aria-label={t.gr_settings ?? "Graph settings"}
            title={t.gr_settings ?? "Graph settings"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
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
            <div ref={containerRef} className="graph-canvas" />
            {totalNodes === 0 ? (
              <p className="muted graph-empty">
                {t.gr_empty_pre ??
                  "No wikilinks found in the vault yet. Add some "}
                <code style={{ fontFamily: "var(--font-mono)" }}>[[wikilinks]]</code>
                {t.gr_empty_post ?? " to see the graph grow."}
              </p>
            ) : null}
          </div>
          <GraphControls
            t={t}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((v) => !v)}
            settings={settings}
            onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            onReset={() => setSettings({ ...DEFAULT_GRAPH_SETTINGS, search: "" })}
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
  sigmaRef,
}: {
  sigmaRef: React.MutableRefObject<Sigma | null>;
}): JSX.Element {
  const zoomIn = (): void =>
    void sigmaRef.current?.getCamera().animatedZoom({ duration: 250 });
  const zoomOut = (): void =>
    void sigmaRef.current?.getCamera().animatedUnzoom({ duration: 250 });
  const fit = (): void => {
    const r = sigmaRef.current;
    if (r && r.getGraph().order >= 2) {
      void fitViewportToNodes(r, r.getGraph().nodes(), { animate: true });
    }
  };
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={zoomOut}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={fit}
        aria-label="Fit"
      >
        fit
      </button>
      <button
        type="button"
        className="graph-toolbar__btn"
        onClick={zoomIn}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
