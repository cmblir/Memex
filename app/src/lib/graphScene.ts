// three.js renderer for the vault graph — the 3D "universe" replacement for the
// sigma.js 2D view. Encapsulates the entire WebGL scene behind an imperative
// API so PageGraph stays a thin React orchestrator (refs + effects + store
// subscriptions), structurally parallel to the sigma version it replaces.
//
// Stars are rendered as a THREE.Points cloud whose custom glow shader ports the
// old sigma NodeGlowProgram (bright core + soft radial halo, now with
// perspective size attenuation and distance fade). Edges are faint additive
// filaments. A starfield + FogExp2 + UnrealBloom give the deep-space look, and
// OrbitControls (with idle auto-rotate) provide the real z-axis orbit. Labels
// reuse the app font via CSS2DRenderer with sigma's hub-first size threshold.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { VaultGraph } from "./graphData";
import type { GraphTheme } from "./graphTheme";
import type { GraphSettings } from "./graphSettings";

// World radius (in sim units) per unit of node `size`, and how far the halo
// extends past the core — mirrors the old GLOW_SCALE 2.6 intent in 3D.
const NODE_RADIUS = 3.4;
const GLOW_SCALE = 3.2;
const PICK_BASE_PX = 14;

export interface GraphSceneCallbacks {
  onNodeClick(id: string): void;
  onNodeHover(id: string | null): void;
  onDragStart(id: string): void;
  onDrag(id: string, x: number, y: number, z: number): void;
  onDragEnd(id: string): void;
  onContextRestored(): void;
}

// Transient styling driven by PageGraph: hover neighbourhood + live-ingest tint.
export interface SceneStyleState {
  hoveredNode: string | null;
  neighbors: Set<string> | null;
  tints: Map<string, boolean>; // id → written (true) vs only read (false)
  pulseId: string | null;
  pulseScale: number;
}

const EMPTY_STYLE: SceneStyleState = {
  hoveredNode: null,
  neighbors: null,
  tints: new Map(),
  pulseId: null,
  pulseScale: 1,
};

const INGEST_WRITE = new THREE.Color("#ffd27a");
const INGEST_READ = new THREE.Color("#7fe1ff");

function parseRGBA(s: string): { color: THREE.Color; alpha: number } {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(s);
  if (m) {
    return {
      color: new THREE.Color(+m[1] / 255, +m[2] / 255, +m[3] / 255),
      alpha: m[4] !== undefined ? +m[4] : 1,
    };
  }
  try {
    return { color: new THREE.Color(s), alpha: 1 };
  } catch {
    return { color: new THREE.Color(0.6, 0.66, 0.8), alpha: 0.1 };
  }
}

const NODE_VERT = /* glsl */ `
attribute float a_size;
attribute vec3 a_color;
attribute float a_alpha;
uniform float u_pixelRatio;
uniform float u_sizeScale;
uniform float u_fogNear;
uniform float u_fogFar;
varying vec3 v_color;
varying float v_alpha;
varying float v_fade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.0, -mv.z);
  gl_PointSize = a_size * ${NODE_RADIUS.toFixed(1)} * ${GLOW_SCALE.toFixed(1)} * u_sizeScale * u_pixelRatio / dist;
  gl_PointSize = clamp(gl_PointSize, 4.0, 340.0);
  gl_Position = projectionMatrix * mv;
  v_color = a_color;
  v_alpha = a_alpha;
  // Nearer stars brighter; distant ones fade into the fog. Floor at 0.25 so the
  // far field never fully vanishes.
  v_fade = clamp((u_fogFar - dist) / max(1.0, u_fogFar - u_fogNear), 0.25, 1.0);
}
`;

const NODE_FRAG = /* glsl */ `
precision mediump float;
varying vec3 v_color;
varying float v_alpha;
varying float v_fade;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float core = 1.0 - smoothstep(0.30, 0.45, d);  // solid bright centre
  float glow = pow(max(0.0, 1.0 - d), 2.2);        // soft halo to the edge
  float a = max(core, glow * 0.6) * v_alpha * v_fade;
  if (a < 0.004) discard;
  // Brighten the core so UnrealBloom catches it; depth-fade the rim.
  vec3 col = v_color * (0.65 + 0.35 * v_fade) + core * 0.25;
  gl_FragColor = vec4(col, a);
}
`;

export class GraphScene {
  private container: HTMLDivElement;
  private graph: VaultGraph;
  private theme: GraphTheme;
  private settings: GraphSettings;
  private cb: GraphSceneCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private baseBloom = 1.2; // theme-derived bloom strength before brightness scaling
  private labelRenderer: CSS2DRenderer;

