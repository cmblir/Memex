// DEV-ONLY hero render: a ~10k-node SYNTHETIC vault rendered with the REAL
// neural-mesh scene (three.js GraphScene + d3-force-3d + buildGraph), for the
// README hero image / GIF. Captured via Playwright against the vite dev server
// (npm run dev → /hero-mesh.html). The data is fully synthetic (curated LLM/ML
// topic words only) so the published image leaks no real vault content. Never
// bundled into the app — no entry imports this; hero-mesh.html is dev-served.
import { buildGraph, computeAllowed, type VaultGraph } from "./lib/graphData";
import { createSim } from "./lib/graphSim";
import { GraphScene } from "./lib/graphScene";
import { readTheme } from "./lib/graphTheme";
import { DEFAULT_GRAPH_SETTINGS } from "./lib/graphSettings";
import type { Adjacency } from "./lib/ipc";

// Safe, on-theme topic words → become the labelled hub "MOC" nodes. No real
// vault names, no private data.
const TOPICS = [
  "transformer", "attention", "rlhf", "scaling-laws", "tokenizer", "embedding",
  "fine-tuning", "lora", "quantization", "distillation", "pretraining",
  "alignment", "diffusion", "gan", "cnn", "rnn", "lstm", "optimizer",
  "gradient-descent", "backprop", "regularization", "dropout", "batchnorm",
  "activation", "softmax", "cross-entropy", "perplexity", "beam-search",
  "sampling", "temperature", "mixture-of-experts", "retrieval", "rag",
  "vector-db", "prompt-engineering", "chain-of-thought", "agent", "tool-use",
  "mcp", "context-window", "kv-cache", "flash-attention", "rope", "layernorm",
  "residual", "encoder", "decoder", "bert", "gpt", "llama", "mistral", "clip",
  "whisper", "stable-diffusion", "reinforcement-learning", "policy-gradient",
  "q-learning", "actor-critic", "ppo", "dpo", "constitutional-ai",
  "instruction-tuning", "few-shot", "zero-shot", "in-context-learning",
  "hallucination", "benchmark", "evaluation", "dataset", "data-curation",
];

// A vault-shaped link graph: ~70 topic hubs ("maps of content"), each with a
// burst of leaf notes that link back to it (→ a bright high-degree core +
// orbiting leaves), inter-hub filaments, a sprinkle of cross-community mesh
// links, and a few unresolved "ghost" links to not-yet-written notes.
function buildSyntheticVault(): { adjacency: Adjacency; allFiles: string[] } {
  const forward: Record<string, string[]> = {};
  const unresolved: Record<string, string[]> = {};
  const files: string[] = [];
  const hubs = TOPICS.map((t) => `${t}.md`);
  const allLeaves: string[] = [];
  for (const h of hubs) files.push(h);

  for (let hi = 0; hi < hubs.length; hi++) {
    const hub = hubs[hi];
    const topic = TOPICS[hi];
    const leafCount = 90 + Math.floor(Math.random() * 110); // 90..200
    for (let k = 0; k < leafCount; k++) {
      const leaf = `${topic}-${k}.md`;
      files.push(leaf);
      allLeaves.push(leaf);
      (forward[leaf] ??= []).push(hub); // leaf → its hub
      if (Math.random() < 0.08) {
        // cross-community mesh link to a random hub
        const other = hubs[Math.floor(Math.random() * hubs.length)];
        if (other !== hub) forward[leaf].push(other);
      }
      if (Math.random() < 0.05) {
        // ghost link → not-yet-created note (renders as a dim ghost node)
        (unresolved[leaf] ??= []).push(`todo-${topic}-${k}`);
      }
    }
  }
  // inter-hub filaments: each hub links to 2..4 other hubs.
  for (const hub of hubs) {
    const n = 2 + Math.floor(Math.random() * 3);
    const targets = new Set<string>();
    for (let i = 0; i < n; i++) {
      const o = hubs[Math.floor(Math.random() * hubs.length)];
      if (o !== hub) targets.add(o);
    }
    (forward[hub] ??= []).push(...targets);
  }
  // a few leaf↔leaf mesh threads for weave between neighbouring clusters.
  for (let i = 0; i < allLeaves.length * 0.03; i++) {
    const a = allLeaves[Math.floor(Math.random() * allLeaves.length)];
    const b = allLeaves[Math.floor(Math.random() * allLeaves.length)];
    if (a !== b) (forward[a] ??= []).push(b);
  }
  return {
    adjacency: { forward, backward: {}, unresolved, tags: {} },
    allFiles: files,
  };
}

function main(): void {
  const container = document.getElementById("app") as HTMLDivElement | null;
  if (!container) return;

  const theme = readTheme();
  // Airier than the app defaults so the hero reads as an open mesh, not a dense
  // ball (uses the wider repel range). Still the real renderer + real forces.
  const s = { ...DEFAULT_GRAPH_SETTINGS, repelForce: 20, linkDistance: 110 };
  const { adjacency, allFiles } = buildSyntheticVault();
  const allowed = computeAllowed(adjacency, allFiles, {
    tagFilter: null,
    folderFilter: null,
    vaultRoot: "",
    search: "",
    existingOnly: false,
    showOrphans: true,
  });
  const graph: VaultGraph = buildGraph(adjacency, allowed, {
    nodeSize: s.nodeSize,
    starDim: theme.starDim,
    edgeColor: theme.edge,
    showGhosts: true,
  });

  const w = window as unknown as {
    __graphReady?: boolean;
    __nodeCount?: number;
    __edgeCount?: number;
  };
  w.__nodeCount = graph.order;
  w.__edgeCount = graph.size;
  if (graph.order === 0) return;

  const noop = (): void => undefined; // hero render is non-interactive
  const scene = new GraphScene(container, graph, theme, s, {
    onNodeClick: noop,
    onNodeHover: noop,
    onDragStart: noop,
    onDrag: noop,
    onDragEnd: noop,
    onContextRestored: noop,
  });
  const sim = createSim(graph, s, (nodes) => {
    for (const n of nodes) graph.mergeNodeAttributes(n.id, { x: n.x, y: n.y, z: n.z });
    scene.syncPositions();
  });
  scene.start();

  // Re-frame the cluster as the large seeded sphere contracts into the mesh.
  const fitTimer = window.setInterval(() => scene.fit(), 450);
  const finish = (): void => {
    window.clearInterval(fitTimer); // stop re-fitting so the zoom-in below sticks
    scene.fit();
    scene.zoomIn(); // tighten: fit() leaves a wide margin, fill more of the frame
    scene.zoomIn();
    w.__graphReady = true;
  };
  sim.sim.on("end", finish);
  // Safety: a 10k-node sim may not reach alphaMin in the capture window.
  window.setTimeout(finish, 20000);

  console.info("[heroMesh]", graph.order, "nodes,", graph.size, "edges");
}

main();
