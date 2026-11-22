import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BookMesh } from './bookModel';
import {
  atRest,
  baubleBody,
  bentDirection,
  bookBody,
  bookGrams,
  boxesOverlap,
  clearSprays,
  clearStrand,
  clipBranch,
  hangAll,
  massProperties,
  presentObstacle,
  sag,
  settle,
  SOLID,
  step,
  type Body,
  type Motion,
} from './hanging';
import { ANCHOR_ALONG, anchorsOf, buildLights, buildTree, presentsFor, radiusAt, treeShape, type Vec3 } from './tree';

/** A closed box from (0,0,0) to (w,d,h), in mm, as the book model's meshes are. */
function boxMesh(w: number, d: number, h: number, at: Vec3 = [0, 0, 0]): BookMesh {
  const c = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [at[0] + x * w, at[1] + y * d, at[2] + z * h])));
  // Outward-facing triangles of the 6 faces, by corner index (x * 4 + y * 2 + z).
  const tris = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
  ];
  return { positions: new Float32Array(c.flat()), triangles: new Uint32Array(tris.flat()) };
}

const dims = { height: 45, width: 32, spine: 13 };
const shape = treeShape(1.2);
const world = (body: Body, pose: ReturnType<typeof settle>, point: Vec3) =>
  new Vector3(...point).sub(new Vector3(...body.pivot)).applyQuaternion(new Quaternion(...pose.rotation)).add(new Vector3(...pose.pivot));

describe('mass', () => {
  it('finds the volume and centre of a closed shape', () => {
    const { volume, centre } = massProperties([boxMesh(32, 13, 45)]);
    expect(volume).toBeCloseTo(32 * 13 * 45);
    expect(centre[0]).toBeCloseTo(16);
    expect(centre[1]).toBeCloseTo(6.5);
    expect(centre[2]).toBeCloseTo(22.5);
  });

  it('weighs a book by the filament figures used for its price', () => {
    // 18.7 cm³ of PLA at 1.24 g/cm³, plus a little paper.
    expect(bookGrams(32 * 13 * 45, dims)).toBeGreaterThan(23);
    expect(bookGrams(32 * 13 * 45, dims)).toBeLessThan(24);
  });
});

describe('hanging from the hole', () => {
  const mesh = [boxMesh(32, 13, 45)];

  it('hangs level from a hook in the middle of the top', () => {
    const body = bookBody(mesh, dims, [16, 1, 50], 53);
    const pose = settle(body, [0, -1.5, 1], 0, shape);
    const centre = world(body, pose, body.centre);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeLessThan(1);
    expect(pose.lean).toBe(0);
  });

  it('hangs tilted from a hook at the corner, with its weight straight below the hole', () => {
    const body = bookBody(mesh, dims, [4, 1, 50], 53);
    const pose = settle(body, [0, -1.5, 1], 0, shape);
    const centre = world(body, pose, body.centre);
    // Centre of mass straight below the pivot.
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(-1.5, 6);
    // So the book's foot is no longer level: one bottom corner is well below the other.
    const left = world(body, pose, [0, 0, 0]);
    const right = world(body, pose, [0.032, 0, 0]);
    expect(Math.abs(left.z - right.z)).toBeGreaterThan(0.01);
  });

  it('swings out to rest against the tree rather than passing into it', () => {
    const body = bookBody(mesh, dims, [16, 1, 50], 53);
    // Hung right at the edge of the solid inside, the book below would pass into it.
    const z = 0.6;
    const r = radiusAt(shape, z) * SOLID + 0.005;
    const pose = settle(body, [r, 0, z], Math.PI / 2, shape);
    expect(pose.lean).toBeGreaterThan(0);
    for (const h of body.hull) {
      const w = world(body, pose, h);
      expect(Math.hypot(w.x, w.y)).toBeGreaterThanOrEqual(radiusAt(shape, w.z) * SOLID - 1e-6);
    }
  });
});

