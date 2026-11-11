import Module from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildBookParts, type Wasm } from './bookModel';
import { labelUv, partGeometry } from './bookUv';
import { dimsAtScale } from './scales';

const nodeLoader = async (): Promise<Wasm> => {
  const m = await Module();
  m.setup();
  return m;
};
const dims = dimsAtScale(7); // 30 x 20 x 5, so the label is 45 mm wide

describe('labelUv', () => {
  it('puts the front panel on the right of the label, spine edge first', () => {
    expect(labelUv('front', [0, 0, 0], dims)).toEqual([25 / 45, 0]);
    expect(labelUv('front', [20, 0, 30], dims)).toEqual([1, 1]);
  });

  it('puts the back panel on the left, its spine edge at the fold', () => {
    expect(labelUv('back', [0, 5, 0], dims)).toEqual([20 / 45, 0]);
    expect(labelUv('back', [20, 5, 0], dims)).toEqual([0, 0]);
  });

  it('runs the spine from the back fold to the front fold', () => {
    expect(labelUv('spine', [0, 5, 15], dims)).toEqual([20 / 45, 0.5]);
    expect(labelUv('spine', [0, 0, 15], dims)).toEqual([25 / 45, 0.5]);
  });
});

describe('partGeometry', () => {
  it('maps only the outer faces, which cover the whole label panel', async () => {
    const parts = await buildBookParts(dims, { hook: true, hookPosition: 'center', roundSpine: true }, nodeLoader);
    for (const name of ['front', 'back', 'spine'] as const) {
      const g = partGeometry(name, parts.get(name)!, dims);
      expect(g.labelCount).toBeGreaterThan(0);
      const us = Array.from(g.uvs.slice(0, g.labelCount * 6)).filter((_, i) => i % 2 === 0);
      const span = [Math.min(...us), Math.max(...us)].map((u) => +(u * 45).toFixed(2));
      expect(span).toEqual({ back: [0, 20], spine: [20, 25], front: [25, 45] }[name]);
    }
    // The hook and pages carry no label.
    expect(partGeometry('hook', parts.get('hook')!, dims).labelCount).toBe(0);
    expect(partGeometry('pages', parts.get('pages')!, dims).labelCount).toBe(0);
  });
});
