import { describe, expect, it } from 'vitest';
import { anchorsOf, buildLights, buildTree, CUSTOM_HEIGHT, formatHeight, parseHeight, presentsFor, radiusAt, TREE_SIZES, treeShape } from './tree';

describe('the tree', () => {
  const shape = treeShape(1.2);

  it('narrows from its lowest branches to the tip', () => {
    expect(radiusAt(shape, shape.bottom)).toBeCloseTo(shape.radius);
    expect(radiusAt(shape, shape.top)).toBe(0);
    expect(radiusAt(shape, 0.5)).toBeGreaterThan(radiusAt(shape, 0.8));
  });

  it('keeps branches and sprays within its outline, and fills it out at every size', () => {
    for (const { height } of Object.values(TREE_SIZES)) {
      const s = treeShape(height);
      const { branches, sprays } = buildTree(s);
      expect(branches.length).toBeGreaterThan(100);
      // About as many sprays whatever the size, so a tall tree draws as quickly as a small one.
      expect(sprays.length).toBeGreaterThan(1500);
      expect(sprays.length).toBeLessThan(14000);
      for (const b of branches) {
        expect(Math.hypot(b.end[0], b.end[1])).toBeLessThanOrEqual(s.radius * 1.1);
      }
    }
  });

  it('is the same tree each time', () => {
    expect(buildTree(shape)).toEqual(buildTree(shape));
  });
});

describe('the sizes', () => {
  it('are sold in feet, with centimetres alongside', () => {
    expect(TREE_SIZES.large.label).toBe('7.5 ft (229 cm)');
    expect(TREE_SIZES.tabletop.label).toBe('Tabletop, 2 ft (61 cm)');
    expect(TREE_SIZES.medium.height).toBeCloseTo(1.8288);
  });
});

describe('a custom height', () => {
  it('reads feet or centimetres, and keeps within 1 to 12 ft', () => {
    expect(parseHeight('6.5', 'ft')).toBeCloseTo(1.9812);
    expect(parseHeight('150', 'cm')).toBeCloseTo(1.5);
    expect(parseHeight('6,5', 'ft')).toBeCloseTo(1.9812);
    expect(parseHeight('40', 'ft')).toBeCloseTo(CUSTOM_HEIGHT.max);
    expect(parseHeight('5', 'cm')).toBeCloseTo(CUSTOM_HEIGHT.min);
    expect(parseHeight('', 'ft')).toBeNull();
    expect(parseHeight('tall', 'ft')).toBeNull();
  });

  it('shows feet to the nearest half and whole centimetres', () => {
    expect(formatHeight(1.9812, 'ft')).toBe('6.5');
    expect(formatHeight(1.9812, 'cm')).toBe('198');
  });

  it('builds a full tree at the smallest and largest', () => {
    for (const height of [CUSTOM_HEIGHT.min, CUSTOM_HEIGHT.max]) {
      const s = treeShape(height);
      const { sprays } = buildTree(s);
      expect(sprays.length).toBeGreaterThan(1500);
      expect(sprays.length).toBeLessThan(14000);
      expect(anchorsOf(s, sprays).length).toBeGreaterThan(100);
    }
  });
});

describe('the lights', () => {
  it('are clipped along the branches all through the tree, about 110 per foot, as pre-lit trees are', () => {
    const small = treeShape(0.6);
    const big = treeShape(TREE_SIZES.large.height);
    const a = buildLights(small, 'warm', buildTree(small).sprays);
    const b = buildLights(big, 'colour', buildTree(big).sprays);
    expect(a.length).toBeGreaterThan(200);
    expect(b.length).toBeGreaterThan(800);
    for (const bulb of a) {
      const r = Math.hypot(bulb.at[0], bulb.at[1]);
      expect(r).toBeLessThanOrEqual(radiusAt(small, bulb.at[2]) * 1.3 + 0.01);
    }
    expect(new Set(b.map((x) => x.colour.join())).size).toBeGreaterThan(3);
  });
});

describe('where ornaments can hang', () => {
  const shape = treeShape(1.2);
  const { sprays } = buildTree(shape);
  const anchors = anchorsOf(shape, sprays);

  it('is near the tips of outer sprays, all round and all the way up', () => {
    expect(anchors.length).toBeGreaterThan(300);
    for (const a of anchors) {
      const r = Math.hypot(a.at[0], a.at[1]);
      // On needles at the outside: not deep inside, not out past the tips.
      expect(r).toBeGreaterThan(radiusAt(shape, a.at[2]) * 0.6);
      expect(r).toBeLessThan(radiusAt(shape, a.at[2]) * 1.35 + 0.02);
    }
    const sides = new Set(anchors.map((a) => Math.floor(((Math.atan2(a.at[1], a.at[0]) + Math.PI) / (2 * Math.PI)) * 8)));
    expect(sides.size).toBe(8);
  });
});

describe('the presents', () => {
  it('never overlap, and under the boughs are low enough to fit below the lowest branches', () => {
    for (const { height } of Object.values(TREE_SIZES)) {
      const shape = treeShape(height);
      const presents = presentsFor(shape);
      expect(presents.length).toBeGreaterThan(3);
      for (const [i, a] of presents.entries()) {
        const footprint = Math.hypot(a.size[0], a.size[1]) / 2;
        if (Math.hypot(a.at[0], a.at[1]) - footprint < shape.radius) expect(a.size[2]).toBeLessThan(shape.bottom * 0.6);
        for (const b of presents.slice(i + 1)) {
          expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThanOrEqual(footprint + Math.hypot(b.size[0], b.size[1]) / 2);
        }
      }
    }
  });
});
