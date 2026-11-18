import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GRID_SPACE } from "./templates";
import type { BevelProfile, CameraPose, Material } from "@/store/editor";

/**
 * The tilted 3D canvas. The board is the artboard (GRID_SPACE units square) lying in the XY
 * plane; every layer's traced outline is extruded towards the viewer. The camera orbits the
 * board on a turntable: `tilt` leans the board back, `turn` spins it around its centre.
 */

export interface MeshSpec {
  layerId: string;
  color: string;
  /** Traced outline in artboard space (SVG, y down). */
  d: string;
  extrude: number;
  bevel: number;
  profile: BevelProfile;
  sideColor: string | null;
  opacity: number;
}

export interface SceneInput {
  meshes: MeshSpec[];
  /** Grid guide path in artboard space, with an optional SVG matrix. */
  grid: { d: string; matrix?: number[] } | null;
  lineColor: string;
  lineOpacity: number;
  material: Material;
  lightAngle: number;
  lightIntensity: number;
  /** Outline and depth of the face picked with the Extrude tool. */
  face: { d: string; depth: number } | null;
  /** Outline and depth of the face under the pointer. */
  hover: { d: string; depth: number } | null;
}

const HALF = GRID_SPACE / 2;
/** Radius the camera frames: a little more than the board's half-diagonal. */
const FRAME_R = HALF * 1.5;
const deg = THREE.MathUtils.degToRad;

const MATERIALS: Record<Material, { roughness: number; metalness: number; clearcoat: number }> = {
  matte: { roughness: 0.92, metalness: 0, clearcoat: 0 },
  glossy: { roughness: 0.32, metalness: 0, clearcoat: 0.7 },
  metal: { roughness: 0.3, metalness: 0.9, clearcoat: 0 },
};

