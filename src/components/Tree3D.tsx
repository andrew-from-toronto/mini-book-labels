import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildBookParts, hookGeometry, type BookMesh, type PartName } from '../lib/bookModel';
import {
  atRest,
  baubleBody,
  bentDirection,
  bookBody,
  clearSprays,
  clipBranch,
  hangAll,
  poseOf,
  presentObstacle,
  settle,
  step,
  type Body,
  type Hung,
  type Motion,
  type Obstacle,
} from '../lib/hanging';
import { partGeometry, type PartGeometry } from '../lib/bookUv';
import type { CoverResult } from '../lib/covers';
import { defaultWrapSpine } from '../lib/layout';
import { drawLabel } from '../lib/render';
import {
  anchorsOf,
  presentsFor,
  radiusAt,
  BAUBLE_STYLES,
  type Anchor,
  type BaubleStyle,
  type Present,
  buildLights,
  buildTree,
  TREE_SIZES,
  treeShape,
  type Bulb,
  type Spray,
  type LightStyle,
  type TreeShape,
  type TreeSize,
  CUSTOM_HEIGHT,
  FOOT,
  formatHeight,
  parseHeight,
  type HeightUnit,
  type Vec3,
} from '../lib/tree';
import type { Book, CustomCover, Settings } from '../lib/types';

/**
 * The books hung on a Christmas tree, to see a set of ornaments together before printing them. The tree
 * is built from numbers in lib/tree.ts; this draws it with three.js. Lit as a room at night: a warm lamp
 * casting shadows, a little light from the room, and the tree's own string of lights, whose bulbs glow
 * and twinkle and light the books and needles near them.
 */

