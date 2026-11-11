import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildBookParts, type PartName } from '../lib/bookModel';
import { partGeometry } from '../lib/bookUv';
import type { CoverResult } from '../lib/covers';
import { defaultWrapSpine } from '../lib/layout';
import { drawLabel } from '../lib/render';
import type { Book, CustomCover, Settings } from '../lib/types';

interface Props {
  /** The book whose label is wrapped on; a blank cover without one. */
  book: Book | undefined;
  cover: CoverResult | undefined;
  custom: CustomCover | undefined;
  settings: Settings;
  /** Show the book as printed, all in this filament colour and with no label: the blank as it arrives. */
  filament?: string;
}

/** Most pixels across the label texture; GPUs take 2048 everywhere. */
const MAX_TEXTURE = 2048;
/** Plastic colour for the cover edges, spine ends and hook. */
const PLASTIC = '#d8d2c8';
const PAPER = '#f4ecdc';

/** Owns the three.js scene, so React only tells it what changed. */
class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
  readonly controls: OrbitControls;
  private readonly group = new THREE.Group();
  private readonly observer: ResizeObserver;
  private readonly materials = {
    label: new THREE.MeshStandardMaterial({ color: PLASTIC, roughness: 0.55 }),
    // Pushed back a touch so the label wins wherever a part's face lies flush with a labelled face.
    plastic: new THREE.MeshStandardMaterial({
      color: PLASTIC,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    paper: new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9 }),
  };
  private framed = false;
  private home = { position: new THREE.Vector3(), target: new THREE.Vector3() };

  constructor(private readonly host: HTMLElement) {
    // The canvas joins the page before its WebGL context is made: WebKit can leave a canvas whose context
    // was made while detached without a compositing layer, drawing frames that never appear.
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // The book is modelled z-up, as for printing.
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1, -2, 2.5);
    this.scene.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.render());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private frame_: number | null = null;

  /**
   * Draws on the next animation frame. Several changes in one frame (a resize, a new model, a new label)
   * become one draw, and frames drawn outside an animation frame are not always shown by WebKit.
   */
  render() {
    if (this.frame_ !== null) return;
    this.frame_ = requestAnimationFrame(() => {
      this.frame_ = null;
      this.renderer.render(this.scene, this.camera);
    });
  }

  setParts(parts: Map<PartName, ReturnType<typeof partGeometry>>) {
    for (const child of [...this.group.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.group.remove(child);
    }
    for (const [name, g] of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
      const total = g.positions.length / 3;
      geometry.addGroup(0, g.labelCount * 3, 0);
      geometry.addGroup(g.labelCount * 3, total - g.labelCount * 3, 1);
      const rest = name === 'pages' ? this.materials.paper : this.materials.plastic;
      this.group.add(new THREE.Mesh(geometry, [this.materials.label, rest]));
    }
    if (!this.framed) {
      this.frame();
      this.framed = true;
    }
    this.render();
  }

  /** Looks at the front cover and spine from slightly above, with the whole book in view. */
  frame() {
    const box = new THREE.Box3().setFromObject(this.group);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    // Fit the book's bounding sphere to the tighter of the view's height and width, so it fills a tall
    // phone screen, a short landscape one and a desktop pane alike.
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.02;
    this.home = {
      target: centre,
      position: centre.clone().add(new THREE.Vector3(-0.55, -1, 0.4).normalize().multiplyScalar(distance)),
    };
    this.reset();
  }

  reset() {
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.update();
    this.render();
  }

  /** Every surface in one filament colour, or back to the usual plastic and paper. */
  setFilament(colour: string | null) {
    this.materials.label.map?.dispose();
    this.materials.label.map = null;
    this.materials.label.color.set(colour ?? PLASTIC);
    this.materials.plastic.color.set(colour ?? PLASTIC);
    this.materials.paper.color.set(colour ?? PAPER);
    this.materials.label.needsUpdate = true;
    this.render();
  }

  setLabel(canvas: HTMLCanvasElement | null) {
    this.materials.label.map?.dispose();
    if (canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.materials.label.map = texture;
      this.materials.label.color.set(0xffffff);
    } else {
      this.materials.label.map = null;
      this.materials.label.color.set(PLASTIC);
    }
    this.materials.label.needsUpdate = true;
    this.render();
  }

  dispose() {
    if (this.frame_ !== null) cancelAnimationFrame(this.frame_);
    this.observer.disconnect();
    this.controls.dispose();
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    this.materials.label.map?.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** The printable book with the label wrapped on, to turn around and look at before printing. */
export default function Book3D({ book, cover, custom, settings, filament }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [state, setState] = useState<'building' | 'ready' | 'failed'>('building');
  const { height, width, spine, style, model } = settings;

  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new Viewer(host.current);
    } catch {
      // No WebGL.
      setState('failed');
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  // Rebuilt when the size or model options change; the newest request wins.
  useEffect(() => {
    let current = true;
    const dims = { height, width, spine };
    buildBookParts(dims, model)
      .then((parts) => {
        if (!current || !viewer.current) return;
        viewer.current.setParts(new Map([...parts].map(([name, mesh]) => [name, partGeometry(name, mesh, dims)])));
        setState('ready');
      })
      .catch(() => current && setState('failed'));
    return () => {
      current = false;
    };
  }, [height, width, spine, model]);

  const wrap = cover?.source === 'wrap' ? (custom?.spine ?? cover.detectedSpine ?? defaultWrapSpine(settings)) : undefined;
  const crop = custom?.crop ?? cover?.detectedCrop;
  const wrapKey = wrap ? `${wrap.left},${wrap.right}` : '';
  const cropKey = crop ? JSON.stringify(crop) : '';

  useEffect(() => {
    if (!viewer.current) return;
    if (filament) {
      viewer.current.setFilament(filament);
      return;
    }
    viewer.current.setFilament(null);
    if (!book || !cover) {
      viewer.current.setLabel(null);
      return;
    }
    const canvas = document.createElement('canvas');
    const pxPerMm = Math.min(24, MAX_TEXTURE / (2 * width + spine));
    const [left, right] = wrapKey ? wrapKey.split(',').map(Number) : [];
    drawLabel(canvas, book, cover.image, { height, width, spine }, style, {
      wrapSpine: wrapKey ? { left, right } : undefined,
      crop: cropKey ? JSON.parse(cropKey) : undefined,
      pxPerMm,
    });
    viewer.current.setLabel(canvas);
  }, [book, cover, height, width, spine, style, wrapKey, cropKey, filament]);

  return (
    <div className="book3d">
      <div className="book3d-canvas" ref={host} />
      <div className="book3d-bar">
        <span className="muted">
          {state === 'failed'
            ? 'This browser cannot show the 3D view.'
            : state === 'building'
              ? 'Building the model...'
              : book
                ? `${book.title}. Drag to turn, scroll or pinch to zoom.`
                : 'Drag to turn, scroll or pinch to zoom.'}
        </span>
        {state === 'ready' && <button onClick={() => viewer.current?.reset()}>Reset view</button>}
      </div>
    </div>
  );
}
