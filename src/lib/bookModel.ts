/**
 * A hardcover mini book to wrap a label around, built in the browser so the STL matches whatever size
 * the label is set to. The covers are height x width and the spine is spine thick, so a label of
 * height x (2 x width + spine) wraps it exactly.
 *
 * It prints lying on one cover with no supports: the page lines follow the print layers, the upper
 * cover's overhang has a 45 degree bevel under it, and the hook sits flush with the cover on the bed.
 * That is the front cover unless the hook is set to the back.
 */
import type { Dims } from './scales';
import type { HookPosition, HookSide, ModelOptions } from './types';

export type { HookPosition, HookSide, ModelOptions };

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  hook: false,
  hookPosition: 'center',
  hookSide: 'front',
  roundSpine: false,
};

/** With the hook on the back cover, the book is the mirror image and prints lying on its back. */
const backHook = (options: ModelOptions) => options.hook && options.hookSide === 'back';

// Real hardcover boards are about 3 mm thick and overhang the pages by about 3 mm; both are kept
// printable at small scales. Page line pitch is a multiple of a 0.2 mm layer.
const REAL_HEIGHT = 210;
const REAL_BOARD = 3;
const REAL_OVERHANG = 3;
const MIN_BOARD = 0.6;
const MIN_OVERHANG = 0.4;
const SPINE_ROUND = 0.3;
const PAGE_LINE_PITCH = 0.6;
const PAGE_LINE_WIDTH = 0.2;
const PAGE_LINE_DEPTH = 0.25;
const HOOK_HOLE = 1.6;
const HOOK_WALL = 0.8;
const HOOK_THICKNESS = 1.2;
const EPS = 0.01;
/** How far the bevel stops short of the cover's edges; unlike EPS, so it never lines up with a corner hook. */
const BEVEL_INSET = 0.02;
/** In mm: points closer than this are merged before export. */
const WELD_TOLERANCE = 0.001;
const SEGMENTS = 64;

/** Every measurement the model is built from, in mm. Exported so it can be checked without WebAssembly. */
export function modelGeometry({ height: H, width: W, spine: S }: Dims) {
  const ratio = REAL_HEIGHT / H;
  const board = Math.min(Math.max(MIN_BOARD, REAL_BOARD / ratio), S / 4);
  const overhang = Math.min(Math.max(MIN_OVERHANG, REAL_OVERHANG / ratio), W / 6, H / 8);
  const pages = { x0: board, x1: W - overhang, y0: board, y1: S - board, z0: overhang, z1: H - overhang };
  const bevel = Math.min(overhang, (pages.y1 - pages.y0) / 2);
  // Page lines stop short of the covers and the bevel so neither edge is weakened.
  const lines: number[] = [];
  for (let y = pages.y0 + PAGE_LINE_PITCH; y <= pages.y1 - bevel - PAGE_LINE_PITCH / 2 + 1e-9; y += PAGE_LINE_PITCH) {
    lines.push(y);
  }
  return { H, W, S, board, overhang, pages, bevel, lines };
}

/** Arc segments across the rounded spine: smooth at any scale without bloating the file. */
const SPINE_SEGMENTS = 32;

/**
 * The rounded spine's outline seen from above, counter-clockwise: the inner edge, then an arc that bows
 * SPINE_ROUND past the covers. Built from exact points, because clipping a circle to a rectangle leaves
 * slivers at the corners. The arc ends a hair inside the covers' outer corners rather than on them, so
 * the solids overlap instead of meeting at a point, which also gives doubled edges in an STL.
 */
export function roundSpineProfile(S: number, board: number): [number, number][] {
  const r = ((S / 2) ** 2 + SPINE_ROUND ** 2) / (2 * SPINE_ROUND);
  // The arc's chord runs at x = EPS, its middle bowing out to x = EPS - SPINE_ROUND.
  const cx = EPS + r - SPINE_ROUND;
  // Half the angle the arc spans, seen from the circle's centre.
  const half = Math.atan2(S / 2, cx - EPS);
  const arc: [number, number][] = [];
  // From the (EPS, S) end round to (EPS, 0), ends excluded: they are added exactly below.
  for (let i = 1; i < SPINE_SEGMENTS; i++) {
    const a = Math.PI - half + (2 * half * i) / SPINE_SEGMENTS;
    arc.push([cx + r * Math.cos(a), S / 2 + r * Math.sin(a)]);
  }
  return [[EPS, 0], [board, 0], [board, S], [EPS, S], ...arc];
}