interface Props {
  /** The books on the sheet, hung in this order of their places on the tree. */
  books: Book[];
  coverOf: (book: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
  settings: Settings;
}

/** A tree can only hold so many before it is all books, and each is drawn; more than this are left off. */
const MAX_BOOKS = 150;
const PLASTIC = '#d8d2c8';
const PAPER = '#f4ecdc';
const MM = 0.001;
const BACKGROUND = '#15110d';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = () => matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;

/** A size from the list, or a height of the viewer's own. */
type SizeChoice = TreeSize | 'custom';

function storedSize(): SizeChoice {
  try {
    const v = localStorage.getItem('treeSize');
    if (v === 'custom' || (v && v in TREE_SIZES)) return v as SizeChoice;
  } catch {
    /* storage blocked */
  }
  return 'tabletop';
}

/** The custom height in metres, 5 ft until one is set. */
function storedCustomHeight(): number {
  try {
    const v = Number(localStorage.getItem('treeHeight'));
    if (v >= CUSTOM_HEIGHT.min && v <= CUSTOM_HEIGHT.max) return v;
  } catch {
    /* storage blocked */
  }
  return 5 * FOOT;
}

/** Feet unless chosen otherwise: trees are sold by the foot in North America. */
function storedUnit(): HeightUnit {
  try {
    return localStorage.getItem('treeUnit') === 'cm' ? 'cm' : 'ft';
  } catch {
    return 'ft';
  }
}

function storedBaubles(): BaubleStyle {
  try {
    const v = localStorage.getItem('treeBaubles');
    if (v && v in BAUBLE_STYLES) return v as BaubleStyle;
  } catch {
    /* storage blocked */
  }
  return 'classic';
}

function storedLights(): LightStyle {
  try {
    return localStorage.getItem('treeLights') === 'colour' ? 'colour' : 'warm';
  } catch {
    return 'warm';
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/** Fir needles on a twig, drawn once: a spray of needles either side of a stem, paler at the new tip. */
function needleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const greens = ['#0e2a1a', '#123422', '#173f29', '#1b472e', '#10301e'];
  const tips = ['#3b7444', '#457f4b', '#356a3d'];
  ctx.lineCap = 'round';
  const mid = 64;
  // Side twigs off the main stem, each bristling with short needles, as on a fir.
  const twig = (x0: number, y0: number, angle: number, length: number, needle: number) => {
    ctx.strokeStyle = '#2a2116';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(angle) * length, y0 + Math.sin(angle) * length);
    ctx.stroke();
    for (let d = 2; d < length; d += 1.7) {
      const x = x0 + Math.cos(angle) * d;
      const y = y0 + Math.sin(angle) * d;
      const tip = d > length * 0.75;
      for (const side of [-1, 1]) {
        const a = angle + side * ((55 + Math.random() * 25) * Math.PI) / 180;
        const l = needle * (0.75 + Math.random() * 0.4) * (1 - (d / length) * 0.3);
        ctx.strokeStyle = tip && Math.random() < 0.6 ? tips[Math.floor(Math.random() * tips.length)] : greens[Math.floor(Math.random() * greens.length)];
        ctx.lineWidth = 1.5 + Math.random() * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  };
  for (let x = 30; x < 470; x += 34 + Math.random() * 14) {
    const reach = 1 - (x / 512) * 0.55;
    twig(x, mid, (-(40 + Math.random() * 15) * Math.PI) / 180, 70 * reach, 11);
    twig(x + 12, mid, ((40 + Math.random() * 15) * Math.PI) / 180, 70 * reach, 11);
  }
  twig(4, mid, 0, 500, 13);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Four cards crossed along +x, from 0 to 1, so a spray of needles looks full from every side. */
function sprayGeometry(): THREE.BufferGeometry {
  const cards = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map((a) => new THREE.PlaneGeometry(1, 0.3).translate(0.5, 0, 0).rotateX(a));
  const merged = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  for (const name of attrs) {
    const arrays = cards.map((g) => g.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      out.set(a, o);
      o += a.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, name === 'uv' ? 2 : 3));
  }
  const index: number[] = [];
  cards.forEach((g, i) => {
    for (const v of g.getIndex()!.array) index.push(v + i * 4);
  });
  merged.setIndex(index);
  for (const g of cards) g.dispose();
  return merged;
}

/** A five-pointed star, standing up and facing -y, `r` to its points. */
function starGeometry(r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? r : r * 0.42;
    if (i === 0) shape.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    else shape.lineTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: r * 0.12,
    bevelEnabled: true,
    bevelThickness: r * 0.08,
    bevelSize: r * 0.06,
    bevelSegments: 2,
  });
  g.center();
  g.rotateX(Math.PI / 2);
  return g;
}

/** Oak boards, drawn once: planks of slightly different tone, with grain and dark joints. Repeats. */
function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d')!;
  const plank = 128;
  for (let row = 0; row < 8; row++) {
    // Boards are staggered, as laid.
    let x = -Math.random() * 600;
    while (x < 1024) {
      const length = 380 + Math.random() * 420;
      const tone = 0.85 + Math.random() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(96 * tone)}, ${Math.round(64 * tone)}, ${Math.round(40 * tone)})`;
      ctx.fillRect(x, row * plank, length, plank);
      // Grain: long wavering lines along the board.
      for (let g = 0; g < 26; g++) {
        const y0 = row * plank + Math.random() * plank;
        ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '40, 24, 12' : '140, 100, 66'}, ${0.08 + Math.random() * 0.12})`;
        ctx.lineWidth = 0.6 + Math.random() * 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        for (let t = 0; t <= length; t += 40) ctx.lineTo(x + t, y0 + Math.sin(t / (60 + g * 7) + g) * 2.5);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20, 12, 6, 0.9)';
      ctx.fillRect(x, row * plank, 2, plank);
      x += length;
    }
    ctx.fillStyle = 'rgba(20, 12, 6, 0.9)';
    ctx.fillRect(0, row * plank, 1024, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Lens fall-off at the corners, as a camera has: the last touch that makes it read as a photo. */
const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.38 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), amount);
      gl_FragColor = c;
    }`,
};

/**
 * One book's parts merged into one geometry, in metres, with the point it hangs from at the origin:
 * the hole in its hook, or the middle of its top. Groups: label, plastic, page block.
 */
function bookGeometry(parts: Map<PartName, PartGeometry>, attach: Vec3): THREE.BufferGeometry {
  const buckets = [0, 1, 2].map(() => ({ p: [] as number[], n: [] as number[], uv: [] as number[] }));
  for (const [name, g] of parts) {
    const triangles = g.positions.length / 9;
    for (let t = 0; t < triangles; t++) {
      const bucket = buckets[t < g.labelCount ? 0 : name === 'pages' ? 2 : 1];
      for (let k = 0; k < 3; k++) {
        const v = t * 3 + k;
        for (let a = 0; a < 3; a++) bucket.p.push((g.positions[v * 3 + a] - attach[a]) * MM);
        for (let a = 0; a < 3; a++) bucket.n.push(g.normals[v * 3 + a]);
        bucket.uv.push(g.uvs[v * 2], g.uvs[v * 2 + 1]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.p), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.n), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buckets.flatMap((b) => b.uv), 2));
  let start = 0;
  buckets.forEach((b, i) => {
    const count = b.p.length / 3;
    geometry.addGroup(start, count, i);
    start += count;
  });
  geometry.computeBoundingSphere();
  return geometry;
}

interface BookEntry {
  mesh: THREE.Mesh;
  label: THREE.MeshStandardMaterial;
  key: string;
  hung: Hung | null;
}

/** Owns the three.js scene, so React only tells it what changed. */
class TreeScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly observer: ResizeObserver;
  private readonly visibility: IntersectionObserver;
  private readonly clock = new THREE.Clock();
  private readonly lowPower = small();
  private readonly still = reducedMotion();
  private onScreen = true;
  private frame: number | null = null;
  private lastTime = 0;
  /** Whether the camera has been moved by hand; until then, a resize frames the tree afresh. */
  private moved = false;
  private treeBuilt = false;

  /** Rebuilt for each tree size and light style. */
  private tree = new THREE.Group();
  /** Books, baubles and their threads, rehung for each shuffle. */
  private ornaments = new THREE.Group();
  private shape: TreeShape = treeShape(TREE_SIZES.tabletop.height);
  private bulbs: Bulb[] = [];
  private bulbMesh: THREE.InstancedMesh | null = null;
  private glows: { light: THREE.PointLight; from: number; to: number; base: number }[] = [];

  private readonly key: THREE.SpotLight;
  private readonly needles = needleTexture();
  private readonly materials = {
    plastic: new THREE.MeshStandardMaterial({ color: PLASTIC, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9 }),
  };
  private bookGeometry: THREE.BufferGeometry | null = null;
  private bookHeight = 0.045;
  private bookBody: Body | null = null;
  /** The needle sprays as built, and their mesh, so sprays can be pushed aside where ornaments hang. */
  private sprays: Spray[] = [];
  private needleMesh: THREE.InstancedMesh | null = null;
  /** Where on the tree ornaments can hang, and the presents under it. */
  private anchors: Anchor[] = [];
  private presents: Present[] = [];
  /** Every ornament hanging: its body, where it hangs, and how it is moving now. */
  private hanging: { body: Body; hung: Hung; motion: Motion; book?: BookEntry; ball?: number; size?: number }[] = [];
  private ballMesh: THREE.InstancedMesh | null = null;
  private capMesh: THREE.InstancedMesh | null = null;
  private ballThreads: THREE.InstancedMesh | null = null;
  private baubleStyle: BaubleStyle = 'classic';
  /** What the ornaments were hung for (books, shuffle, tree); the same again only rethreads them. */
  private placedFor = '';
  /** Whether anything is still swinging, so the simulation runs only while it needs to. */
  private swinging = false;
  /** The tree's turn as the camera orbits it (the other way): last angle, rate and its change. */
  private spin = { last: NaN, rate: 0, accel: 0 };
  private readonly books = new Map<string, BookEntry>();
  private order: string[] = [];
  private seed = 1;

  /** Smoothly moving the camera to a book that was double-clicked. */
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private home = { position: new THREE.Vector3(), target: new THREE.Vector3() };

  constructor(private readonly host: HTMLElement) {
    // The canvas joins the page before its WebGL context is made, as for the 3D book (WebKit).
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowPower ? 1.5 : 2));
    // Khronos PBR Neutral: highlights roll off to white as in a photo, and mid-tones keep their true
    // colour, so a label on the tree looks as it will print.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.1);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.1;
    pmrem.dispose();

    // z up, as the books are modelled.
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.tree, this.ornaments);
    this.scene.add(new THREE.HemisphereLight(0xffe2c4, 0x1c130c, 0.22));
    // A warm lamp in the room, front left and above: the light that throws the shadows. A spot, so the
    // room falls off into shadow away from it, as a real one does, rather than being lit evenly.
    this.key = new THREE.SpotLight(0xffe0bc, 1, 0, 0.55, 0.85, 2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.setScalar(this.lowPower ? 1024 : 2048);
    this.key.shadow.bias = -0.0004;
    this.scene.add(this.key, this.key.target);
    // Cool light from a window behind, to pick out the tree's edge.
    const rim = new THREE.DirectionalLight(0xc4d0ef, 0.22);
    rim.position.set(2, 3, 2.5);
    this.scene.add(rim);

    const target = this.lowPower ? undefined : new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Only what is brighter than white glows: the bulbs and the star.
    // Only the bulbs and the star are bright enough to glow; needles lit up close by a bulb are not.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.2, 1.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(VIGNETTE));
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = true;
    // Never below the floor.
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.autoRotate = !this.still;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.flight = null;
      this.moved = true;
    });
    this.renderer.domElement.addEventListener('dblclick', (e) => this.focusAt(e.clientX, e.clientY));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.visibility = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
    });
    this.visibility.observe(host);
    this.resize();
    this.loop();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // Bloom at half size: it is a blur, and this keeps phones cool.
    this.bloom.setSize(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.treeBuilt && !this.moved) this.frameTree();
  }

  /** Draws continuously while the tree is on screen, for the twinkling; stops while hidden. */
  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.onScreen || document.hidden) return;
    const time = this.clock.getElapsedTime();
    const dt = Math.min(0.1, time - this.lastTime);
    this.lastTime = time;
    this.twinkle(this.still ? 0 : time);
    this.simulate(dt);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 0.8);
      const e = f.t * f.t * (3 - 2 * f.t);
      this.camera.position.lerpVectors(f.from, f.to, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update();
    this.composer.render();
  };

  /** Each bulb flickers on its own; each glow light follows the bulbs it stands for, lighting what is near. */
  private twinkle(time: number) {
    if (!this.bulbMesh) return;
    const glow = new THREE.Color();
    const levels = this.bulbs.map((b) => (time ? 0.78 + 0.22 * Math.sin(time * b.speed + b.phase) ** 2 : 0.9));
    this.bulbs.forEach((b, i) => {
      // As bright as each other whatever the colour: a blue bulb is not dimmer than a warm one.
      const luminance = 0.2126 * b.colour[0] + 0.7152 * b.colour[1] + 0.0722 * b.colour[2];
      const l = (levels[i] * 2.4) / Math.max(0.2, luminance);
      this.bulbMesh!.setColorAt(i, glow.setRGB(b.colour[0] * l, b.colour[1] * l, b.colour[2] * l));
    });
    this.bulbMesh.instanceColor!.needsUpdate = true;
    for (const g of this.glows) {
      let sum = 0;
      for (let i = g.from; i < g.to; i++) sum += levels[i];
      g.light.intensity = (g.base * sum) / Math.max(1, g.to - g.from);
    }
  }

  /** A new tree: its size, its lights, the star, the stand. Ornaments are rehung to fit. */
  /** A new tree, `height` metres tall, with the given lights. */
  setTree(height: number, lights: LightStyle) {
    this.disposeGroup(this.tree);
    this.glows = [];
    this.shape = treeShape(height);
    const s = this.shape;
    const H = s.height;
    const { branches, sprays } = buildTree(s);

    // The room: an oak floor, and a wall behind the tree that its shadow falls on. Planks about 12 cm wide.
    const boards = floorTexture();
    boards.repeat.setScalar((H * 10) / 0.96);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 10, H * 10),
      new THREE.MeshStandardMaterial({ map: boards, roughness: 0.42, metalness: 0 }),
    );
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 10, H * 3).rotateX(Math.PI / 2).translate(0, s.radius * 2.6, H * 1.5),
      new THREE.MeshStandardMaterial({ color: '#5b4d40', roughness: 0.95 }),
    );
    wall.receiveShadow = true;
    // Faces the tree; seen from behind (orbiting round) it is not drawn, so it never blocks the view.
    // A felt tree skirt with a cream border.
    const skirt = new THREE.Mesh(
      new THREE.CircleGeometry(s.radius * 0.95, 64).translate(0, 0, 0.002),
      new THREE.MeshStandardMaterial({ color: '#6d1416', roughness: 1 }),
    );
    const trim = new THREE.Mesh(
      new THREE.RingGeometry(s.radius * 0.92, s.radius, 64).translate(0, 0, 0.0025),
      new THREE.MeshStandardMaterial({ color: '#e7dfd0', roughness: 1 }),
    );
    skirt.receiveShadow = trim.receiveShadow = true;
    this.tree.add(wall, skirt, trim);
    this.presents = presentsFor(s);
    this.addPresents(this.presents);
    const gifts = this.presents.map(presentObstacle);
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(H * 0.1, H * 0.12, s.bottom * 0.75, 32).rotateX(Math.PI / 2).translate(0, 0, (s.bottom * 0.75) / 2),
      new THREE.MeshStandardMaterial({ color: '#5e1414', roughness: 0.45 }),
    );
    stand.castShadow = stand.receiveShadow = true;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(H * 0.004, H * 0.018, s.top, 10).rotateX(Math.PI / 2).translate(0, 0, s.top / 2),
      new THREE.MeshStandardMaterial({ color: '#4a3426', roughness: 0.95 }),
    );
    trunk.castShadow = true;
    this.tree.add(floor, stand, trunk);

    // Branches, mostly hidden but seen between sprays.
    const limb = new THREE.CylinderGeometry(0.45, 1, 1, 5).translate(0, 0.5, 0);
    const limbs = new THREE.InstancedMesh(limb, new THREE.MeshStandardMaterial({ color: '#3b2a1d', roughness: 0.95 }), branches.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    branches.forEach((b, i) => {
      v.set(b.end[0] - b.start[0], b.end[1] - b.start[1], b.end[2] - b.start[2]);
      const full = v.length();
      v.normalize();
      // A low bough meeting a present rests on it rather than passing through.
      const length = clipBranch(b.start, [v.x, v.y, v.z], full, b.radius, gifts);
      q.setFromUnitVectors(up, v);
      m.compose(new THREE.Vector3(...b.start), q, new THREE.Vector3(b.radius, length, b.radius));
      limbs.setMatrixAt(i, m);
    });
    limbs.castShadow = true;
    this.tree.add(limbs);

    // Needle sprays: crossed cards with a needle texture, shading each a little differently.
    const sprayMaterial = new THREE.MeshStandardMaterial({
      map: this.needles,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.78,
    });
    const needles = new THREE.InstancedMesh(sprayGeometry(), sprayMaterial, sprays.length);
    const tint = new THREE.Color();
    this.sprays = sprays;
    this.needleMesh = needles;
    this.anchors = anchorsOf(s, sprays);
    this.placedFor = '';
    this.placeSprays(sprays.map((sp) => sp.length));
    sprays.forEach((sp, i) => needles.setColorAt(i, tint.setRGB(sp.shade, sp.shade * 1.02, sp.shade * 0.95)));
    // Needles throw shadows through their gaps, so the cards need their cut-out shape in the shadow pass too.
    needles.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.needles, alphaTest: 0.45 });
    needles.castShadow = needles.receiveShadow = true;
    this.tree.add(needles);

    // The string of lights: wire, bulbs and, for every few bulbs, a light that reaches what is near them.
    // Pre-lit: bulbs clipped along the branches, their green wire hidden in the needles.
    this.bulbs = buildLights(s, lights, sprays);
    const bulbRadius = 0.0024 + 0.001 * H;
    this.bulbMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(bulbRadius, 18, 12).scale(1, 1, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      this.bulbs.length,
    );
    this.bulbs.forEach((b, i) => {
      m.makeTranslation(b.at[0], b.at[1], b.at[2]);
      this.bulbMesh!.setMatrixAt(i, m);
      this.bulbMesh!.setColorAt(i, tint.set(0xffffff));
    });
    this.tree.add(this.bulbMesh);

    // A light for each region of the tree (round it, and up it), standing for the bulbs there, so books
    // and needles near bulbs are lit by them. Bulbs are ordered by region, so each light covers a run.
    const around = this.lowPower ? 3 : 5;
    const levels = 2;
    const region = (b: Bulb) => {
      const a = Math.floor(((Math.atan2(b.at[1], b.at[0]) + Math.PI) / (Math.PI * 2)) * around) % around;
      const h = Math.min(levels - 1, Math.floor(((b.at[2] - s.bottom) / (s.top - s.bottom)) * levels));
      return h * around + a;
    };
    this.bulbs.sort((a, b) => region(a) - region(b));
    let from = 0;
    while (from < this.bulbs.length) {
      const which = region(this.bulbs[from]);
      let to = from;
      while (to < this.bulbs.length && region(this.bulbs[to]) === which) to++;
      const run = this.bulbs.slice(from, to);
      const centre = new THREE.Vector3();
      const colour = new THREE.Color(0, 0, 0);
      for (const b of run) {
        centre.add(new THREE.Vector3(...b.at));
        colour.r += b.colour[0];
        colour.g += b.colour[1];
        colour.b += b.colour[2];
      }
      centre.divideScalar(run.length);
      // Pushed out to the needle tips, where the books hang.
      const r = Math.hypot(centre.x, centre.y);
      if (r > 0) {
        const k = (radiusAt(s, centre.z) * 1.05) / r;
        centre.x *= k;
        centre.y *= k;
      }
      const max = Math.max(colour.r, colour.g, colour.b) || 1;
      colour.multiplyScalar(1 / max);
      // Candela, scaled with the tree, so the glow on the books looks the same at any size.
      const base = 0.045 * H * H;
      const light = new THREE.PointLight(colour, base, H * 0.5, 2);
      light.position.copy(centre);
      this.tree.add(light);
      this.glows.push({ light, from, to, base });
      from = to;
    }
    this.bulbMesh.count = this.bulbs.length;
    this.bulbs.forEach((b, i) => {
      m.makeTranslation(b.at[0], b.at[1], b.at[2]);
      this.bulbMesh!.setMatrixAt(i, m);
    });

    // The star, glowing, with a light of its own.
    const starSize = H * 0.055;
    const star = new THREE.Mesh(
      starGeometry(starSize),
      new THREE.MeshStandardMaterial({ color: '#f2c060', metalness: 0.85, roughness: 0.28, emissive: '#ffb347', emissiveIntensity: 0.3 }),
    );
    star.position.set(0, 0, s.top + starSize * 0.75);
    star.castShadow = true;
    const starLight = new THREE.PointLight(0xffc370, 0.03 * H * H, H * 0.5, 2);
    starLight.position.set(0, -starSize, s.top + starSize * 0.6);
    this.tree.add(star, starLight);

    // The lamp's shadow box covers the whole tree.
    this.key.position.set(-H * 1.3, -H * 1.9, H * 2.3);
    this.key.target.position.set(0, 0, H * 0.45);
    // Candela, for about 2.4 lux on the tree from where the lamp stands.
    this.key.intensity = 2.4 * this.key.position.distanceToSquared(this.key.target.position);
    this.key.shadow.camera.near = H * 0.5;
    this.key.shadow.camera.far = H * 6;
    this.key.shadow.camera.updateProjectionMatrix();
    this.key.shadow.normalBias = H * 0.002;

    (this.scene.fog as THREE.FogExp2).density = 0.1 / H;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = H * 5;
    this.treeBuilt = true;
    this.frameTree();
    this.hang();
  }

  /** Wrapped presents under the tree (lib/tree.ts presentsFor), each with a ribbon and bow. */
  private addPresents(presents: Present[]) {
    for (const p of presents) {
      const [w, d, h] = p.size;
      const box = new THREE.Group();
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(w, d, h).translate(0, 0, h / 2),
        new THREE.MeshStandardMaterial({ color: p.paper, roughness: 0.45, metalness: 0.05 }),
      );
      const ribbonMaterial = new THREE.MeshStandardMaterial({ color: p.ribbon, roughness: 0.35, metalness: 0.3 });
      const band = Math.min(w, d) * 0.12;
      const across = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, band, h * 1.01).translate(0, 0, h / 2), ribbonMaterial);
      const along = new THREE.Mesh(new THREE.BoxGeometry(band, d * 1.01, h * 1.01).translate(0, 0, h / 2), ribbonMaterial);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(band * 1.1, band * 0.32, 8, 16).rotateX(Math.PI / 2).translate(0, 0, h + band * 0.3), ribbonMaterial);
      for (const m of [paper, across, along, bow]) m.castShadow = m.receiveShadow = true;
      box.add(paper, across, along, bow);
      box.position.set(p.at[0], p.at[1], 0.003);
      box.rotation.z = p.turn;
      this.tree.add(box);
    }
  }

  /** The whole tree in view, from a little to the side and below the star. */
  private frameTree() {
    const H = this.shape.height;
    const target = new THREE.Vector3(0, 0, H * 0.5);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    // Far enough back for the whole height and the whole width, whichever needs more.
    const distance = Math.max((H * 1.2) / 2 / Math.tan(vertical / 2), (this.shape.radius * 2.8) / 2 / Math.tan(horizontal / 2));
    this.home = { target, position: target.clone().add(new THREE.Vector3(0.35, -1, 0.12).normalize().multiplyScalar(distance)) };
    this.reset();
  }

  reset() {
    this.moved = false;
    this.flight = null;
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.autoRotate = !this.still;
    this.controls.update();
  }

  /**
   * Sets each needle spray at the given length (full grown, or cut back where an ornament or present
   * pushes it aside), and bends down the ones holding an ornament, by its weight.
   */
  private placeSprays(lengths: number[], bent = new Map<number, Vec3>()) {
    const needles = this.needleMesh;
    if (!needles) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const along = new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3();
    this.sprays.forEach((sp, i) => {
      q.setFromUnitVectors(along, v.set(...(bent.get(i) ?? sp.dir)));
      spin.setFromAxisAngle(along, sp.spin);
      q.multiply(spin);
      m.compose(new THREE.Vector3(...sp.at), q, new THREE.Vector3().setScalar(lengths[i]));
      needles.setMatrixAt(i, m);
    });
    needles.instanceMatrix.needsUpdate = true;
    needles.computeBoundingSphere();
  }

  /**
   * The printed book's shape, shared by every book on the tree, and the body it hangs as: `meshes` (mm)
   * give its weight and centre of mass, `attach` (mm) the hole it hangs from.
   */
  setBookShape(
    parts: Map<PartName, PartGeometry>,
    meshes: BookMesh[],
    dims: { height: number; width: number; spine: number },
    attach: Vec3,
    hookTop: number,
  ) {
    this.bookGeometry?.dispose();
    this.bookGeometry = bookGeometry(parts, attach);
    this.bookBody = bookBody(meshes, dims, attach, hookTop);
    this.bookHeight = Math.max(dims.height, hookTop) * MM;
    for (const entry of this.books.values()) entry.mesh.geometry = this.bookGeometry;
    this.hang();
  }

  /** Which books to hang, in order, and the shuffle they hang in. */
  setBooks(ids: string[], seed: number) {
    this.order = ids.slice(0, MAX_BOOKS);
    this.seed = seed;
    const keep = new Set(this.order);
    for (const [id, entry] of this.books) {
      if (keep.has(id)) continue;
      entry.label.map?.dispose();
      entry.label.dispose();
      this.books.delete(id);
    }
    this.hang();
  }

  /** A book's label, drawn by the caller; `key` says whether it changed since the last one. */
  setLabel(id: string, key: string, draw: () => HTMLCanvasElement) {
    const entry = this.books.get(id);
    if (!entry || entry.key === key) return;
    entry.key = key;
    entry.label.map?.dispose();
    const texture = new THREE.CanvasTexture(draw());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    entry.label.map = texture;
    entry.label.color.set(0xffffff);
    entry.label.needsUpdate = true;
  }

  /**
   * Hangs the books and a scattering of baubles, each from a needle spray near the outside of the tree,
   * settled by lib/hanging.ts: pivoting on its hole, weight straight below, resting against the tree
   * where it would pass into it, clear of every other ornament, its spray bent by its weight. Hung for
   * the same books, shuffle and tree as last time, they are only rethreaded and swing to their new balance.
   */
  private hang() {
    if (!this.bookGeometry || !this.bookBody) return;
    const key = `${this.order.join('\n')}|${this.seed}|${this.shape.height}`;
    if (key === this.placedFor && this.hanging.length) {
      this.rethread();
      return;
    }
    this.placedFor = key;
    // Book meshes are kept for the next hanging; the baubles and threads are made afresh.
    for (const o of this.ornaments.children) {
      if (!(o instanceof THREE.InstancedMesh)) continue;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
      o.dispose();
    }
    this.ornaments.clear();
    const s = this.shape;
    const H = s.height;
    const book = this.bookBody;
    const hung = hangAll(s, this.sprays, this.anchors, this.order.map(() => ({ body: book, size: this.bookHeight })), this.seed);
    this.hanging = [];
    const threads: { top: THREE.Vector3; length: number }[] = [];
    const motionOf = (h: Hung): Motion => ({ q: new THREE.Quaternion(...h.pose.rotation), w: new THREE.Vector3() });

    hung.forEach((h, i) => {
      const id = this.order[i];
      let entry = this.books.get(id);
      if (!entry) {
        const label = new THREE.MeshStandardMaterial({ color: PLASTIC, roughness: 0.5 });
        const mesh = new THREE.Mesh(this.bookGeometry!, [label, this.materials.plastic, this.materials.paper]);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.bookId = id;
        entry = { mesh, label, key: '', hung: null };
        this.books.set(id, entry);
      }
      entry.hung = h;
      // The geometry has the hole at its origin, so the pose applies about it directly.
      entry.mesh.position.set(...h.pose.pivot);
      this.ornaments.add(entry.mesh);
      this.hanging.push({ body: book, hung: h, motion: motionOf(h), book: entry });
      threads.push({ top: new THREE.Vector3(...h.at), length: h.at[2] - h.pose.pivot[2] });
    });

    // Glass baubles among the books, in two sizes as sets come, each on a little cap. They are hung even
    // with "No baubles" chosen (just not shown), so choosing a colour never moves the books.
    const big = Math.min(0.07, Math.max(0.035, 0.028 + H * 0.016));
    const sizes = Array.from({ length: Math.round(8 + H * 14) }, (_, i) => (i % 3 === 2 ? big * 0.7 : big));
    const bodies = new Map(sizes.map((d) => [d, baubleBody(d)]));
    const balls = hangAll(
      s,
      this.sprays,
      this.anchors,
      sizes.map((d) => ({ body: bodies.get(d)!, size: d })),
      this.seed + 1000,
      hung,
    );
    this.ballMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.5, 32, 20),
      new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.18 }),
      Math.max(1, balls.length),
    );
    this.capMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.14, 12).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 1, roughness: 0.3 }),
      Math.max(1, balls.length),
    );
    this.ballMesh.count = this.capMesh.count = balls.length;
    const ballThreads: typeof threads = [];
    balls.forEach((b, i) => {
      const d = sizes[i];
      this.hanging.push({ body: bodies.get(d)!, hung: b, motion: motionOf(b), ball: i, size: d });
      ballThreads.push({ top: new THREE.Vector3(...b.at), length: b.at[2] - b.pose.pivot[2] });
    });
    this.ballMesh.castShadow = this.ballMesh.receiveShadow = true;
    this.capMesh.castShadow = true;
    this.ornaments.add(this.ballMesh, this.capMesh);

    // Gold threads, one per ornament, from the spray down to its hole.
    const threadMesh = (list: typeof threads) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 1, 5).rotateX(Math.PI / 2).translate(0, 0, -0.5),
        new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.8, roughness: 0.35 }),
        Math.max(1, list.length),
      );
      mesh.count = list.length;
      const m = new THREE.Matrix4();
      const r = Math.max(0.0004, H * 0.0004);
      list.forEach((t, i) => {
        m.compose(t.top, new THREE.Quaternion(), new THREE.Vector3(r, r, t.length));
        mesh.setMatrixAt(i, m);
      });
      this.ornaments.add(mesh);
      return mesh;
    };
    threadMesh(threads);
    this.ballThreads = threadMesh(ballThreads);
    this.paintBaubles();

    this.syncOrnaments();
    this.clearNeedles();
  }

  /**
   * The book changed shape (a new hook, say): each book stays on its thread, now through the new hole,
   * and swings until its weight is below it again. With reduced motion, it goes straight there.
   */
  private rethread() {
    const book = this.bookBody!;
    for (const o of this.hanging) {
      if (!o.book) continue;
      o.body = book;
      if (this.still) {
        o.motion.q.set(...settle(book, o.hung.pose.pivot, o.hung.turn, this.shape).rotation);
        o.motion.w.set(0, 0, 0);
      }
    }
    this.swinging = !this.still;
    this.syncOrnaments();
    if (this.still) this.clearNeedles();
  }

  /** Moves each ornament's mesh to where its motion has it. */
  private syncOrnaments() {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    for (const o of this.hanging) {
      if (o.book) o.book.mesh.quaternion.copy(o.motion.q);
      else if (o.ball !== undefined && this.ballMesh && this.capMesh) {
        const d = o.size ?? 0.04;
        const scale = one.clone().setScalar(d);
        const pivot = new THREE.Vector3(...o.hung.pose.pivot);
        const centre = new THREE.Vector3(...o.body.pivot).negate().applyQuaternion(o.motion.q).add(pivot);
        m.compose(centre, o.motion.q, scale);
        this.ballMesh.setMatrixAt(o.ball, m);
        const cap = new THREE.Vector3(0, 0, d * 0.5).applyQuaternion(o.motion.q).add(centre);
        m.compose(cap, o.motion.q, scale);
        this.capMesh.setMatrixAt(o.ball, m);
      }
    }
    if (this.ballMesh) this.ballMesh.instanceMatrix.needsUpdate = true;
    if (this.capMesh) this.capMesh.instanceMatrix.needsUpdate = true;
  }

  /** The ornaments on show: every book, and the baubles unless "No baubles" is chosen. */
  private shown() {
    return this.baubleStyle === 'none' ? this.hanging.filter((o) => o.book) : this.hanging;
  }

  /** Colours the baubles from the chosen set, or hides them; the books stay where they are. */
  setBaubles(style: BaubleStyle) {
    const was = this.baubleStyle;
    this.baubleStyle = style;
    this.paintBaubles();
    if ((was === 'none') !== (style === 'none')) this.clearNeedles();
  }

  private paintBaubles() {
    const colours = BAUBLE_STYLES[this.baubleStyle].colours.map((c) => new THREE.Color(c));
    const visible = colours.length > 0;
    for (const mesh of [this.ballMesh, this.capMesh, this.ballThreads]) if (mesh) mesh.visible = visible;
    if (!this.ballMesh || !visible) return;
    for (const o of this.hanging) if (o.ball !== undefined) this.ballMesh.setColorAt(o.ball, colours[o.ball % colours.length]);
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
  }

  /** Pushes needles aside round every ornament where it hangs now, and round the presents. */
  private clearNeedles() {
    const obstacles: Obstacle[] = [
      ...this.shown().map((o) => ({ spray: o.hung.spray, pose: poseOf(o.body, o.hung.pose.pivot, o.motion.q) })),
      ...this.presents.map(presentObstacle),
    ];
    const bent = new Map(this.shown().map((o) => [o.hung.spray, bentDirection(this.sprays[o.hung.spray], o.hung.dip)]));
    this.placeSprays(clearSprays(this.sprays, obstacles), bent);
  }

  /**
   * Steps every ornament's swing (lib/hanging.ts step), while any is moving or the tree is being turned.
   * Turning the tree is the camera orbiting it the other way; the branches' acceleration as it turns
   * (a sideways push when it starts or stops, outwards while it spins) is applied to each ornament.
   */
  private simulate(dt: number) {
    if (!dt) return;
    const c = this.camera.position;
    const t = this.controls.target;
    const angle = Math.atan2(c.y - t.y, c.x - t.x);
    let rate = 0;
    if (!Number.isNaN(this.spin.last)) {
      let d = angle - this.spin.last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      rate = -d / dt;
    }
    this.spin.last = angle;
    const smoothed = this.spin.rate + (rate - this.spin.rate) * Math.min(1, dt * 10);
    this.spin.accel = (smoothed - this.spin.rate) / dt;
    this.spin.rate = smoothed;
    // The slow automatic turn is too gentle to count; a drag is not.
    const turning = Math.abs(this.spin.rate) > 0.15 || Math.abs(this.spin.accel) > 0.5;
    if (this.still || (!this.swinging && !turning)) return;

    const steps = Math.min(16, Math.ceil(dt / 0.004));
    const h = dt / steps;
    const { rate: W, accel: A } = this.spin;
    const support = new THREE.Vector3();
    for (const o of this.shown()) {
      const [x, y] = o.hung.pose.pivot;
      // The branch's acceleration where the ornament hangs: round the trunk, and in towards it.
      support.set(-A * y - W * W * x, A * x - W * W * y, 0);
      if (support.length() > 2.5) support.setLength(2.5);
      for (let k = 0; k < steps; k++) step(o.body, o.hung.pose.pivot, o.motion, h, this.shape, turning ? support : undefined);
    }
    this.syncOrnaments();
    const still = !turning && this.shown().every((o) => atRest(o.motion));
    if (still) this.clearNeedles();
    this.swinging = !still;
  }

  /** Double-click a book to fly in close to it; anywhere else goes back to the whole tree. */
  private focusAt(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const meshes = [...this.books.values()].map((e) => e.mesh).filter((mesh) => mesh.parent);
    const hit = ray.intersectObjects(meshes, false)[0];
    this.controls.autoRotate = false;
    this.moved = true;
    if (!hit) {
      this.flyTo(this.home.position, this.home.target);
      return;
    }
    const box = new THREE.Box3().setFromObject(hit.object);
    const centre = box.getCenter(new THREE.Vector3());
    const out = new THREE.Vector3(centre.x, centre.y, 0).normalize();
    const distance = this.bookHeight * 4.5;
    this.flyTo(centre.clone().add(out.multiplyScalar(distance)).add(new THREE.Vector3(0, 0, this.bookHeight * 0.6)), centre);
  }

  private flyTo(position: THREE.Vector3, target: THREE.Vector3) {
    this.flight = {
      from: this.camera.position.clone(),
      to: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      t: 0,
    };
  }

  private disposeGroup(group: THREE.Group) {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        for (const mat of [o.material].flat()) if (mat !== this.materials.plastic && mat !== this.materials.paper) mat.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
    group.clear();
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.visibility.disconnect();
    this.controls.dispose();
    this.disposeGroup(this.tree);
    // Book meshes share one geometry, disposed once below; the rest of the ornaments are their own.
    for (const o of this.ornaments.children) if (o instanceof THREE.InstancedMesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
      o.dispose();
    }
    for (const e of this.books.values()) {
      e.label.map?.dispose();
      e.label.dispose();
    }
    this.bookGeometry?.dispose();
    this.needles.dispose();
    this.materials.plastic.dispose();
    this.materials.paper.dispose();
    this.scene.environment?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Fewer pixels per label than the 3D book: there are many, each small on screen until zoomed to. */
const TREE_PX_PER_MM = 7;

export default function Tree3D({ books, coverOf, customCovers, settings }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TreeScene | null>(null);
  const [state, setState] = useState<'building' | 'ready' | 'failed'>('building');
  const [size, setSize] = useState<SizeChoice>(storedSize);
  const [customHeight, setCustomHeight] = useState(storedCustomHeight);
  const [unit, setUnit] = useState<HeightUnit>(storedUnit);
  // What is in the height box as typed; the tree follows once it is a number and typing has paused.
  const [draft, setDraft] = useState(() => formatHeight(storedCustomHeight(), storedUnit()));
  const treeHeight = size === 'custom' ? customHeight : TREE_SIZES[size].height;
  const [lights, setLights] = useState<LightStyle>(storedLights);
  const [baubles, setBaubles] = useState<BaubleStyle>(storedBaubles);
  const [seed, setSeed] = useState(1);
  const { height, width, spine, style, model } = settings;

  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new TreeScene(host.current);
    } catch {
      setState('failed');
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setTree(treeHeight, lights);
    store('treeSize', size);
    store('treeHeight', String(customHeight));
    store('treeLights', lights);
  }, [treeHeight, size, customHeight, lights]);

  // Rebuilding the tree takes a moment, so a typed height is applied once typing pauses.
  useEffect(() => {
    const metres = parseHeight(draft, unit);
    if (metres === null) return;
    const timer = setTimeout(() => setCustomHeight(metres), 400);
    return () => clearTimeout(timer);
  }, [draft, unit]);

  useEffect(() => {
    scene.current?.setBaubles(baubles);
    store('treeBaubles', baubles);
  }, [baubles]);

  // The printed book's shape: the same model as the 3D book, so the hook and spine look as they will.
  useEffect(() => {
    let current = true;
    const dims = { height, width, spine };
    buildBookParts(dims, model)
      .then((parts) => {
        if (!current || !scene.current) return;
        const geometry = new Map([...parts].map(([name, mesh]) => [name, partGeometry(name, mesh, dims)]));
        // Hung by the hole in its hook, the thread resting on the top of the hole; with no hook, by a
        // thread fixed to the middle of its top.
        let attach: Vec3 = [width / 2, spine / 2, height];
        let hookTop = height;
        if (model.hook) {
          const h = hookGeometry(dims, model.hookPosition, 0, model.holeSize);
          attach = [h.x, model.hookSide === 'back' ? spine - h.thickness / 2 : h.thickness / 2, h.z + h.hole * 0.9];
          hookTop = h.z + h.r;
        }
        scene.current.setBookShape(geometry, [...parts.values()], dims, attach, hookTop);
        setState('ready');
      })
      .catch(() => current && setState('failed'));
    return () => {
      current = false;
    };
  }, [height, width, spine, model]);

  const ids = books.map((b) => b.id).join('\n');
  useEffect(() => {
    scene.current?.setBooks(ids ? ids.split('\n') : [], seed);
  }, [ids, seed]);

  // Each label, redrawn only when what it shows has changed (a cover arriving, a crop, the size).
  useEffect(() => {
    if (!scene.current) return;
    const dims = { height, width, spine };
    const pxPerMm = Math.min(TREE_PX_PER_MM, 1024 / (2 * width + spine));
    for (const book of books.slice(0, MAX_BOOKS)) {
      const cover = coverOf(book);
      const custom = customCovers[book.id];
      const wrap = cover?.source === 'wrap' ? (custom?.spine ?? cover.detectedSpine ?? defaultWrapSpine(settings)) : undefined;
      const crop = custom?.crop ?? cover?.detectedCrop ?? undefined;
      const key = JSON.stringify([book.title, book.authors, cover?.source ?? 'loading', cover?.image?.src ?? '', wrap, crop, style, dims]);
      scene.current.setLabel(book.id, key, () => {
        const canvas = document.createElement('canvas');
        drawLabel(canvas, book, cover?.image ?? null, dims, style, { wrapSpine: wrap, crop, pxPerMm });
        return canvas;
      });
    }
  });

  const shown = Math.min(books.length, MAX_BOOKS);
  return (
    <div className="book3d tree3d">
      <div className="book3d-canvas" ref={host} />
      <div className="book3d-bar tree-bar">
        <span className="tree-options">
          <select aria-label="Tree size" value={size} onChange={(e) => setSize(e.target.value as SizeChoice)}>
            {Object.entries(TREE_SIZES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="custom">Custom height</option>
          </select>
          {size === 'custom' && (
            <span className="tree-height">
              <input
                type="number"
                inputMode="decimal"
                aria-label="Tree height"
                min={unit === 'ft' ? 1 : 30}
                max={unit === 'ft' ? 12 : 366}
                step={unit === 'ft' ? 0.5 : 1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // Applied straight away on leaving the box; out of range or not a number, it shows what
                // the tree is actually set to.
                onBlur={() => {
                  const metres = parseHeight(draft, unit) ?? customHeight;
                  setCustomHeight(metres);
                  setDraft(formatHeight(metres, unit));
                }}
              />
              <select
                aria-label="Height unit"
                value={unit}
                onChange={(e) => {
                  const next = e.target.value as HeightUnit;
                  // What was typed counts, even if the tree has not caught up with it yet.
                  const metres = parseHeight(draft, unit) ?? customHeight;
                  setCustomHeight(metres);
                  setUnit(next);
                  setDraft(formatHeight(metres, next));
                  store('treeUnit', next);
                }}
              >
                <option value="ft">ft</option>
                <option value="cm">cm</option>
              </select>
            </span>
          )}
          <select aria-label="Lights" value={lights} onChange={(e) => setLights(e.target.value as LightStyle)}>
            <option value="warm">Warm white lights</option>
            <option value="colour">Coloured lights</option>
          </select>
          <select aria-label="Baubles" value={baubles} onChange={(e) => setBaubles(e.target.value as BaubleStyle)}>
            {Object.entries(BAUBLE_STYLES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button onClick={() => setSeed((s) => s + 1)} disabled={!shown}>
            Shuffle
          </button>
          {state === 'ready' && <button onClick={() => scene.current?.reset()}>Reset view</button>}
        </span>
        <span className="muted">
          {state === 'failed'
            ? 'This browser cannot show the 3D view.'
            : state === 'building'
              ? 'Building the tree...'
              : shown === 0
                ? 'Add books to hang them on the tree.'
                : `${shown} ${shown === 1 ? 'book' : 'books'}${books.length > MAX_BOOKS ? ` (of ${books.length})` : ''}. Drag to turn, pinch or scroll to zoom, double-click a book to look closer.`}
        </span>
      </div>
    </div>
  );
}