  private points: THREE.Points;
  private nodeGeom: THREE.BufferGeometry;
  private nodeMat: THREE.ShaderMaterial;
  private nodeIds: string[];
  private idIndex = new Map<string, number>();

  private edges: THREE.LineSegments;
  private edgeGeom: THREE.BufferGeometry;
  private edgeMat: THREE.LineBasicMaterial;
  private edgePairs: [string, string][];

  private starfield: THREE.Points;
  private labels = new Map<string, CSS2DObject>();

  private style: SceneStyleState = EMPTY_STYLE;
  private raf: number | null = null;
  private resizeObs: ResizeObserver;
  private reducedMotion: boolean;

  // pointer / drag state
  private dragId: string | null = null;
  private dragMoved = false;
  private downAt: { x: number; y: number } | null = null;
  private hoverId: string | null = null;

  private raycaster = new THREE.Raycaster();
  private tmpVec = new THREE.Vector3();
  private tmpNdc = new THREE.Vector2();
  private dragPlane = new THREE.Plane();

  constructor(
    container: HTMLDivElement,
    graph: VaultGraph,
    theme: GraphTheme,
    settings: GraphSettings,
    cb: GraphSceneCallbacks,
  ) {
    this.container = container;
    this.graph = graph;
    this.theme = theme;
    this.settings = settings;
    this.cb = cb;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2); // cap bloom cost