export function hookGeometry({ height: H, width: W, spine: S }: Dims, position: HookPosition, overhang: number) {
  const r = HOOK_HOLE / 2 + HOOK_WALL;
  // Corner hooks sit a hair in from the book's side rather than exactly flush, for a clean mesh.
  const x = position === 'spine' ? r + EPS : position === 'fore-edge' ? W - r - EPS : W / 2;
  // The hole clears the top of the covers by a little under a wall's thickness.
  const z = H + HOOK_HOLE / 2 + HOOK_WALL * 0.75;
  return { r, x, z, hole: HOOK_HOLE / 2, thickness: Math.min(HOOK_THICKNESS, S), neckBottom: H - overhang - 0.5 };
}

export type Wasm = Awaited<ReturnType<typeof import('manifold-3d').default>>;
let wasm: Promise<Wasm> | null = null;

/** Loads the geometry library (about 0.5 MB of WebAssembly) on first use only. */
function loadManifold(): Promise<Wasm> {
  wasm ??= (async () => {
    const [{ default: Module }, { default: wasmUrl }] = await Promise.all([
      import('manifold-3d'),
      import('manifold-3d/manifold.wasm?url'),
    ]);
    const m = await Module({ locateFile: () => wasmUrl });
    m.setup();
    return m;
  })();
  wasm.catch(() => (wasm = null));
  return wasm;
}

export interface BookMesh {
  /** x, y, z per vertex, in mm. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  triangles: Uint32Array;
}

/** The book's parts, separately, for the 3D preview: it textures the label onto the covers and spine only. */
export type PartName = 'front' | 'back' | 'spine' | 'pages' | 'hook';

/**
 * Builds each part of the book standing up: x across the cover from the spine, y through the book from
 * the front cover, z up. With the label wrapped image out and the spine on the left of the front cover,
 * the front is the y = 0 side.
 */
async function buildParts(dims: Dims, options: ModelOptions, load: () => Promise<Wasm>) {
  const { Manifold, CrossSection } = await load();
  const { H, W, S, board, overhang, pages: p, bevel, lines } = modelGeometry(dims);
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
    Manifold.cube([sx, sy, sz]).translate([x, y, z]);
  const parts = new Map<PartName, InstanceType<typeof Manifold>>();

  parts.set('front', box(0, 0, 0, W, board, H));
  parts.set('back', box(0, S - board, 0, W, board, H));

  if (options.roundSpine) {
    parts.set('spine', new CrossSection([roundSpineProfile(S, board)]).extrude(H));
  } else {
    parts.set('spine', box(0, 0, 0, board, S, H));
  }

  // The page block reaches a hair into the covers and spine rather than just touching them.
  let block = box(p.x0 - EPS, p.y0 - EPS, p.z0, p.x1 - p.x0 + EPS, p.y1 - p.y0 + 2 * EPS, p.z1 - p.z0);
  if (lines.length) {
    // Each line is a U-shaped slot around the top, fore-edge and bottom of the page block.
    const slot = box(p.x0 - 1, 0, p.z0 - 1, p.x1 - p.x0 + 2, PAGE_LINE_WIDTH, p.z1 - p.z0 + 2).subtract(
      box(
        p.x0 - 2,
        -1,
        p.z0 + PAGE_LINE_DEPTH,
        p.x1 - PAGE_LINE_DEPTH - p.x0 + 2,
        PAGE_LINE_WIDTH + 2,
        p.z1 - p.z0 - 2 * PAGE_LINE_DEPTH,
      ),
    );
    block = block.subtract(Manifold.union(lines.map((y) => slot.translate([0, y - PAGE_LINE_WIDTH / 2, 0]))));
  }
  if (bevel > 0) {
    // 45 degrees under the back cover's overhang (the top, when printing), so it needs no supports.
    // It reaches a hair into the spine and the cover and stops a hair short of the cover's edges: solids
    // that only touch along shared edges and faces give doubled edges in the exported mesh.
    block = block.add(
      Manifold.hull([
        box(p.x0 - EPS, p.y1 - bevel, p.z0, p.x1 - p.x0 + EPS, EPS, p.z1 - p.z0),
        box(p.x0 - EPS, p.y1 - EPS, BEVEL_INSET, W - BEVEL_INSET - p.x0 + EPS, 2 * EPS, H - 2 * BEVEL_INSET),
      ]),
    );
  }
  parts.set('pages', block);

  if (options.hook) {
    // Flush with the front cover, the side the book prints on, so it needs no supports. A back hook is
    // built the same way and mirrored below.
    const h = hookGeometry(dims, options.hookPosition, overhang);
    const ring = CrossSection.hull([
      CrossSection.circle(h.r, SEGMENTS).translate([h.x, h.z]),
      CrossSection.square([2 * h.r, EPS]).translate([h.x - h.r, h.neckBottom]),
    ]).subtract(CrossSection.circle(h.hole, SEGMENTS).translate([h.x, h.z]));
    parts.set('hook', ring.extrude(h.thickness).rotate([90, 0, 0]).translate([0, h.thickness, 0]));
  }

  if (backHook(options)) {
    // Mirror front to back: the hook ends up flush with the back cover and the bevel under the front,
    // which is the side facing up when it prints on its back. The covers swap names with their sides,
    // so the front is still the y = 0 side.
    const mirrored = new Map<PartName, InstanceType<typeof Manifold>>();
    const rename: Partial<Record<PartName, PartName>> = { front: 'back', back: 'front' };
    for (const [name, m] of parts) mirrored.set(rename[name] ?? name, m.mirror([0, 1, 0]).translate([0, S, 0]));
    return { Manifold, parts: mirrored, S };
  }
  return { Manifold, parts, S };
}

function toMesh(m: { getMesh(): { numVert: number; numProp: number; vertProperties: Float32Array; triVerts: Uint32Array } }): BookMesh {
  const mesh = m.getMesh();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let v = 0; v < mesh.numVert; v++) {
    for (let c = 0; c < 3; c++) positions[v * 3 + c] = mesh.vertProperties[v * mesh.numProp + c];
  }
  return { positions, triangles: new Uint32Array(mesh.triVerts) };
}