describe('the whole tree', () => {
  const mesh = [boxMesh(32, 13, 45)];
  const book = bookBody(mesh, dims, [16, 1, 50], 53);
  const { sprays } = buildTree(shape);
  const anchors = anchorsOf(shape, sprays);
  const books = (n: number) => Array.from({ length: n }, () => ({ body: book, size: 0.05 }));

  it('hangs every ornament from a needle spray, one each, none in the air', () => {
    const hung = hangAll(shape, sprays, anchors, books(40), 3);
    expect(hung).toHaveLength(40);
    expect(new Set(hung.map((h) => h.spray)).size).toBe(40);
    for (const h of hung) {
      const s = sprays[h.spray];
      const d = bentDirection(s, h.dip);
      const k = s.length * ANCHOR_ALONG;
      // The thread goes over the (bent) spray itself.
      expect(Math.hypot(h.at[0] - (s.at[0] + d[0] * k), h.at[1] - (s.at[1] + d[1] * k), h.at[2] - (s.at[2] + d[2] * k))).toBeLessThan(1e-9);
      // Which is within the tree's needles, not out beyond them.
      expect(Math.hypot(h.at[0], h.at[1])).toBeLessThan(radiusAt(shape, h.at[2]) * 1.3 + 0.01);
    }
  });

  it('hangs every book cover out, and keeps it so as the tree is turned', () => {
    const corner = bookBody(mesh, dims, [4, 1, 50], 53);
    for (const body of [book, corner]) {
      const hung = hangAll(shape, sprays, anchors, Array.from({ length: 40 }, () => ({ body, size: 0.05 })), 7);
      for (const h of hung) {
        const m: Motion = { q: new Quaternion(...h.pose.rotation), w: new Vector3() };
        const facesOut = () => {
          // The front cover faces -y as modelled.
          const front = new Vector3(0, -1, 0).applyQuaternion(m.q);
          const out = new Vector3(h.pose.pivot[0], h.pose.pivot[1], 0).normalize();
          expect(front.dot(out)).toBeGreaterThan(0.5);
        };
        facesOut();
        for (let t = 0; t < 1; t += 0.004) step(body, h.pose.pivot, m, 0.004, shape, new Vector3(-h.pose.pivot[1], h.pose.pivot[0], 0).setLength(2.5));
        facesOut();
      }
    }
  });

  it('hangs every ornament clear of the tree and of each other', () => {
    const hung = hangAll(shape, sprays, anchors, books(40), 3);
    const balls = hangAll(shape, sprays, anchors, Array.from({ length: 15 }, () => ({ body: baubleBody(0.045), size: 0.045 })), 4, hung);
    const all = [...hung, ...balls];
    for (const [i, a] of all.entries()) {
      for (const b of all.slice(i + 1)) expect(boxesOverlap(a.pose.box, b.pose.box, 0)).toBe(false);
    }
    for (const h of hung) {
      for (const p of book.hull) {
        const w = world(book, h.pose, p);
        if (w.z > shape.bottom && w.z < shape.top) expect(Math.hypot(w.x, w.y)).toBeGreaterThanOrEqual(radiusAt(shape, w.z) * SOLID - 1e-6);
      }
    }
  });

  it('bends a spray further under a heavier ornament, and further out along a branch', () => {
    expect(sag(30, 0.3)).toBeGreaterThan(sag(10, 0.3));
    expect(sag(10, 0.4)).toBeGreaterThan(sag(10, 0.2));
  });

  it('pushes aside needles that would pass through an ornament', () => {
    const hung = hangAll(shape, sprays, anchors, books(30), 5);
    const lengths = clearSprays(sprays, hung);
    const cut = lengths.filter((l, i) => l < sprays[i].length).length;
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(sprays.length / 4);
    // But never the spray an ornament hangs from, past where it hangs.
    for (const h of hung) expect(lengths[h.spray]).toBeGreaterThan(sprays[h.spray].length * ANCHOR_ALONG);
  });

  it('runs the lights behind every ornament, never through or in front of one, bending the cord in gently', () => {
    const hung = hangAll(shape, sprays, anchors, books(40), 3);
    const strand = buildLights(shape, 'warm');
    const cleared = clearStrand(shape, strand.points, hung);
    const local = (p: Vector3, box: (typeof hung)[number]['pose']['box']) =>
      p.clone().sub(new Vector3(...box.centre)).applyQuaternion(new Quaternion(...box.rotation).invert());
    const within = (p: Vector3) =>
      hung.some(({ pose: { box } }) => {
        const l = local(p, box);
        return Math.abs(l.x) < box.half[0] && Math.abs(l.y) < box.half[1] && Math.abs(l.z) < box.half[2];
      });
    // Through or in front: some point on the line from it in to the trunk is inside an ornament.
    const covering = (p: Vec3) => {
      for (let k = 0; k <= 1; k += 0.02) if (within(new Vector3(p[0] * (1 - k), p[1] * (1 - k), p[2]))) return true;
      return false;
    };
    expect(strand.points.some(covering)).toBe(true);
    expect(cleared.some(covering)).toBe(false);
    for (let i = 1; i < cleared.length; i++) {
      const step = Math.hypot(...([0, 1, 2].map((k) => cleared[i][k] - cleared[i - 1][k]) as Vec3));
      expect(step).toBeLessThan(0.03);
    }
    // Only near the ornaments: most of the cord stays where it was wound.
    const moved = cleared.filter((p, i) => p !== strand.points[i]).length;
    expect(moved).toBeLessThan(cleared.length / 3);
  });

  it('keeps needles and branches out of the presents', () => {
    const tree = buildTree(shape);
    const gifts = presentsFor(shape).map(presentObstacle);
    const lengths = clearSprays(tree.sprays, gifts);
    const inside = (p: Vector3) =>
      gifts.some(({ pose: { box } }) => {
        const local = p.clone().sub(new Vector3(...box.centre)).applyQuaternion(new Quaternion(...box.rotation).invert());
        return Math.abs(local.x) < box.half[0] && Math.abs(local.y) < box.half[1] && Math.abs(local.z) < box.half[2];
      });
    tree.sprays.forEach((s, i) => {
      for (let t = 0; t <= 1; t += 0.1) expect(inside(new Vector3(...s.at).addScaledVector(new Vector3(...s.dir), lengths[i] * t))).toBe(false);
    });
    for (const b of tree.branches) {
      const d = new Vector3(b.end[0] - b.start[0], b.end[1] - b.start[1], b.end[2] - b.start[2]);
      const full = d.length();
      d.normalize();
      const length = clipBranch(b.start, [d.x, d.y, d.z], full, b.radius, gifts);
      for (let t = 0; t <= 1; t += 0.1) expect(inside(new Vector3(...b.start).addScaledVector(d, length * t))).toBe(false);
    }
  });
});

