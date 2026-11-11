import Module from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import {
  buildBookMesh,
  buildBookParts,
  DEFAULT_MODEL_OPTIONS,
  meshToStl,
  modelGeometry,
  modelFileName,
  type BookMesh,
  type Wasm,
} from './bookModel';
import { dimsAtScale } from './scales';

// Under Node the wasm sits next to the script, so the default lookup finds it.
const nodeLoader = async (): Promise<Wasm> => {
  const m = await Module();
  m.setup();
  return m;
};

function bounds({ positions }: BookMesh) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], positions[i]);
  }
  return hi.map((h, c) => +(h - lo[c]).toFixed(2));
}

describe('modelGeometry', () => {
  it('uses printable minimums at 1:7 and true scale at 1:4', () => {
    expect(modelGeometry(dimsAtScale(7))).toMatchObject({ board: 0.6, H: 30, W: 20, S: 5 });
    expect(modelGeometry(dimsAtScale(4)).board).toBeCloseTo(0.75);
  });

  it('drops page lines when the book is too thin for them', () => {
    expect(modelGeometry(dimsAtScale(7)).lines.length).toBeGreaterThan(3);
    expect(modelGeometry(dimsAtScale(24)).lines).toHaveLength(0);
  });
});

describe('buildBookMesh', () => {
  it('matches the label size standing up, and lies on its back for printing', async () => {
    const dims = dimsAtScale(7);
    const options = { hook: false, hookPosition: 'center', hookSide: 'front', roundSpine: false } as const;
    expect(bounds(await buildBookMesh(dims, options, false, nodeLoader))).toEqual([20, 5, 30]);
    expect(bounds(await buildBookMesh(dims, options, true, nodeLoader))).toEqual([20, 30, 5]);
  });

  it('adds the hook above the top, and builds every preset with every hook position', async () => {
    for (const ratio of [4, 5, 6, 7, 10, 12, 24]) {
      for (const hookPosition of ['center', 'spine', 'fore-edge'] as const) {
        const dims = dimsAtScale(ratio);
        const mesh = await buildBookMesh(dims, { hook: true, hookPosition, hookSide: 'front', roundSpine: true }, false, nodeLoader);
        const [w, , h] = bounds(mesh);
        // Ring top: hole radius 0.8, clearance 0.6, ring radius 1.6.
        expect(h).toBeCloseTo(dims.height + 3, 1);
        // The round spine bows 0.3 mm past the covers.
        expect(w).toBeCloseTo(dims.width + 0.3, 1);
        expect(mesh.triangles.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Edges of a closed, outward-facing solid as an STL stores it (single precision, no shared vertices):
 * every edge must appear exactly once in each direction. Returns how many do not.
 */
function badEdges({ positions, triangles }: BookMesh): number {
  const key = (v: number) => `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
  const directed = new Map<string, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const edge = `${key(triangles[t + k])}>${key(triangles[t + ((k + 1) % 3)])}`;
      directed.set(edge, (directed.get(edge) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [edge, count] of directed) {
    const [a, b] = edge.split('>');
    if (count !== 1 || directed.get(`${b}>${a}`) !== 1) bad++;
  }
  return bad;
}

describe('the printable mesh', () => {
  // Presets plus the awkward ones: very thin books, where covers and spine are at their limits.
  const sizes = [...[4, 7, 12, 24].map(dimsAtScale), { height: 12.3, width: 9.1, spine: 2.2 }, { height: 20, width: 15, spine: 1.2 }];

  it('is a clean closed solid for every size, spine and hook placement', async () => {
    for (const dims of sizes) {
      for (const roundSpine of [false, true]) {
        for (const hookSide of ['front', 'back'] as const) {
          for (const hookPosition of ['center', 'spine', 'fore-edge'] as const) {
            const options = { hook: true, hookPosition, hookSide, roundSpine };
            const mesh = await buildBookMesh(dims, options, true, nodeLoader);
            expect(badEdges(mesh), `${JSON.stringify(dims)} ${JSON.stringify(options)}`).toBe(0);
          }
        }
        const plain = await buildBookMesh(dims, { ...DEFAULT_MODEL_OPTIONS, roundSpine }, true, nodeLoader);
        expect(badEdges(plain)).toBe(0);
      }
    }
  }, 60_000);
});

describe('a hook on the back cover', () => {
  const dims = dimsAtScale(7);
  const yRange = ({ positions }: BookMesh, axis: number) => {
    const vals = Array.from(positions).filter((_, i) => i % 3 === axis);
    return [Math.min(...vals), Math.max(...vals)].map((v) => +v.toFixed(2));
  };

  it('sits flush with the back cover, and the front cover stays on the y = 0 side', async () => {
    const parts = await buildBookParts(dims, { hook: true, hookPosition: 'center', hookSide: 'back', roundSpine: false }, nodeLoader);
    expect(yRange(parts.get('hook')!, 1)).toEqual([3.8, 5]);
    expect(yRange(parts.get('front')!, 1)).toEqual([0, 0.6]);
    expect(yRange(parts.get('back')!, 1)).toEqual([4.4, 5]);
  });

  it('prints lying on the back cover, with the hook on the bed', async () => {
    const options = { hook: true, hookPosition: 'center', hookSide: 'back', roundSpine: false } as const;
    const flat = await buildBookMesh(dims, options, true, nodeLoader);
    expect(yRange(flat, 2)).toEqual([0, 5]);
    // The hook rises above the top of the book (the -y direction once laid flat) and lies on the bed.
    const hookPoints = [];
    for (let i = 0; i < flat.positions.length; i += 3) {
      if (flat.positions[i + 1] > 30.1 || flat.positions[i + 1] < -30.1) hookPoints.push(flat.positions[i + 2]);
    }
    expect(hookPoints.length).toBeGreaterThan(0);
    expect(Math.min(...hookPoints)).toBeCloseTo(0, 5);
    expect(Math.max(...hookPoints)).toBeCloseTo(1.2, 5);
  });

  it('is named for its side', () => {
    expect(modelFileName(dims, { hook: true, hookPosition: 'center', hookSide: 'back', roundSpine: true }, '3mf')).toBe(
      'mini-book-30x20x5mm-round-spine-hook-center-back.3mf',
    );
  });
});

describe('meshToStl', () => {
  it('writes a binary STL with one record per triangle', () => {
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: new Uint32Array([0, 1, 2]) };
    const view = new DataView(meshToStl(mesh));
    expect(view.byteLength).toBe(84 + 50);
    expect(view.getUint32(80, true)).toBe(1);
    // Normal of a counter-clockwise triangle in the XY plane points up.
    expect(view.getFloat32(84 + 8, true)).toBe(1);
    expect(view.getFloat32(84 + 12 + 12, true)).toBe(1);
  });

  it('names files by size and hook', () => {
    expect(modelFileName(dimsAtScale(7), { hook: true, hookPosition: 'spine', hookSide: 'front', roundSpine: false }, 'stl')).toBe(
      'mini-book-30x20x5mm-flat-spine-hook-spine-corner.stl',
    );
  });
});