    const bg = parseRGBA(theme.bg).color;
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg.getHex(), 0.00065);

    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.5, 8000);
    this.camera.position.set(0, 0, 900);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Brightness slider drives overall scene exposure (light intensity).
    this.renderer.toneMappingExposure = settings.brightness;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.classList.add("graph-canvas-3d");
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    const ld = this.labelRenderer.domElement;
    ld.style.position = "absolute";
    ld.style.inset = "0";
    ld.style.pointerEvents = "none";
    ld.classList.add("graph-labels-3d");
    container.appendChild(ld);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 5000;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.35;

    // Bloom — deep-space glow. Strength/threshold tuned low for ~tens of stars.
    const dark = parseRGBA(theme.bg).color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.baseBloom = dark ? 1.2 : 0.3;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      this.baseBloom * settings.brightness, // strength × brightness
      0.75, // radius
      dark ? 0.0 : 0.6, // threshold
    );
    this.composer.addPass(this.bloom);

    // --- nodes ---
    this.nodeIds = graph.nodes();
    this.nodeIds.forEach((id, i) => this.idIndex.set(id, i));
    const n = this.nodeIds.length;
    this.nodeGeom = new THREE.BufferGeometry();
    this.nodeGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(n * 3), 3),
    );
    this.nodeGeom.setAttribute(
      "a_color",
      new THREE.BufferAttribute(new Float32Array(n * 3), 3),
    );
    this.nodeGeom.setAttribute(
      "a_size",
      new THREE.BufferAttribute(new Float32Array(n), 1),
    );
    this.nodeGeom.setAttribute(
      "a_alpha",
      new THREE.BufferAttribute(new Float32Array(n), 1),
    );
    this.nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        u_pixelRatio: { value: pr },
        u_sizeScale: { value: this.sizeScale(h) },
        u_fogNear: { value: 200 },
        u_fogFar: { value: 2600 },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.nodeGeom, this.nodeMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // --- edges ---
    this.edgePairs = graph.mapEdges((_e, _a, s, t) => [s, t] as [string, string]);
    this.edgeGeom = new THREE.BufferGeometry();
    this.edgeGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(this.edgePairs.length * 6), 3),
    );
    this.edgeGeom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(this.edgePairs.length * 6), 3),
    );
    const edge = parseRGBA(theme.edge);
    this.edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: Math.min(1, edge.alpha * 3.5), // lines can't vary width; opacity carries faintness
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.edges = new THREE.LineSegments(this.edgeGeom, this.edgeMat);
    this.edges.frustumCulled = false;
    this.scene.add(this.edges);

    // --- starfield (distant, dim, for parallax depth) ---
    this.starfield = this.buildStarfield(dark);
    this.scene.add(this.starfield);

    // --- labels ---
    for (const id of this.nodeIds) {
      const el = document.createElement("div");
      el.className = "graph-label-3d";
      el.textContent = this.graph.getNodeAttribute(id, "label");
      el.style.color = theme.ink;
      const obj = new CSS2DObject(el);
      obj.visible = false;
      this.scene.add(obj);
      this.labels.set(id, obj);
    }

    this.writeNodes();
    this.writeEdges();
    this.fit();

    // pointer events
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("webglcontextlost", this.onCtxLost);
    el.addEventListener("webglcontextrestored", this.onCtxRestored);

    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(container);
  }

  private sizeScale(height: number): number {
    // px-per-world-unit at unit distance: (viewportHeight/2) / tan(fov/2)
    const fovRad = (this.camera.fov * Math.PI) / 180;
    return height / 2 / Math.tan(fovRad / 2);
  }

  private buildStarfield(dark: boolean): THREE.Points {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    // Deterministic-ish scatter on a large shell so it parallaxes behind the
    // graph. Math.random is fine at runtime (only graphData seeding avoids it).
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 2600 + Math.random() * 2400;
      const sp = Math.sin(phi);
      pos[i * 3] = Math.cos(theta) * r * sp;
      pos[i * 3 + 1] = Math.sin(theta) * r * sp;
      pos[i * 3 + 2] = Math.cos(phi) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: dark ? 0x9fb0d4 : 0xb9c2d6,
      size: dark ? 2.2 : 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: dark ? 0.55 : 0.3,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }

  // Recompute per-node position/color/size/alpha from the graph + style state.
  // Cheap at this node count, so it runs every sim tick and on every style
  // change — keeping hidden(timelapse) + hover dim + ingest tint consistent.
  private writeNodes(): void {
    const pos = this.nodeGeom.getAttribute("position") as THREE.BufferAttribute;
    const col = this.nodeGeom.getAttribute("a_color") as THREE.BufferAttribute;
    const siz = this.nodeGeom.getAttribute("a_size") as THREE.BufferAttribute;
    const alp = this.nodeGeom.getAttribute("a_alpha") as THREE.BufferAttribute;
    const { hoveredNode, neighbors, tints, pulseId, pulseScale } = this.style;
    const dim = parseRGBA(this.theme.starDim).color;
    const c = new THREE.Color();

    for (let i = 0; i < this.nodeIds.length; i++) {
      const id = this.nodeIds[i];
      const a = this.graph.getNodeAttributes(id);
      pos.setXYZ(i, a.x, a.y, a.z);

      // base colour from community palette
      c.set(a.color);
      let size = a.size;
      let alpha = a.hidden ? 0 : 1;

      // live-ingest tint overrides colour
      const written = tints.get(id);
      if (written !== undefined) {
        c.copy(written ? INGEST_WRITE : INGEST_READ);
        if (pulseId === id) size = a.size * pulseScale;
      }

      // hover neighbourhood: hovered + neighbours stay lit, the rest dim+shrink
      if (hoveredNode && neighbors) {
        if (id === hoveredNode) {
          // keep
        } else if (neighbors.has(id)) {
          // neighbour — keep colour, slightly dimmer handled by fog/order
        } else {
          c.copy(dim);
          alpha = a.hidden ? 0 : 0.25;
        }
      }

      col.setXYZ(i, c.r, c.g, c.b);
      siz.setX(i, size);
      alp.setX(i, alpha);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    siz.needsUpdate = true;
    alp.needsUpdate = true;
  }

  private writeEdges(): void {
    const pos = this.edgeGeom.getAttribute("position") as THREE.BufferAttribute;
    const col = this.edgeGeom.getAttribute("color") as THREE.BufferAttribute;
    const base = parseRGBA(this.theme.edge).color;
    const hi = parseRGBA(this.theme.edgeHi).color;
    const bg = parseRGBA(this.theme.bg).color;
    const { hoveredNode } = this.style;
    for (let i = 0; i < this.edgePairs.length; i++) {
      const [s, t] = this.edgePairs[i];
      const sa = this.graph.getNodeAttributes(s);
      const ta = this.graph.getNodeAttributes(t);
      pos.setXYZ(i * 2, sa.x, sa.y, sa.z);
      pos.setXYZ(i * 2 + 1, ta.x, ta.y, ta.z);
      let c = base;
      if (hoveredNode) {
        c = s === hoveredNode || t === hoveredNode ? hi : bg; // bg ⇒ invisible
      }
      // hidden endpoints (timelapse) ⇒ collapse to bg so the line vanishes
      if (sa.hidden || ta.hidden) c = bg;
      col.setXYZ(i * 2, c.r, c.g, c.b);
      col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  private updateLabels(): void {
    const h = Math.max(1, this.container.clientHeight);
    const scale = this.sizeScale(h);
    const threshold = Math.max(1, 5 + (this.settings.textFadeThreshold - 1.1) * 6);
    const { hoveredNode } = this.style;
    for (const id of this.nodeIds) {
      const obj = this.labels.get(id);
      if (!obj) continue;
      const a = this.graph.getNodeAttributes(id);
      obj.position.set(a.x, a.y, a.z);
      if (a.hidden) {
        obj.visible = false;
        continue;
      }
      if (hoveredNode) {
        // On hover only the hovered node's label shows (sigma parity).
        obj.visible = id === hoveredNode;
        continue;
      }
      // Hub-first: a label appears once its rendered core size clears the
      // threshold — bigger (hub) nodes cross it first as you orbit closer.
      this.tmpVec.set(a.x, a.y, a.z);
      const dist = Math.max(1, this.camera.position.distanceTo(this.tmpVec));
      const renderedPx = (a.size * NODE_RADIUS * scale) / dist;
      obj.visible = renderedPx > threshold;
    }
  }

  // ---- public API ----

  syncPositions(): void {
    this.writeNodes();
    this.writeEdges();
  }

  setStyleState(s: SceneStyleState): void {
    this.style = s;
    this.writeNodes();
    this.writeEdges();
  }

  // Re-snapshot the (same, mutated) graph after live-ingest growth added nodes/
  // edges. Recreates the fixed-size buffers and label set; reuses the shared
  // materials/scene/camera so the camera framing and orbit are preserved.
  rebuild(): void {
    this.nodeIds = this.graph.nodes();
    this.idIndex = new Map(this.nodeIds.map((id, i) => [id, i]));
    const n = this.nodeIds.length;

    const oldNodeGeom = this.nodeGeom;
    this.nodeGeom = new THREE.BufferGeometry();
    this.nodeGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.nodeGeom.setAttribute("a_color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.nodeGeom.setAttribute("a_size", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.nodeGeom.setAttribute("a_alpha", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.points.geometry = this.nodeGeom;
    oldNodeGeom.dispose();

    this.edgePairs = this.graph.mapEdges(
      (_e, _a, s, t) => [s, t] as [string, string],
    );
    const oldEdgeGeom = this.edgeGeom;
    this.edgeGeom = new THREE.BufferGeometry();
    this.edgeGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.edgePairs.length * 6), 3));
    this.edgeGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.edgePairs.length * 6), 3));
    this.edges.geometry = this.edgeGeom;
    oldEdgeGeom.dispose();

    // Labels: add any missing, drop any gone.
    const live = new Set(this.nodeIds);
    for (const [id, obj] of this.labels) {
      if (!live.has(id)) {
        obj.element.remove();
        this.scene.remove(obj);
        this.labels.delete(id);
      }
    }
    for (const id of this.nodeIds) {
      if (this.labels.has(id)) continue;
      const el = document.createElement("div");
      el.className = "graph-label-3d";
      el.textContent = this.graph.getNodeAttribute(id, "label");
      el.style.color = this.theme.ink;
      const obj = new CSS2DObject(el);
      obj.visible = false;
      this.scene.add(obj);
      this.labels.set(id, obj);
    }

    this.writeNodes();
    this.writeEdges();
  }

  applyTheme(theme: GraphTheme): void {
    this.theme = theme;
    const bg = parseRGBA(theme.bg).color;
    this.scene.background = bg;
    (this.scene.fog as THREE.FogExp2).color.copy(bg);
    const dark = bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    this.baseBloom = dark ? 1.2 : 0.3;
    this.bloom.strength = this.baseBloom * this.settings.brightness;
    this.bloom.threshold = dark ? 0.0 : 0.6;
    const edge = parseRGBA(theme.edge);
    this.edgeMat.opacity = Math.min(1, edge.alpha * 3.5);
    for (const obj of this.labels.values()) {
      (obj.element as HTMLElement).style.color = theme.ink;
    }
    this.writeNodes();
    this.writeEdges();
  }

  applySettings(settings: GraphSettings): void {
    this.settings = settings;
    this.edgeMat.opacity = Math.min(
      1,
      parseRGBA(this.theme.edge).alpha * 3.5 * settings.linkThickness,
    );
    // Brightness: overall exposure + bloom glow intensity.
    this.renderer.toneMappingExposure = settings.brightness;
    this.bloom.strength = this.baseBloom * settings.brightness;
  }

  zoomIn(): void {
    this.dollyBy(0.8);
  }
  zoomOut(): void {
    this.dollyBy(1.25);
  }
  private dollyBy(factor: number): void {
    const dir = this.tmpVec
      .copy(this.camera.position)
      .sub(this.controls.target);
    const len = THREE.MathUtils.clamp(
      dir.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    dir.setLength(len);
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  fit(): void {
    // Bounding sphere of the (visible) nodes → frame the cluster.
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    for (const id of this.nodeIds) {
      const a = this.graph.getNodeAttributes(id);
      if (a.hidden) continue;
      cx += a.x;
      cy += a.y;
      cz += a.z;
      count++;
    }
    if (count === 0) return;
    cx /= count;
    cy /= count;
    cz /= count;
    let r = 1;
    for (const id of this.nodeIds) {
      const a = this.graph.getNodeAttributes(id);
      if (a.hidden) continue;
      r = Math.max(r, Math.hypot(a.x - cx, a.y - cy, a.z - cz));
    }
    this.controls.target.set(cx, cy, cz);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const dist = (r * 1.5) / Math.tan(fovRad / 2) + 60;
    const dir = this.tmpVec
      .copy(this.camera.position)
      .sub(this.controls.target);
    if (dir.lengthSq() < 1) dir.set(0.3, 0.15, 1);
    dir.setLength(THREE.MathUtils.clamp(dist, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(dir);
    this.controls.update();
  }

  start(): void {
    if (this.raf != null) return;
    const loop = (): void => {
      this.controls.update();
      this.updateLabels();
      this.composer.render();
      this.labelRenderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("webglcontextlost", this.onCtxLost);
    el.removeEventListener("webglcontextrestored", this.onCtxRestored);
    this.controls.dispose();
    for (const obj of this.labels.values()) {
      obj.element.remove();
      this.scene.remove(obj);
    }
    this.labels.clear();
    this.nodeGeom.dispose();
    this.nodeMat.dispose();
    this.edgeGeom.dispose();
    this.edgeMat.dispose();
    (this.starfield.geometry as THREE.BufferGeometry).dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }

  // ---- interaction ----

  private onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.nodeMat.uniforms.u_sizeScale.value = this.sizeScale(h);
  };

  private pickNode(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = this.sizeScale(Math.max(1, rect.height));
    let best: string | null = null;
    let bestD = Infinity;
    for (const id of this.nodeIds) {
      const a = this.graph.getNodeAttributes(id);
      if (a.hidden) continue;
      this.tmpVec.set(a.x, a.y, a.z).project(this.camera);
      if (this.tmpVec.z > 1) continue; // behind camera / clipped
      const sx = (this.tmpVec.x * 0.5 + 0.5) * rect.width;
      const sy = (-this.tmpVec.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      const dist = Math.max(
        1,
        this.camera.position.distanceTo(this.tmpVec.set(a.x, a.y, a.z)),
      );
      const renderedPx = (a.size * NODE_RADIUS * scale) / dist;
      const hitR = Math.max(PICK_BASE_PX, renderedPx);
      if (d < hitR && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private dragWorld(clientX: number, clientY: number, anchor: THREE.Vector3): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tmpNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.tmpNdc, this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, anchor);
    const out = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.dragPlane, out);
    return out.lengthSq() > 0 ? out : anchor.clone();
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragId) {
      this.dragMoved = true;
      const a = this.graph.getNodeAttributes(this.dragId);
      const p = this.dragWorld(e.clientX, e.clientY, this.tmpVec.set(a.x, a.y, a.z).clone());
      this.cb.onDrag(this.dragId, p.x, p.y, p.z);
      return;
    }
    const id = this.pickNode(e.clientX, e.clientY);
    this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.cb.onNodeHover(id);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const id = this.pickNode(e.clientX, e.clientY);
    if (id) {
      this.dragId = id;
      this.dragMoved = false;
      this.controls.enabled = false; // don't orbit while dragging a star
      this.cb.onDragStart(id);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const id = this.dragId;
    if (id) {
      this.controls.enabled = true;
      const moved =
        this.dragMoved &&
        this.downAt != null &&
        Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 3;
      this.cb.onDragEnd(id);
      if (!moved) this.cb.onNodeClick(id);
      this.dragId = null;
      this.dragMoved = false;
    }
    this.downAt = null;
  };

  private onCtxLost = (e: Event): void => {
    e.preventDefault();
  };
  private onCtxRestored = (): void => {
    this.cb.onContextRestored();
  };
}
