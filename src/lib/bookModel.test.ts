import Module from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildBookMesh, meshToStl, modelGeometry, stlFileName, type BookMesh, type Wasm } from './bookModel';
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
    const options = { hook: false, hookPosition: 'center', roundSpine: false } as const;
    expect(bounds(await buildBookMesh(dims, options, false, nodeLoader))).toEqual([20, 5, 30]);
    expect(bounds(await buildBookMesh(dims, options, true, nodeLoader))).toEqual([20, 30, 5]);
  });

  it('adds the hook above the top, and builds every preset with every hook position', async () => {
    for (const ratio of [4, 5, 6, 7, 10, 12, 24]) {
      for (const hookPosition of ['center', 'spine', 'fore-edge'] as const) {
        const dims = dimsAtScale(ratio);
        const mesh = await buildBookMesh(dims, { hook: true, hookPosition, roundSpine: true }, false, nodeLoader);
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
    expect(stlFileName(dimsAtScale(7), { hook: true, hookPosition: 'spine', roundSpine: false })).toBe(
      'mini-book-30x20x5mm-hook-spine.stl',
    );
  });
});
