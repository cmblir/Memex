// GraphView: renders the vault link graph as a Cytoscape.js canvas. Nodes are
// markdown files (label = stem), edges are wikilink relationships.

import { useEffect, useRef } from "react";
import type { JSX } from "react";
import cytoscape from "cytoscape";
import type { ElementDefinition } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useVaultStore } from "../stores/vaultStore";
import { useUIStore } from "../stores/uiStore";

let layoutRegistered = false;

function ensureLayoutRegistered() {
  if (!layoutRegistered) {
    cytoscape.use(fcose);
    layoutRegistered = true;
  }
}

export default function GraphView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adjacency = useVaultStore((s) => s.adjacency);
  const openFile = useVaultStore((s) => s.openFile);
  const setTopView = useUIStore((s) => s.setTopView);

  useEffect(() => {
    if (!containerRef.current) return;
    ensureLayoutRegistered();

    const elements = buildElements(adjacency);
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: GRAPH_STYLE,
      layout: {
        name: "fcose",
        animate: false,
        fit: true,
        padding: 30,
        nodeSeparation: 80,
      } as unknown as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 4,
    });

    cy.on("tap", "node", (event) => {
      const path = event.target.id();
      void openFile(path);
      setTopView("editor");
    });

    cy.ready(() => {
      cy.fit(undefined, 30);
    });

    return () => {
      cy.destroy();
    };
  }, [adjacency, openFile, setTopView]);

  return (
    <div
      ref={containerRef}
      className="memex-graph"
      role="img"
      aria-label="Vault link graph"
    />
  );
}

function buildElements(
  adjacency: ReturnType<typeof useVaultStore.getState>["adjacency"],
): ElementDefinition[] {
  if (!adjacency) return [];
  const nodes = new Set<string>();
  const edges: ElementDefinition[] = [];
  for (const [source, targets] of Object.entries(adjacency.forward)) {
    nodes.add(source);
    for (const target of targets) {
      nodes.add(target);
      edges.push({
        data: { id: `${source}::${target}`, source, target },
      });
    }
  }
  const nodeDefs: ElementDefinition[] = Array.from(nodes).map((path) => ({
    data: { id: path, label: stem(path) },
  }));
  return [...nodeDefs, ...edges];
}

function stem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const GRAPH_STYLE: cytoscape.StylesheetCSS[] = [
  {
    selector: "node",
    css: {
      "background-color": "#6c8eef",
      label: "data(label)",
      color: "#e8e8e8",
      "font-size": 10,
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 4,
      width: 14,
      height: 14,
    },
  },
  {
    selector: "edge",
    css: {
      "line-color": "rgba(232, 232, 232, 0.18)",
      "curve-style": "bezier",
      width: 1,
    },
  },
  {
    selector: "node:selected",
    css: { "background-color": "#a4b7f2" },
  },
];