describe('in real time', () => {
  const mesh = [boxMesh(32, 13, 45)];
  const pivot: Vec3 = [0, -0.4, 0.7];
  const run = (body: Body, m: Motion, seconds: number, support?: Vector3, check?: () => void) => {
    for (let t = 0; t < seconds; t += 0.004) {
      step(body, pivot, m, 0.004, shape, support);
      check?.();
    }
  };

  it('swings a book to its new balance when its hook moves, and settles there', () => {
    const centred = bookBody(mesh, dims, [16, 1, 50], 53);
    const corner = bookBody(mesh, dims, [4, 1, 50], 53);
    // Hanging level from a centred hook, then rethreaded through a hole at the corner.
    const m: Motion = { q: new Quaternion(...settle(centred, pivot, 0, shape).rotation), w: new Vector3() };
    let swung = 0;
    run(corner, m, 0.3, undefined, () => (swung = Math.max(swung, m.w.length())));
    expect(swung).toBeGreaterThan(1);
    run(corner, m, 8);
    expect(atRest(m)).toBe(true);
    // At rest where the one-off calculation puts it: weight straight below the hole.
    const centre = new Vector3(...corner.centre).sub(new Vector3(...corner.pivot)).applyQuaternion(m.q);
    expect(Math.hypot(centre.x, centre.y)).toBeLessThan(0.0005);
  });

  for (const [where, out] of [
    ['at the needle tips, where ornaments hang', 1],
    ['right against the solid inside', SOLID * 1.03],
  ] as const) {
  it(`sways when the tree is turned, then settles again, never passing into the tree: hung ${where}`, () => {
    const body = bookBody(mesh, dims, [16, 1, 50], 53);
    const near: Vec3 = [radiusAt(shape, 0.6) * out, 0, 0.6];
    const m: Motion = { q: new Quaternion(...settle(body, near, Math.PI / 2, shape).rotation), w: new Vector3() };
    const deepest = () => {
      for (const h of body.hull) {
        const w = new Vector3(...h).sub(new Vector3(...body.pivot)).applyQuaternion(m.q).add(new Vector3(...near));
        if (w.z > shape.bottom && w.z < shape.top) expect(Math.hypot(w.x, w.y)).toBeGreaterThanOrEqual(radiusAt(shape, w.z) * SOLID - 1e-6);
      }
    };
    for (let t = 0; t < 0.4; t += 0.004) step(body, near, m, 0.004, shape, new Vector3(0, 2, 0)), deepest();
    // Hanging free it swings; pressed against the needles they hold it.
    if (out === 1) expect(m.w.length()).toBeGreaterThan(0.5);
    for (let t = 0; t < 8; t += 0.004) step(body, near, m, 0.004, shape), deepest();
    expect(atRest(m)).toBe(true);
  });
  }
});
