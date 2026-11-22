import { describe, expect, it } from 'vitest';
import { anchorsOf, BULB_SPACING, buildLights, buildTree, FOOT, CUSTOM_HEIGHT, formatHeight, parseHeight, presentsFor, radiusAt, TREE_SIZES, treeShape, type Vec3 } from './tree';

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
  const along = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

  it('are one string, about 110 bulbs per foot, a bulb every 6.6 cm of cord as mini lights are', () => {
    for (const size of Object.values(TREE_SIZES)) {
      const shape = treeShape(size.height);
      const { points, bulbs, lead } = buildLights(shape, 'warm');
      expect(Math.abs(bulbs.length - (size.height / FOOT) * 110)).toBeLessThan(size.height * 20);
      // A continuous cord: no gaps between its points.
      for (let i = 1; i < points.length; i++) expect(along(points[i - 1], points[i])).toBeLessThan(0.03);
      // Bulbs in order along it, evenly spaced, all before the lead.
      for (let i = 1; i < bulbs.length; i++) {
        let cord = 0;
        for (let j = bulbs[i - 1].point + 1; j <= bulbs[i].point; j++) cord += along(points[j - 1], points[j]);
        expect(cord).toBeGreaterThan(BULB_SPACING - 0.02);
        expect(cord).toBeLessThan(BULB_SPACING + 0.02);
      }
      expect(bulbs[bulbs.length - 1].point).toBeLessThan(lead);
    }
  });

  it('is wound round the tree from the top down, just inside the needle tips, then runs to the stand', () => {
    const shape = treeShape(TREE_SIZES.medium.height);
    const { points, lead } = buildLights(shape, 'warm');
    let turned = 0;
    for (let i = 1; i < lead; i++) {
      const p = points[i];
      const r = Math.hypot(p[0], p[1]);
      expect(r).toBeGreaterThan(radiusAt(shape, p[2]) * 0.75 - 0.002);
      expect(r).toBeLessThan(radiusAt(shape, p[2]) * 0.97 + 0.002);
      let d = Math.atan2(p[1], p[0]) - Math.atan2(points[i - 1][1], points[i - 1][0]);
      if (d < -Math.PI) d += Math.PI * 2;
      if (d > Math.PI) d -= Math.PI * 2;
      turned += d;
    }
    expect(points[0][2]).toBeGreaterThan(shape.top - shape.height * 0.06);
    expect(points[lead - 1][2]).toBeLessThan(shape.bottom + shape.height * 0.04);
    // Wraps a few centimetres apart: many turns, always the same way round.
    expect(turned / (Math.PI * 2)).toBeGreaterThan(15);
    const end = points[points.length - 1];
    expect(Math.hypot(end[0], end[1])).toBeLessThan(shape.height * 0.03);
    expect(end[2]).toBeLessThan(shape.bottom);
  });

  it('lights the whole tree, top to bottom, in proportion to how wide it is', () => {
    for (const size of Object.values(TREE_SIZES)) {
      const shape = treeShape(size.height);
      const { bulbs } = buildLights(shape, 'warm');
      const bands = 8;
      const counts = new Array<number>(bands).fill(0);
      for (const b of bulbs) {
        const t = (b.at[2] - shape.bottom) / (shape.top - shape.bottom);
        counts[Math.max(0, Math.min(bands - 1, Math.floor(t * bands)))]++;
      }
      const widths = counts.map((_, i) => radiusAt(shape, shape.bottom + ((i + 0.5) / bands) * (shape.top - shape.bottom)));
      const sum = widths.reduce((a, w) => a + w, 0);
      counts.forEach((n, i) => {
        const expected = (bulbs.length * widths[i]) / sum;
        expect(n).toBeGreaterThan(expected * 0.5 - 3);
        expect(n).toBeLessThan(expected * 1.6 + 5);
      });
    }
  });

  it('repeat their colours in order along a coloured string', () => {
    const { bulbs } = buildLights(treeShape(1.2), 'colour');
    const first = bulbs.slice(0, 5).map((b) => b.colour.join());
    expect(new Set(first).size).toBe(5);
    bulbs.forEach((b, i) => expect(b.colour.join()).toBe(first[i % 5]));
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
