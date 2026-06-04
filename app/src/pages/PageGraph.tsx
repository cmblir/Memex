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
import { fitViewportToNodes } from "@sigma/utils";
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
  stem,
  type VaultGraph,
} from "../lib/graphData";
import { createSim, type GraphSim, type SimNode } from "../lib/graphSim";
import {
  readTheme,
  buildSigmaSettings,
  nodeProgramSettings,
} from "../lib/graphTheme";
import type { Strings } from "../lib/i18n";
import { useUIStore } from "../stores/uiStore";
import { useVaultStore } from "../stores/vaultStore";
import { useIngestStore } from "../stores/ingestStore";
import { ipc } from "../lib/ipc";

// Live-ingest node tints — pages the in-flight run wrote glow gold, pages it
// only read glow ice blue. Both sit inside the cosmic palette so they read as
// "hot" stars rather than UI chrome.
const INGEST_WRITE_COLOR = "#ffd27a";
const INGEST_READ_COLOR = "#7fe1ff";
const PULSE_MS = 900;

interface IngestGlow {
  /** absolute node id → was it written (vs only read) */
  tint: Map<string, boolean>;
  pulseId: string | null;
  pulseScale: number;
}

export default function PageGraph({ t }: { t: Strings }): JSX.Element {
  const adjacency = useVaultStore((s) => s.adjacency);
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentVault = useVaultStore((s) => s.currentVault);
  const setRoute = useUIStore((s) => s.setRoute);
  const uiTheme = useUIStore((s) => s.theme);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const simRef = useRef<GraphSim | null>(null);
  const settingsRef = useRef<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const tlRafRef = useRef<number | null>(null);
  // Markdown paths sorted oldest→newest by mtime — the order nodes pop in
  // during the timelapse.
  const tlOrderRef = useRef<string[]>([]);
  // Live-ingest glow state. A ref (not state) so the nodeReducer closure in
  // the build effect always sees the current value without rebuilding the
  // renderer on every streamed event.
  const ingestGlowRef = useRef<IngestGlow>({
    tint: new Map(),
    pulseId: null,
    pulseScale: 1,
  });
  const pulseRafRef = useRef<number | null>(null);

  const [settings, setSettings] = useState<GraphSettings>(() =>
    loadGraphSettings(),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tlPlaying, setTlPlaying] = useState(false);
  // Bumped on webglcontextrestored to force a clean renderer rebuild (sigma has
  // no built-in GL-context recovery; WKWebView drops the context on backgrounding).
  const [glEpoch, setGlEpoch] = useState(0);
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

  // Fetch mtimes whenever the vault changes — drives the timelapse reveal order
  // (oldest file first, so the graph grows in creation order).
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
      starBright: theme.starBright,
      starMid: theme.starMid,
      starDim: theme.starDim,
      edgeColor: theme.edge,
    });
    setCounts({ nodes: graph.order, edges: graph.size });
    if (graph.order === 0) return;

    const renderer = new Sigma(graph, container, {
      ...buildSigmaSettings(theme, s),
      // Glow program registered here ONLY — never via the setSettings updates.
      ...nodeProgramSettings(),
    });
    sigmaRef.current = renderer;

    // WKWebView drops the WebGL context when backgrounded / under memory
    // pressure, leaving a blank canvas. sigma has no recovery, so on restore we
    // bump glEpoch → this effect tears down and rebuilds a fresh renderer.
    const canvases = Object.values(renderer.getCanvases());
    const onCtxLost = (e: Event): void => e.preventDefault();
    const onCtxRestored = (): void => setGlEpoch((n) => n + 1);
    for (const cv of canvases) {
      cv.addEventListener("webglcontextlost", onCtxLost);
      cv.addEventListener("webglcontextrestored", onCtxRestored);
    }

    // Only a precise click (no drag movement) opens the page — dragging a node
    // must not navigate.
    let dragMoved = false;
    renderer.on("clickNode", ({ node }) => {
      if (!dragMoved) setRoute(`page:${node}`);
    });

    // Hover: brighten the hovered node's closed neighbourhood, dim the rest —
    // Obsidian dims non-neighbours rather than erasing them, so context stays.
    let hoveredNode: string | undefined;
    let hoveredNeighbors: Set<string> | undefined;
    // Drag state declared up here so the hover handlers can defer to it: while a
    // node is dragged the highlight stays locked to it. The cursor slides off
    // the node's disc during the drag, which would otherwise fire leaveNode (or
    // enterNode on a node passed over) and drop / reassign the dimming.
    let draggedNode: string | null = null;
    let draggedSim: SimNode | undefined;
    const highlight = (node: string): void => {
      hoveredNode = node;
      hoveredNeighbors = new Set(graph.neighbors(node));
      hoveredNeighbors.add(node);
      renderer.refresh({ skipIndexation: true });
    };
    const clearHighlight = (): void => {
      hoveredNode = undefined;
      hoveredNeighbors = undefined;
      renderer.refresh({ skipIndexation: true });
    };
    renderer.on("enterNode", ({ node }) => {
      if (draggedNode) return;
      highlight(node);
    });
    renderer.on("leaveNode", () => {
      if (draggedNode) return;
      clearHighlight();
    });
    renderer.setSetting("nodeReducer", (n, data) => {
      // Live-ingest tint first: pages the running (or just-finished) ingest
      // touched stay recoloured — written gold, read ice — and the most
      // recently touched one pulses with a label flash. Hover logic then
      // layers on top so dimming still works.
      let d = data;
      const glow = ingestGlowRef.current;
      const written = glow.tint.get(n);
      if (written !== undefined) {
        d = {
          ...d,
          color: written ? INGEST_WRITE_COLOR : INGEST_READ_COLOR,
          zIndex: 2,
        };
        if (glow.pulseId === n) {
          d = { ...d, size: d.size * glow.pulseScale, forceLabel: true };
        }
      }
      if (!hoveredNeighbors) return d;
      // Only the hovered node shows a label — forcing every neighbour's label
      // stacked them into an unreadable garble. Neighbours stay bright; the
      // rest dim.
      if (n === hoveredNode) {
        // forceLabel only — NOT `highlighted`, which draws the white hover box
        // + ring. User wants just the label text.
        return { ...d, forceLabel: true, zIndex: 2 };
      }
      if (hoveredNeighbors.has(n)) return { ...d, label: "", zIndex: 1 };
      return { ...d, color: theme.starDim, label: "", zIndex: 0 };
    });
    // Faint edges by default (Obsidian hairlines). On hover, the hovered star's
    // links glow and the rest are hidden so its neighbourhood pops.
    renderer.setSetting("edgeReducer", (e, data) => {
      if (!hoveredNode) return data;
      const [a, b] = graph.extremities(e);
      return a === hoveredNode || b === hoveredNode
        ? { ...data, color: theme.edgeHi, zIndex: 1 }
        : { ...data, hidden: true };
    });

    // Node drag — Obsidian-style: pin the grabbed node (d3 fx/fy) and re-heat
    // the sim so its neighbours follow, then release so it springs to rest.
    // setCustomBBox freezes the camera so it doesn't pan while dragging.
    renderer.on("downNode", ({ node }) => {
      draggedNode = node;
      dragMoved = false;
      draggedSim = simRef.current?.nodes.find((n) => n.id === node);
      // Dim the rest of the graph to the grabbed node's neighbourhood so the
      // dragged star reads against a shaded background instead of other
      // clusters' colours bleeding through as it passes over them.
      highlight(node);
      if (!renderer.getCustomBBox()) renderer.setCustomBBox(renderer.getBBox());
      if (draggedSim) {
        draggedSim.fx = draggedSim.x;
        draggedSim.fy = draggedSim.y;
      }
      simRef.current?.reheat(0.3);
    });
    renderer.on("moveBody", ({ event }) => {
      if (!draggedNode) return;
      dragMoved = true;
      const p = renderer.viewportToGraph(event);
      graph.mergeNodeAttributes(draggedNode, { x: p.x, y: p.y });
      if (draggedSim) {
        draggedSim.fx = p.x;
        draggedSim.fy = p.y;
      }
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const endDrag = (): void => {
      if (!draggedNode) return; // upStage also fires on plain background clicks
      if (draggedSim) {
        draggedSim.fx = null;
        draggedSim.fy = null;
      }
      draggedNode = null;
      draggedSim = undefined;
      renderer.setCustomBBox(null);
      clearHighlight();
      // Reheat so the released node and its neighbours ease back to rest — the
      // sim has usually cooled to alphaMin by release, so alphaTarget(0) alone
      // would leave everything frozen wherever the drag dropped it.
      simRef.current?.reheat(0.3);
    };
    renderer.on("upNode", endDrag);
    renderer.on("upStage", endDrag);

    // A user wheel/drag hands the camera over so neither the tracking fit nor
    // the final fit fights manual pan/zoom.
    let userTookOver = false;
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

    // Reveal early and track the layout with the camera as it settles, so the
    // user watches it come alive (interactive from the first frame), then nail
    // the final framing on settle.
    const fit = (): void => {
      if (!userTookOver && graph.order >= 2) {
        void fitViewportToNodes(renderer, robustSubset(graph, graph.nodes()), {
          animate: false,
        });
      }
    };
    const fitTimer = window.setInterval(fit, 400);
    const revealTimer = window.setTimeout(() => {
      if (!killed) container.classList.add("graph-ready");
    }, 300);
    const finalFit = (): void => {
      window.clearInterval(fitTimer);
      if (killed) return;
      fit();
      renderer.refresh();
      container.classList.add("graph-ready");
    };
    const revealSafety = window.setTimeout(finalFit, 12000);
    sim.sim.on("end", () => {
      window.clearTimeout(revealSafety);
      finalFit();
    });

    return () => {
      killed = true;
      window.clearInterval(fitTimer);
      window.clearTimeout(revealTimer);
      window.clearTimeout(revealSafety);
      container.removeEventListener("wheel", takeOver);
      container.removeEventListener("pointerdown", takeOver);
      for (const cv of canvases) {
        cv.removeEventListener("webglcontextlost", onCtxLost);
        cv.removeEventListener("webglcontextrestored", onCtxRestored);
      }
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
    glEpoch,
  ]);

  // Force sliders — re-tune the running sim in place (no rebuild), then ease.
  useEffect(() => {
    simRef.current?.update(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.centerForce,
    settings.repelForce,
    settings.linkForce,
    settings.linkDistance,
  ]);

  // Display sliders — restyle without rebuilding the graph/sim.
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    renderer.setSettings(buildSigmaSettings(readTheme(), settings));
    const graph = renderer.getGraph();
    const w = Math.max(0.2, 0.6 * settings.linkThickness);
    graph.forEachEdge((e) => graph.setEdgeAttribute(e, "size", w));
    renderer.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.linkThickness, settings.textFadeThreshold, settings.arrows]);

  // Theme toggle — recolour nodes/edges + restyle. Re-read AFTER the app's
  // theme effect has flipped --bg (rAF + a slow-start safety timeout), or the
  // first read sees the old palette and paints invisible nodes.
  useEffect(() => {
    const apply = (): void => {
      const r = sigmaRef.current;
      if (!r) return;
      const theme = readTheme();
      // Only restyle labels/settings — node colours are the community palette
      // (theme-independent) and edges are hidden, so don't overwrite them.
      r.setSettings(buildSigmaSettings(theme, settingsRef.current));
      r.refresh();
    };
    const raf = requestAnimationFrame(apply);
    const safety = window.setTimeout(apply, 300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
    };
  }, [uiTheme]);

  // Live-ingest glow — mirror ingestStore's touched files into the reducer
  // ref and pulse the newest touch. Subscribes once; every change is just a
  // cheap sigma refresh (no graph/sim rebuild). Tints survive the run ending
  // so the user can see what the ingest changed; they clear when the store
  // resets (new run / "ingest another").
  useEffect(() => {
    const glow = ingestGlowRef.current;

    const startPulse = (id: string): void => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
      const start = performance.now();
      const tick = (): void => {
        const r = sigmaRef.current;
        const p = (performance.now() - start) / PULSE_MS;
        if (p >= 1 || !r) {
          glow.pulseId = null;
          glow.pulseScale = 1;
          pulseRafRef.current = null;
          r?.refresh({ skipIndexation: true });
          return;
        }
        glow.pulseId = id;
        // Swell up and ease back: 1 → ~2.6 → 1.
        glow.pulseScale = 1 + 1.6 * Math.sin(Math.PI * p);
        r.refresh({ skipIndexation: true });
        pulseRafRef.current = requestAnimationFrame(tick);
      };
      pulseRafRef.current = requestAnimationFrame(tick);
    };

    const sync = (
      touched: { path: string; write: boolean }[],
      ingestVault: string | null,
      pulse: boolean,
    ): void => {
      const vault = useVaultStore.getState().currentVault?.path;
      if (!vault || !ingestVault || ingestVault !== vault) return;
      let newest: string | null = null;
      const next = new Map<string, boolean>();
      for (const f of touched) {
        const abs = `${vault}/${f.path}`;
        next.set(abs, f.write);
        if (glow.tint.get(abs) !== f.write) newest = abs;
      }
      glow.tint = next;
      if (pulse && newest) startPulse(newest);
      sigmaRef.current?.refresh({ skipIndexation: true });
    };

    // --- Live growth: pages the ingest writes appear in the galaxy as it
    // runs. Each write schedules a debounced link-graph rescan (Rust resolves
    // wikilinks by stem); the result is DIFFED against the rendered graph and
    // only the new nodes/edges are injected — graph.addNode + sim.liveAdd —
    // so the settled layout never tears down. New stars spawn next to their
    // first already-placed neighbour and the physics tugs them into place.
    // The official refreshLinkGraph at run end still does the full rebuild
    // (sizes, communities) and reconciles everything.
    let liveTimer: number | null = null;
    let liveInFlight = false;
    let disposed = false;

    const liveGrow = async (): Promise<void> => {
      const renderer = sigmaRef.current;
      const sim = simRef.current;
      const vault = useVaultStore.getState().currentVault?.path;
      const ing = useIngestStore.getState();
      if (!renderer || !sim || !vault || ing.vaultPath !== vault) return;
      if (liveInFlight) {
        scheduleLiveGrow();
        return;
      }
      liveInFlight = true;
      try {
        const adj = await ipc.buildLinkGraph(vault);
        // The build effect may have torn down / rebuilt while we awaited —
        // only patch the renderer/sim pair we started with.
        if (disposed || sigmaRef.current !== renderer || simRef.current !== sim)
          return;
        const g = renderer.getGraph() as VaultGraph;
        const s = settingsRef.current;
        const theme = readTheme();
        const files = flattenMarkdown(useVaultStore.getState().fileTree);
        const allowed = computeAllowed(adj, files, {
          tagFilter: s.tagFilter,
          folderFilter: s.folderFilter,
          vaultRoot: vault,
          search: s.search,
          existingOnly: s.existingOnly,
          showOrphans: s.showOrphans,
        });

        // Candidate edges among allowed nodes; collect ones not rendered yet.
        const newEdges: [string, string][] = [];
        const newIdSet = new Set<string>();
        for (const [src, targets] of Object.entries(adj.forward)) {
          if (!allowed.has(src)) continue;
          for (const tgt of targets) {
            if (!allowed.has(tgt)) continue;
            const srcKnown = g.hasNode(src);
            const tgtKnown = g.hasNode(tgt);
            if (srcKnown && tgtKnown && g.hasEdge(src, tgt)) continue;
            if (!srcKnown) newIdSet.add(src);
            if (!tgtKnown) newIdSet.add(tgt);
            newEdges.push([src, tgt]);
          }
        }
        if (newIdSet.size === 0 && newEdges.length === 0) return;

        // Position each new node beside its first positioned endpoint so it
        // buds off the cluster instead of streaking in from the far field.
        const placed = new Map<string, { x: number; y: number }>();
        const posOf = (id: string): { x: number; y: number } | null => {
          if (g.hasNode(id))
            return {
              x: g.getNodeAttribute(id, "x"),
              y: g.getNodeAttribute(id, "y"),
            };
          return placed.get(id) ?? null;
        };
        for (const id of newIdSet) {
          let near: { x: number; y: number } | null = null;
          for (const [a, b] of newEdges) {
            if (a === id) near = posOf(b);
            else if (b === id) near = posOf(a);
            if (near) break;
          }
          const jitter = (): number => (Math.random() - 0.5) * 40;
          placed.set(id, {
            x: (near?.x ?? 0) + jitter(),
            y: (near?.y ?? 0) + jitter(),
          });
        }
        for (const id of newIdSet) {
          const p = placed.get(id)!;
          g.addNode(id, {
            label: stem(id),
            x: p.x,
            y: p.y,
            deg: 0,
            size: Math.max(1, s.nodeSize),
            unresolved: 0,
            color: theme.starDim,
          });
        }
        const addedEdges: [string, string][] = [];
        for (const [a, b] of newEdges) {
          if (!g.hasNode(a) || !g.hasNode(b) || g.hasEdge(a, b)) continue;
          g.addEdge(a, b, {
            color: theme.edge,
            size: 0.6 * s.linkThickness,
          });
          addedEdges.push([a, b]);
        }
        // Degree-derived size for the newcomers only — existing stars keep
        // their size until the end-of-run rebuild recomputes everything.
        for (const id of newIdSet) {
          const deg = g.degree(id);
          g.mergeNodeAttributes(id, {
            deg,
            size:
              Math.max(1, Math.min(5, 1 + Math.sqrt(deg) * 0.7)) * s.nodeSize,
          });
        }
        sim.liveAdd([...newIdSet], addedEdges);
        renderer.refresh();
        setCounts({ nodes: g.order, edges: g.size });
      } catch {
        /* scan failed — the next write event retries */
      } finally {
        liveInFlight = false;
      }
    };

    const scheduleLiveGrow = (): void => {
      if (liveTimer != null) window.clearTimeout(liveTimer);
      // Write tool events fire when the call STARTS; give the file ~2s to
      // land on disk before rescanning.
      liveTimer = window.setTimeout(() => {
        liveTimer = null;
        void liveGrow();
      }, 2000);
    };

    // Adopt any already-running (or just-finished) ingest on mount.
    const st = useIngestStore.getState();
    sync(st.touched, st.vaultPath, false);

    const unsub = useIngestStore.subscribe((s, prev) => {
      if (s.stage === "idle" && prev.stage !== "idle") {
        // Store reset — drop the glow.
        glow.tint = new Map();
        glow.pulseId = null;
        sigmaRef.current?.refresh({ skipIndexation: true });
        return;
      }
      if (s.touched !== prev.touched) sync(s.touched, s.vaultPath, true);
      if (s.writeCount > prev.writeCount) scheduleLiveGrow();
    });
    return () => {
      disposed = true;
      unsub();
      if (liveTimer != null) window.clearTimeout(liveTimer);
      if (pulseRafRef.current != null) cancelAnimationFrame(pulseRafRef.current);
    };
  }, []);

  // Timelapse — replay the vault's growth in creation order with LIVE physics.
  // The sim is reset to empty, then nodes are revealed oldest-first; each one
  // spawns at the galactic centre and the running d3-force flings it outward,
  // physically shoving the already-placed stars aside. The galaxy assembles and
  // jostles itself into shape in real time rather than snapping to fixed spots.
  // Rendering is driven by the sim's own ticks; this loop only paces reveals.
  const REVEAL_MS = 18000; // total time to reveal every node
  const startTimelapse = (): void => {
    const renderer = sigmaRef.current;
    const sim = simRef.current;
    if (!renderer || !sim || renderer.getGraph().order === 0) return;
    const graph = renderer.getGraph() as VaultGraph;

    // Reveal order: mtime order, then any present node mtime didn't cover.
    const present = new Set(graph.nodes());
    const order = tlOrderRef.current.filter((p) => present.has(p));
    const seen = new Set(order);
    graph.forEachNode((n) => {
      if (!seen.has(n)) order.push(n);
    });

    // Hide everything and empty the sim — the galaxy grows from nothing.
    graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", true));
    sim.timelapseReset();
    renderer.refresh({ skipIndexation: true });
    setTlPlaying(true);

    let next = 0;
    const start = performance.now();
    const step = (): void => {
      const r = sigmaRef.current;
      const sm = simRef.current;
      if (!r || !sm) {
        tlRafRef.current = null;
        return;
      }
      const g = r.getGraph() as VaultGraph;
      const now = performance.now() - start;
      const want = Math.min(order.length, Math.ceil((now / REVEAL_MS) * order.length));
      if (want > next) {
        const batch = order.slice(next, want);
        for (const id of batch) g.setNodeAttribute(id, "hidden", false);
        sm.timelapseReveal(batch); // spawns at centre + keeps the sim hot
        next = want;
      }
      if (next < order.length) {
        tlRafRef.current = requestAnimationFrame(step);
      } else {
        sm.timelapseSettle(); // reveal done — let the live galaxy cool to rest
        tlRafRef.current = null;
        setTlPlaying(false);
      }
    };
    tlRafRef.current = requestAnimationFrame(step);
  };

  // Pause — stop pacing and reveal everything that's left at once, then let the
  // live sim settle the full galaxy (timelapseReveal skips already-shown nodes).
  const pauseTimelapse = (): void => {
    if (tlRafRef.current != null) {
      cancelAnimationFrame(tlRafRef.current);
      tlRafRef.current = null;
    }
    const renderer = sigmaRef.current;
    const sim = simRef.current;
    if (renderer && sim) {
      const graph = renderer.getGraph() as VaultGraph;
      graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", false));
      sim.timelapseReveal(graph.nodes());
      sim.timelapseSettle();
      renderer.refresh({ skipIndexation: true });
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

// The inner `pct` of the given nodes by distance from their centroid. Framing
// to this (not every node) keeps the dense dandelion field filling the view
// instead of a few far-flung disconnected components / orphans shrinking it.
function robustSubset(
  graph: VaultGraph,
  ids: string[],
  pct = 0.9,
): string[] {
  if (ids.length < 12) return ids;
  let cx = 0;
  let cy = 0;
  for (const id of ids) {
    cx += graph.getNodeAttribute(id, "x");
    cy += graph.getNodeAttribute(id, "y");
  }
  cx /= ids.length;
  cy /= ids.length;
  const byDist = ids
    .map((id) => ({
      id,
      d: Math.hypot(
        graph.getNodeAttribute(id, "x") - cx,
        graph.getNodeAttribute(id, "y") - cy,
      ),
    }))
    .sort((a, b) => a.d - b.d);
  return byDist.slice(0, Math.max(12, Math.floor(byDist.length * pct))).map(
    (n) => n.id,
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
      const g = r.getGraph() as VaultGraph;
      void fitViewportToNodes(r, robustSubset(g, g.nodes()), { animate: true });
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
