// DEV-ONLY standalone hero render: a large (~12k node) community-clustered
// knowledge galaxy in Memex's exact visual style (glow stars, cosmic palette,
// faint cosmic-web edges, dark background). Used only to capture the README
// hero image via Playwright — never bundled into the app.
//
// Positions are precomputed (cluster layout), so there is no force simulation
// to settle: it renders instantly and identically every time, which is what we
// want for a screenshot at this scale.
import Graph from "graphology";
import Sigma from "sigma";
import { fitViewportToNodes } from "@sigma/utils";
import NodeGlowProgram from "./lib/graphNodeGlow";

// Cosmic palette — same family the app uses in graphData.ts.
const PALETTE = [
  "#6fb3ff", "#b58cff", "#5fe0c0", "#ff9ec4", "#ffd27a", "#8affc1",
  "#ff9e6d", "#9ab0ff", "#7fe1ff", "#c9a0ff", "#ffb38a", "#a0ffd6",
  "#7ad7ff", "#d3a4ff", "#ffc2dd",
];

const N_COMMUNITIES = 95;
const NODE_TARGET = 12000;

// Standard normal via Box–Muller — gives soft gaussian clusters.
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function build(): Graph {
  const g = new Graph({ type: "undirected" });
  const golden = Math.PI * (3 - Math.sqrt(5));
  const centers: { x: number; y: number; color: string }[] = [];
  for (let c = 0; c < N_COMMUNITIES; c++) {
    const r = 4200 * Math.sqrt((c + 0.5) / N_COMMUNITIES);
    const a = c * golden;
    centers.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, color: PALETTE[c % PALETTE.length] });
  }

  const perComm = Math.round(NODE_TARGET / N_COMMUNITIES);
  const communities: string[][] = [];
  let id = 0;
  for (let c = 0; c < N_COMMUNITIES; c++) {
    const ctr = centers[c];
    const spread = 45 + Math.random() * 70;
    const count = Math.max(20, Math.round(perComm * (0.5 + Math.random())));
    const arr: string[] = [];
    for (let k = 0; k < count; k++) {
      const nid = `n${id++}`;
      g.addNode(nid, {
        x: ctr.x + randn() * spread,
        y: ctr.y + randn() * spread,
        size: 1.2,
        color: ctr.color,
      });
      arr.push(nid);
    }
    communities.push(arr);
  }

  let edgeKey = 0;
  const addEdge = (a: string, b: string, alpha: number): void => {
    if (a === b || g.hasEdge(a, b)) return;
    g.addEdgeWithKey(`e${edgeKey++}`, a, b, {
      size: 0.45,
      color: `rgba(150,170,210,${alpha})`,
    });
  };

  // Intra-community: hub-and-spoke so each cluster reads as a little galaxy.
  for (const arr of communities) {
    const hubCount = Math.max(1, Math.floor(arr.length * 0.04));
    const hubs = arr.slice(0, hubCount);
    for (const n of arr) {
      const links = 1 + Math.floor(Math.random() * 2);
      for (let d = 0; d < links; d++) {
        const target =
          Math.random() < 0.65
            ? hubs[Math.floor(Math.random() * hubs.length)]
            : arr[Math.floor(Math.random() * arr.length)];
        addEdge(n, target, 0.05);
      }
    }
  }
  // Sparse inter-community filaments.
  for (let i = 0; i < N_COMMUNITIES * 30; i++) {
    const ca = communities[Math.floor(Math.random() * N_COMMUNITIES)];
    const cb = communities[Math.floor(Math.random() * N_COMMUNITIES)];
    addEdge(
      ca[Math.floor(Math.random() * ca.length)],
      cb[Math.floor(Math.random() * cb.length)],
      0.03,
    );
  }

  // Size by degree: hubs become bright giant stars, leaves stay points.
  g.forEachNode((n) => {
    const deg = g.degree(n);
    g.setNodeAttribute(n, "size", Math.max(1, Math.min(9, 1 + Math.sqrt(deg) * 0.8)));
  });

  return g;
}

const container = document.getElementById("app");
if (container) {
  const graph = build();
  const renderer = new Sigma(graph, container as HTMLElement, {
    defaultNodeType: "glow",
    nodeProgramClasses: { glow: NodeGlowProgram },
    defaultEdgeColor: "rgba(150,170,210,0.05)",
    renderLabels: false,
    renderEdgeLabels: false,
    zIndex: false,
    enableEdgeEvents: false,
  });
  fitViewportToNodes(renderer, graph.nodes(), { animate: false });
  // Zoom in a touch so the galaxy fills the frame.
  const cam = renderer.getCamera();
  cam.setState({ ratio: cam.getState().ratio * 0.82 });
  // Expose stats for the capture harness.
  (window as unknown as { __graphReady?: boolean; __nodeCount?: number }).__graphReady = true;
  (window as unknown as { __nodeCount?: number }).__nodeCount = graph.order;
  console.info("[bigGraph] rendered", graph.order, "nodes,", graph.size, "edges");
}