/**
 * The whole book as one solid, for the STL. `layFlat` lays it on the cover the hook is flush with (the
 * front without a hook), ready to print with no supports.
 */
export async function buildBookMesh(
  dims: Dims,
  options: ModelOptions,
  layFlat: boolean,
  /** Tests pass a loader that works under Node, where Vite's wasm URL does not. */
  load: () => Promise<Wasm> = loadManifold,
): Promise<BookMesh> {
  const { Manifold, parts, S } = await buildParts(dims, options, load);
  // Parts that meet flush (a corner hook on the book's side, the rounded spine at the covers) can leave
  // vertices a hair apart, which merge once saved at STL's single precision and give doubled edges.
  // Simplifying to a micron, far below anything a printer resolves, merges them in the solid first.
  let book = Manifold.union([...parts.values()]).simplify(WELD_TOLERANCE);
  if (layFlat) {
    // Rotating about x takes the thickness axis up: +90 puts the front cover (y = 0) on the bed, -90
    // turns it over onto the back cover (y = S), lifted back to the bed.
    book = backHook(options) ? book.rotate([-90, 0, 0]).translate([0, 0, S]) : book.rotate([90, 0, 0]);
  }
  return toMesh(book);
}

/** Each part separately, standing up, for the 3D preview. */
export async function buildBookParts(
  dims: Dims,
  options: ModelOptions,
  load: () => Promise<Wasm> = loadManifold,
): Promise<Map<PartName, BookMesh>> {
  const { parts } = await buildParts(dims, options, load);
  return new Map([...parts].map(([name, m]) => [name, toMesh(m)]));
}

/** Binary STL, the format every slicer reads. */
export function meshToStl({ positions, triangles }: BookMesh, name = 'mini book'): ArrayBuffer {
  const count = triangles.length / 3;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50;
    const v = [0, 1, 2].map((k) => triangles[t * 3 + k] * 3);
    const p = (i: number, c: number) => positions[v[i] + c];
    // Facet normal from the winding; slicers recompute it, but some viewers use it.
    const a = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)];
    const b = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)];
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let c = 0; c < 3; c++) view.setFloat32(at + c * 4, n[c] / len, true);
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) view.setFloat32(at + 12 + i * 12 + c * 4, p(i, c), true);
    // Attribute byte count, unused.
    view.setUint16(at + 48, 0, true);
  }
  return buffer;
}

export function stlFileName({ height, width, spine }: Dims, options: ModelOptions): string {
  const spineShape = options.roundSpine ? '-round-spine' : '-flat-spine';
  const where = options.hookPosition === 'center' ? 'center' : `${options.hookPosition}-corner`;
  const hook = options.hook ? `-hook-${where}${options.hookSide === 'back' ? '-back' : ''}` : '';
  return `mini-book-${height}x${width}x${spine}mm${spineShape}${hook}.stl`;
}