const shapeCache = new Map<string, THREE.Shape[]>();
function shapesOf(d: string) {
  let s = shapeCache.get(d);
  if (!s) {
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill-rule="evenodd"/></svg>`);
    s = data.paths.flatMap((p) => SVGLoader.createShapes(p));
    if (shapeCache.size > 200) shapeCache.clear();
    shapeCache.set(d, s);
  }
  return s;
}

function extrudeGeometry(m: MeshSpec) {
  const depth = Math.max(0.5, m.extrude);
  // Bevels eat into the outline; cap them so thin parts don't tear.
  const b = Math.min(m.bevel, depth / 2 - 0.1, 6);
  const bevel = b > 0.05;
  const opts: THREE.ExtrudeGeometryOptions = {
    depth: bevel && m.profile !== "step" ? depth - b : depth,
    curveSegments: 8,
    bevelEnabled: bevel,
    bevelThickness: m.profile === "step" ? 0.01 : b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: m.profile === "round" ? 5 : 1,
  };
  // ExtrudeGeometry bevels both caps (z from -b to depth + b). The back bevel sinks under the
  // opaque board, so the visible top lands exactly at `extrude`.
  return new THREE.ExtrudeGeometry(shapesOf(m.d), opts);
}

export class Scene3DEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private pivot = new THREE.Object3D();
  private persp = new THREE.PerspectiveCamera(35, 1, 1, 6000);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  private model = new THREE.Group();
  private meshes = new THREE.Group();
  private grid: THREE.LineSegments | null = null;
  private highlight = new THREE.Group();
  private hoverGroup = new THREE.Group();
  /** Corners of the hovered face's top (model space); its HTML controls sit above them on screen. */
  private hoverAnchor: THREE.Vector3[] | null = null;
  private arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 40, 0x0d99ff, 10, 7);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private ambient = new THREE.HemisphereLight(0xffffff, 0x404040, 0.9);
  private pose: CameraPose;
  private target: CameraPose;
  private size = { w: 1, h: 1 };
  private raf = 0;
  private dirty = true;
  private input: SceneInput | null = null;
  private thumbRenderer: THREE.WebGLRenderer | null = null;
  /** Screen position (CSS px) of the hovered face's top centre, after every render. */
  onHover: ((p: { x: number; y: number } | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, pose: CameraPose) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.pose = { ...pose };
    this.target = { ...pose };
    this.pivot.rotation.order = "ZXY";
    this.pivot.add(this.persp, this.ortho);
    this.scene.add(this.pivot, this.sun, this.sun.target, this.ambient);

    // Artboard: SVG space (y down) mapped onto the XY plane, centred on the origin.
    this.model.scale.set(1, -1, 1);
    this.model.position.set(-HALF, HALF, 0);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SPACE, GRID_SPACE), new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 1 }));
    board.position.set(HALF, HALF, -0.05);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(board.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
    edge.position.copy(board.position);
    this.model.add(board, edge, this.meshes, this.hoverGroup, this.highlight, this.arrow);
    this.arrow.visible = false;
    this.scene.add(this.model);
    this.loop();
  }

  setSize(w: number, h: number) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.dirty = true;
  }

  setPose(p: CameraPose, immediate = false) {
    this.target = { ...p };
    // Projection can't be interpolated; switch it straight away.
    this.pose.projection = p.projection;
    if (immediate) this.pose = { ...p };
    this.dirty = true;
  }

  setInput(input: SceneInput) {
    const prev = this.input;
    this.input = input;
    if (!prev || prev.meshes !== input.meshes || prev.material !== input.material) this.buildMeshes();
    if (!prev || prev.grid !== input.grid || prev.lineColor !== input.lineColor || prev.lineOpacity !== input.lineOpacity) this.buildGrid();
    if (!prev || prev.face !== input.face) this.buildHighlight();
    if (!prev || prev.hover !== input.hover) this.buildHover();
    const a = deg(input.lightAngle);
    this.sun.position.set(Math.cos(a) * 300, Math.sin(a) * 300, 360);
    this.sun.intensity = (input.lightIntensity / 100) * 3;
    this.ambient.intensity = 0.55 + (1 - input.lightIntensity / 100) * 0.4;
    this.dirty = true;
  }

  private buildMeshes() {
    for (const c of this.meshes.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material[]).forEach((x) => x.dispose());
    }
    this.meshes.clear();
    const kind = MATERIALS[this.input!.material];
    for (const spec of this.input!.meshes) {
      const mat = (color: string) =>
        new THREE.MeshPhysicalMaterial({
          color,
          ...kind,
          transparent: spec.opacity < 100,
          opacity: spec.opacity / 100,
        });
      const mesh = new THREE.Mesh(extrudeGeometry(spec), [mat(spec.color), mat(spec.sideColor ?? spec.color)]);
      mesh.userData.layerId = spec.layerId;
      mesh.userData.top = Math.max(0.5, spec.extrude);
      this.meshes.add(mesh);
    }
  }

  private buildGrid() {
    if (this.grid) {
      this.model.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    const g = this.input!.grid;
    if (!g) return;
    const [a, b, c, d, e, f] = g.matrix ?? [1, 0, 0, 1, 0, 0];
    const pts: number[] = [];
    const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${g.d}"/></svg>`);
    for (const p of data.paths)
      for (const sp of p.subPaths) {
        const ps = sp.getPoints(24);
        for (let i = 1; i < ps.length; i++) {
          const p0 = ps[i - 1], p1 = ps[i];
          const x0 = a * p0.x + c * p0.y + e, y0 = b * p0.x + d * p0.y + f;
          const x1 = a * p1.x + c * p1.y + e, y1 = b * p1.x + d * p1.y + f;
          // Keep only what lies on the artboard (the 2D view clips the same way).
          if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > GRID_SPACE || Math.max(y0, y1) < 0 || Math.min(y0, y1) > GRID_SPACE) continue;
          pts.push(x0, y0, 0.05, x1, y1, 0.05);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.input!.lineColor, transparent: true, opacity: Math.max(0.05, this.input!.lineOpacity / 100) }));
    this.model.add(this.grid);
  }

  /** Outline of the picked face and the extrude handle on top of it. */
  private buildHighlight() {
    for (const c of this.highlight.children) {
      (c as THREE.LineSegments).geometry.dispose();
      ((c as THREE.LineSegments).material as THREE.Material).dispose();
    }
    this.highlight.clear();
    const face = this.input?.face;
    this.arrow.visible = !!face;
    if (!face) return;
    const top = Math.max(0.5, face.depth);
    // Outline the face's top and footprint (a plain prism; the bevel would only add noise).
    const prism = new THREE.ExtrudeGeometry(shapesOf(face.d), { depth: top + 0.15, bevelEnabled: false, curveSegments: 8 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(prism, 35), new THREE.LineBasicMaterial({ color: 0x0d99ff, transparent: true, opacity: 0.95 }));
    prism.computeBoundingBox();
    const c = prism.boundingBox!.getCenter(new THREE.Vector3());
    prism.dispose();
    this.highlight.add(edges);
    this.arrow.position.set(c.x, c.y, top);
    this.arrow.setDirection(new THREE.Vector3(0, 0, 1));
  }

  /** Soft outline on the face under the pointer. */
  private buildHover() {
    for (const c of this.hoverGroup.children) {
      (c as THREE.LineSegments).geometry.dispose();
      ((c as THREE.LineSegments).material as THREE.Material).dispose();
    }
    this.hoverGroup.clear();
    const hover = this.input?.hover;
    this.hoverAnchor = null;
    if (!hover) return;
    const top = Math.max(0.5, hover.depth);
    const prism = new THREE.ExtrudeGeometry(shapesOf(hover.d), { depth: top + 0.1, bevelEnabled: false, curveSegments: 8 });
    this.hoverGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(prism, 35), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })));
    prism.computeBoundingBox();
    const b = prism.boundingBox!;
    this.hoverAnchor = [
      new THREE.Vector3(b.min.x, b.min.y, top), new THREE.Vector3(b.max.x, b.min.y, top),
      new THREE.Vector3(b.max.x, b.max.y, top), new THREE.Vector3(b.min.x, b.max.y, top),
    ];
    prism.dispose();
  }

  /** Artboard point (SVG space) of the model surface under a canvas point (CSS px), or null. */
  pick(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / this.size.w) * 2 - 1, -(y / this.size.h) * 2 + 1), this.camera());
    const hit = ray.intersectObjects(this.meshes.children, false)[0];
    if (!hit) return null;
    // Step a little into the solid so a hit on a side wall lands inside its own shape.
    const p = hit.point.clone().addScaledVector(ray.ray.direction, 0.4);
    const local = this.model.worldToLocal(p);
    return { x: local.x, y: local.y, layerId: hit.object.userData.layerId as string };
  }

  private camera(): THREE.Camera {
    return this.pose.projection === "perspective" ? this.persp : this.ortho;
  }

  private applyPose(p: CameraPose, aspect: number) {
    this.pivot.rotation.set(deg(p.tilt), 0, deg(p.turn));
    const fit = FRAME_R * p.distance;
    this.persp.fov = p.fov;
    this.persp.aspect = aspect;
    const fovFit = Math.min(deg(p.fov), 2 * Math.atan(Math.tan(deg(p.fov) / 2) * aspect));
    this.persp.position.set(0, 0, fit / Math.sin(fovFit / 2));
    this.persp.updateProjectionMatrix();
    const hh = aspect >= 1 ? fit : fit / aspect;
    Object.assign(this.ortho, { left: -hh * aspect, right: hh * aspect, top: hh, bottom: -hh });
    this.ortho.position.set(0, 0, 2000);
    this.ortho.updateProjectionMatrix();
    this.pivot.updateMatrixWorld(true);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const p = this.pose, t = this.target;
    const k = 0.22;
    let moving = false;
    for (const key of ["tilt", "turn", "fov", "distance"] as const) {
      const dv = t[key] - p[key];
      if (Math.abs(dv) > 0.01) { p[key] += dv * k; moving = true; }
      else p[key] = t[key];
    }
    if (!moving && !this.dirty) return;
    this.dirty = false;
    this.applyPose(p, this.size.w / this.size.h);
    this.renderer.render(this.scene, this.camera());
    if (this.onHover) {
      if (!this.hoverAnchor) this.onHover(null);
      else {
        // Centred over the face's on-screen extent, just above its highest point.
        const pts = this.hoverAnchor.map((c) => {
          const p = this.model.localToWorld(c.clone()).project(this.camera());
          return { x: ((p.x + 1) / 2) * this.size.w, y: ((1 - p.y) / 2) * this.size.h };
        });
        const xs = pts.map((p) => p.x);
        this.onHover({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...pts.map((p) => p.y)) });
      }
    }
  };

  /** Renders the scene from another pose into a small image (camera thumbnails). */
  thumbnail(p: CameraPose, w: number, h: number) {
    this.thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    const r = this.thumbRenderer;
    r.setPixelRatio(2);
    r.setSize(w, h, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const keep = { ...this.pose };
    this.highlight.visible = this.arrow.visible = this.hoverGroup.visible = false;
    this.applyPose({ ...p, distance: p.distance * 1.08 }, w / h);
    r.render(this.scene, p.projection === "perspective" ? this.persp : this.ortho);
    const url = r.domElement.toDataURL("image/png");
    this.highlight.visible = this.hoverGroup.visible = true;
    this.buildHighlight();
    this.pose = keep;
    this.dirty = true;
    return url;
  }

  /** Current view as a PNG blob (for export). */
  snapshot(scale = 2): Promise<Blob | null> {
    const { w, h } = this.size;
    const prevRatio = this.renderer.getPixelRatio();
    this.highlight.visible = this.arrow.visible = this.hoverGroup.visible = false;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.applyPose(this.pose, w / h);
    this.renderer.render(this.scene, this.camera());
    return new Promise((resolve) =>
      this.renderer.domElement.toBlob((b) => {
        this.renderer.setPixelRatio(prevRatio);
        this.renderer.setSize(w, h, false);
        this.highlight.visible = this.hoverGroup.visible = true;
        this.buildHighlight();
        this.dirty = true;
        resolve(b);
      }, "image/png"),
    );
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.thumbRenderer?.dispose();
  }
}
