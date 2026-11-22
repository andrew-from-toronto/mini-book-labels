import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BookMesh } from './bookModel';
import { mulberry32 } from './color';
import { COST_INPUTS } from './pricing';
import { ANCHOR_ALONG, radiusAt, type Anchor, type Present, type Spray, type TreeShape, type Vec3 } from './tree';

/**
 * How ornaments really hang on the tree (components/Tree3D.tsx). Each is a rigid body on a pivot, the
 * hole its thread goes through: gravity swings it until its centre of mass is straight below the pivot,
 * so a book hooked at a corner hangs tilted and one hooked in the middle hangs level. The tree's inside
 * (branches and packed needles) is solid; an ornament that would pass into it swings out about its pivot
 * and rests against it instead. No two ornaments overlap, each hangs from a real needle spray which its
 * weight bends down, and sprays that would pierce an ornament are pushed aside. It runs in real time
 * (`step`): change the hook and each book swings to its new balance; turn the tree and they sway.
 * Metres and grams, z up.
 */

/** Branches and packed needles fill the tree out to this share of its outline. */
export const SOLID = 0.8;
/** How far an ornament keeps off the solid inside, beyond touching. */
const CLEAR = 0.004;
/** How far a branch tip dips per gram hung on it, at a 30 cm reach. */
const SAG_PER_GRAM = 0.0006;

export interface Body {
  /** The pivot: the hole the thread goes through, in the body's own frame. */
  pivot: Vec3;
  /** Centre of mass, same frame. */
  centre: Vec3;
  /** Points on its outside, for contact with the tree, same frame. */
  hull: Vec3[];
  /** Half-size of the box round it, centred on `boxCentre`, for keeping ornaments apart. */
  half: Vec3;
  boxCentre: Vec3;
  grams: number;
}

/**
 * Volume and centre of mass of closed meshes, from the signed volumes of tetrahedra from the origin to
 * each triangle: exact for any closed shape, holes and all. Millimetres in, cubic mm and mm out.
 */
export function massProperties(meshes: BookMesh[]): { volume: number; centre: Vec3 } {
  let volume = 0;
  const moment = [0, 0, 0];
  for (const { positions: p, triangles: t } of meshes) {
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3;
      const b = t[i + 1] * 3;
      const c = t[i + 2] * 3;
      const v =
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;
      volume += v;
      for (let k = 0; k < 3; k++) moment[k] += (v * (p[a + k] + p[b + k] + p[c + k])) / 4;
    }
  }
  return { volume, centre: moment.map((m) => m / volume) as Vec3 };
}

/** What a printed book weighs, by the same filament figures as its price: plastic, plus the paper label. */
export function bookGrams(volumeMm3: number, dims: { height: number; width: number; spine: number }): number {
  const plastic = (volumeMm3 / 1000) * COST_INPUTS.infillShare * COST_INPUTS.filamentDensity;
  // About 90 g/m² paper wrapped round the covers and spine.
  const label = ((2 * dims.width + dims.spine) * dims.height * 1e-6) * 90;
  return plastic + label;
}

/** A printed book as a body, from its parts in mm and the point it hangs from (mm), in metres. */
export function bookBody(
  meshes: BookMesh[],
  dims: { height: number; width: number; spine: number },
  pivotMm: Vec3,
  hookTopMm: number,
): Body {
  const { volume, centre } = massProperties(meshes);
  const m = (v: number) => v * 0.001;
  const { height: H, width: W, spine: S } = dims;
  const hull: Vec3[] = [];
  // The corners and edge midpoints of the book, and the top of its hook.
  for (const x of [0, W / 2, W]) for (const y of [0, S]) for (const z of [0, H / 2, H]) hull.push([m(x), m(y), m(z)]);
  hull.push([m(pivotMm[0]), m(pivotMm[1]), m(hookTopMm)]);
  const top = Math.max(H, hookTopMm);
  return {
    pivot: pivotMm.map(m) as Vec3,
    centre: centre.map(m) as Vec3,
    hull,
    half: [m(W / 2), m(S / 2), m(top / 2)],
    boxCentre: [m(W / 2), m(S / 2), m(top / 2)],
    grams: bookGrams(volume, dims),
  };
}

/** A glass bauble of diameter `d`, hung from the top of its cap. */
export function baubleBody(d: number): Body {
  const r = d / 2;
  const hull: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    hull.push([Math.cos(a) * r, Math.sin(a) * r, 0], [Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, -r * 0.7]);
  }
  hull.push([0, 0, -r], [0, 0, r]);
  // Thin glass: about 1 g per cm of diameter.
  return { pivot: [0, 0, r * 1.15], centre: [0, 0, 0], hull, half: [r, r, r], boxCentre: [0, 0, 0], grams: d * 100 };
}

export interface Pose {
  /** Where the pivot is, in the world. */
  pivot: Vec3;
  /** The body's turn, as a quaternion (x, y, z, w), applied about its pivot. */
  rotation: [number, number, number, number];
  /** How far it swung out to rest on the tree, in radians: 0 if it hangs free. */
  lean: number;
  /** Its box in the world, for keeping ornaments apart. */
  box: { centre: Vec3; half: Vec3; rotation: [number, number, number, number] };
}

const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);
const quat = (q: Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];

/** Gravity, m/s². */
const G = 9.81;
/** How quickly a swing dies away (air, and the thread rubbing on the hole), per second. */
const DAMPING = 1.8;
/** Extra damping while an ornament rests on the needles and rubs on them, per second. */
const NEEDLE_FRICTION = 40;
/** Below this turning speed (rad/s), the needles an ornament rests on hold it still. */
const STICK = 1.5;
/** The most an ornament may lean back on the tree where it is hung: about 35°. */
const MAX_LEAN = 0.6;

/** Swinging about this axis by a positive angle moves what hangs below `pivot` away from the trunk. */
function outwardAxis(pivot: Vec3): Vector3 {
  const outward = new Vector3(pivot[0], pivot[1], 0);
  if (outward.lengthSq() < 1e-12) outward.set(1, 0, 0);
  return outward.normalize().cross(new Vector3(0, 0, 1)).normalize();
}

/**
 * The body's deepest point inside the tree's solid inside, turned `q` about `pivot`: how deep (negative;
 * 0 if clear), where it is from the pivot, and which way is out of the tree there. Only the canopy is
 * solid; below the lowest branches is open air.
 */
function deepest(body: Body, pivot: Vec3, q: Quaternion, shape: TreeShape) {
  const p = v3(pivot);
  const o = v3(body.pivot);
  let depth = 0;
  const arm = new Vector3();
  const out = new Vector3();
  const w = new Vector3();
  for (const h of body.hull) {
    w.set(h[0], h[1], h[2]).sub(o).applyQuaternion(q);
    const x = w.x + p.x;
    const y = w.y + p.y;
    const z = w.z + p.z;
    if (z <= shape.bottom || z >= shape.top) continue;
    const room = Math.hypot(x, y) - (radiusAt(shape, z) * SOLID + CLEAR);
    if (room < depth) {
      depth = room;
      arm.copy(w);
      out.set(x, y, 0);
      if (out.lengthSq() < 1e-12) out.set(1, 0, 0);
      out.normalize();
    }
  }
  return { depth, arm, out };
}

/**
 * Turns the body out of the tree about its pivot, a small step at a time, each step about the axis that
 * moves its deepest point most directly outwards, until it rests clear. However it went in (swinging
 * outwards, sideways or twisting), it comes out the shortest way. Returns the angle turned and the last
 * axis, which a swing must not keep turning against.
 */
function pushOut(body: Body, pivot: Vec3, q: Quaternion, shape: TreeShape, stepAngle = Math.PI / 360) {
  let angle = 0;
  let axis: Vector3 | null = null;
  const turn = new Quaternion();
  for (let i = 0; i < 400; i++) {
    const d = deepest(body, pivot, q, shape);
    if (d.depth >= 0) break;
    axis = d.arm.clone().cross(d.out);
    // Tilt only, never twist: a book stays cover-out, whichever way it is pushed off the tree.
    axis.z = 0;
    if (axis.lengthSq() < 1e-12) axis = outwardAxis(pivot);
    axis.normalize();
    q.premultiply(turn.setFromAxisAngle(axis, stepAngle));
    angle += stepAngle;
  }
  return { angle, axis };
}

/** The pose of a body turned `q` about its pivot at `pivot`. */
export function poseOf(body: Body, pivot: Vec3, q: Quaternion, lean = 0): Pose {
  const centre = v3(body.boxCentre).sub(v3(body.pivot)).applyQuaternion(q).add(v3(pivot));
  const r = quat(q);
  return { pivot, rotation: r, lean, box: { centre: [centre.x, centre.y, centre.z], half: body.half, rotation: r } };
}

/**
 * Where a body comes to rest hanging from `pivot`, turned `turn` round the vertical: centre of mass
 * straight below the pivot, then, if that leaves any part of it inside the tree, swung out about the
 * pivot (round the horizontal line along the tree's surface there) just until it rests clear. This is
 * what `step` settles to; it is worked out directly when ornaments are first hung.
 */
export function settle(body: Body, pivot: Vec3, turn: number, shape: TreeShape): Pose {
  const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), turn);
  const toCentre = v3(body.centre).sub(v3(body.pivot)).applyQuaternion(facing);
  const q = new Quaternion();
  if (toCentre.lengthSq() > 1e-12) q.setFromUnitVectors(toCentre.normalize(), new Vector3(0, 0, -1));
  q.multiply(facing);
  const { angle } = pushOut(body, pivot, q, shape, Math.PI / 180);
  return poseOf(body, pivot, q, angle);
}

/** A body's motion: its turn about the pivot and how fast it is turning (rad/s, world axes). */
export interface Motion {
  q: Quaternion;
  w: Vector3;
}

/**
 * Advances a hanging body by `dt` seconds: a rigid pendulum on its pivot. Gravity (less `support`, the
 * acceleration of the branch it hangs from, as when the tree is turned) pulls on its centre of mass; the
 * swing is resisted by its inertia and dies away with damping; it cannot pass into the tree, so where it
 * meets it, it is pushed back out and stops moving inwards. Keep `dt` small (a few ms) for a steady swing.
 */
export function step(body: Body, pivot: Vec3, m: Motion, dt: number, shape: TreeShape, support?: Vector3) {
  const r = v3(body.centre).sub(v3(body.pivot)).applyQuaternion(m.q);
  // Inertia about the pivot, per unit mass: the centre's distance from it, plus the body's own spread.
  const [hx, hy, hz] = body.half;
  const k2 = r.lengthSq() + (2 * (hx * hx + hy * hy + hz * hz)) / 9;
  const pull = new Vector3(0, 0, -G);
  if (support) pull.sub(support);
  m.w.addScaledVector(r.clone().cross(pull), dt / k2);
  m.w.multiplyScalar(Math.exp(-DAMPING * dt));
  // The thread holds an ornament's facing: it swings and tilts, but does not spin round.
  m.w.z = 0;
  const angle = m.w.length() * dt;
  if (angle > 1e-9) m.q.premultiply(new Quaternion().setFromAxisAngle(m.w.clone().normalize(), angle)).normalize();
  // Contact: pushed back out of the tree, and no longer turning into it (no bounce).
  const { axis } = pushOut(body, pivot, m.q, shape);
  if (axis) {
    const inward = m.w.dot(axis);
    if (inward < 0) m.w.addScaledVector(axis, -inward);
    // Friction against the needles it rests on: sliding slows, and slow enough it holds still.
    m.w.multiplyScalar(Math.exp(-NEEDLE_FRICTION * dt));
    if (m.w.length() < STICK) m.w.set(0, 0, 0);
  }
}

/** Whether a body has stopped swinging, near enough. */
export const atRest = (m: Motion) => m.w.lengthSq() < 1e-4;

/** Whether two boxes overlap, by the separating axis test, with `gap` to spare. */
export function boxesOverlap(a: Pose['box'], b: Pose['box'], gap = 0.002): boolean {
  const qa = new Quaternion(...a.rotation);
  const qb = new Quaternion(...b.rotation);
  const ax = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyQuaternion(qa));
  const bx = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyQuaternion(qb));
  const d = v3(b.centre).sub(v3(a.centre));
  const axes = [...ax, ...bx];
  for (const u of ax) for (const w of bx) {
    const c = new Vector3().crossVectors(u, w);
    if (c.lengthSq() > 1e-9) axes.push(c.normalize());
  }
  for (const n of axes) {
    const ra = ax.reduce((s, u, i) => s + Math.abs(u.dot(n)) * (a.half[i] + gap / 2), 0);
    const rb = bx.reduce((s, u, i) => s + Math.abs(u.dot(n)) * (b.half[i] + gap / 2), 0);
    if (Math.abs(d.dot(n)) > ra + rb) return false;
  }
  return true;
}

/** How far a branch tip dips under `grams`, more the further it reaches from the trunk. */
export function sag(grams: number, reach: number): number {
  return Math.min(0.05, SAG_PER_GRAM * grams * (reach / 0.3) ** 2);
}

/** A spray's direction once bent down by `dip` at the point an ornament hangs from it. */
export function bentDirection(spray: Spray, dip: number): Vec3 {
  const d: Vec3 = [spray.dir[0], spray.dir[1], spray.dir[2] - dip / (spray.length * ANCHOR_ALONG)];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
}

export interface Hung {
  /** Where its thread goes over the spray holding it, after the spray has bent under its weight. */
  at: Vec3;
  /** The spray holding it, and how far its weight bends that spray down. */
  spray: number;
  dip: number;
  /** Its turn round the vertical, and the thread's length down to the hole. */
  turn: number;
  thread: number;
  pose: Pose;
}

/**
 * Hangs each body on the tree in turn, from the tip of an outer needle spray (`anchors`), never two on
 * one spray: a spot spread out from the rest, the spray bent under its weight, settled under gravity
 * against the tree, and tried again elsewhere if it would touch an ornament already hung. `size` is how
 * big each is, for which heights it can go at.
 */
export function hangAll(
  shape: TreeShape,
  sprays: Spray[],
  anchors: Anchor[],
  bodies: { body: Body; size: number }[],
  seed: number,
  existing: Hung[] = [],
): Hung[] {
  const rng = mulberry32(seed);
  const all = [...existing];
  const used = new Set(existing.map((h) => h.spray));
  const hung: Hung[] = [];
  const span = shape.top - shape.bottom;

  for (const { body, size } of bodies) {
    const zMin = shape.bottom + Math.max(size * 1.5, span * 0.06);
    const zMax = shape.bottom + span * 0.82;
    const open = anchors.filter((a) => !used.has(a.spray) && a.at[2] > zMin && a.at[2] < zMax);
    if (open.length === 0) break;
    let best: Hung | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 40; k++) {
      const anchor = open[Math.floor(rng() * open.length)];
      const spray = sprays[anchor.spray];
      const dip = sag(body.grams, Math.hypot(anchor.at[0], anchor.at[1]));
      const d = bentDirection(spray, dip);
      const along = spray.length * ANCHOR_ALONG;
      const at: Vec3 = [spray.at[0] + d[0] * along, spray.at[1] + d[1] * along, spray.at[2] + d[2] * along];
      const thread = size * (0.2 + rng() * 0.35);
      // Cover out, turned a little either way as the thread settles.
      const turn = Math.atan2(at[1], at[0]) + Math.PI / 2 + (rng() - 0.5) * 0.8;
      const pose = settle(body, [at[0], at[1], at[2] - thread], turn, shape);
      const touching = all.some((o) => boxesOverlap(o.pose.box, pose.box));
      // Heights count a bit more than distance round the tree, so ornaments do not stack in columns.
      const spread = all.length
        ? Math.min(...all.map((o) => Math.hypot(at[0] - o.at[0], at[1] - o.at[1], (at[2] - o.at[2]) * 1.3)))
        : Infinity;
      // Spread out, free of other ornaments, and hanging freely: never propped steeply on the tree, where
      // a book would lie back with its cover to the ceiling.
      const steep = pose.lean > MAX_LEAN;
      const score = (touching ? -1 : 0) + (steep ? -2 : 0) + Math.min(spread, size * 6) / (size * 6) - pose.lean * 0.3;
      if (score > bestScore) {
        best = { at, spray: anchor.spray, dip, turn, thread, pose };
        bestScore = score;
      }
    }
    all.push(best!);
    hung.push(best!);
    used.add(best!.spray);
  }
  return hung;
}

/** Something needles and branches must not pass through: an ornament (and the spray holding it), or a present. */
export interface Obstacle {
  /** The spray holding it, which is left whole for it; -1 for none. */
  spray: number;
  pose: { box: Pose['box'] };
}

/** A present as an obstacle: its box on the floor. */
export function presentObstacle(p: Present): Obstacle {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), p.turn);
  return {
    spray: -1,
    pose: { box: { centre: [p.at[0], p.at[1], p.size[2] / 2], half: [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], rotation: quat(q) } },
  };
}

type Prepared = { centre: Vector3; half: Vec3; inverse: Matrix4; reach: number; spray: number };
const prepare = (obstacles: Obstacle[]): Prepared[] =>
  obstacles.map((o) => ({
    centre: v3(o.pose.box.centre),
    half: o.pose.box.half,
    inverse: new Matrix4().makeRotationFromQuaternion(new Quaternion(...o.pose.box.rotation)).invert(),
    reach: Math.hypot(...o.pose.box.half),
    spray: o.spray,
  }));

/**
 * How far along a line from `from` in direction `dir` (unit) it can go, up to `length`, before entering
 * any obstacle widened by `margin`. Starting inside one gives 0. `self` is the spray the line belongs to,
 * whose own ornament it may touch.
 */
function clipLine(from: Vec3, dir: Vec3, length: number, boxes: Prepared[], margin: number, self = -2): number {
  const start = v3(from);
  const d0 = v3(dir);
  let reach = length;
  for (const b of boxes) {
    if (b.spray === self) continue;
    // Quick rejection: the line cannot reach the box.
    if (start.distanceTo(b.centre) > reach + b.reach + margin) continue;
    const o = start.clone().sub(b.centre).applyMatrix4(b.inverse);
    const d = d0.clone().applyMatrix4(b.inverse);
    let near = 0;
    let far = reach;
    let hit = true;
    for (let i = 0; i < 3 && hit; i++) {
      const half = b.half[i] + margin;
      const oi = o.getComponent(i);
      const di = d.getComponent(i);
      if (Math.abs(di) < 1e-9) {
        if (Math.abs(oi) > half) hit = false;
        continue;
      }
      let t0 = (-half - oi) / di;
      let t1 = (half - oi) / di;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) hit = false;
    }
    if (hit) reach = Math.min(reach, near);
  }
  return reach;
}

/** A branch's length, cut short where it would pass into an obstacle (a present under the tree). */
export function clipBranch(from: Vec3, dir: Vec3, length: number, radius: number, obstacles: Obstacle[]): number {
  return Math.max(length * 0.15, clipLine(from, dir, length, prepare(obstacles), radius));
}

/**
 * Needle sprays cut back where they would pass through an ornament or a present: in a real tree they
 * push the needles aside. Each spray's centre line, widened by its half-width, is tested against each
 * obstacle's box; one that enters is shortened to where it meets it, or pushed right back if it starts
 * inside. A spray holding an ornament is left whole for it. Returns new lengths.
 */
export function clearSprays(sprays: Spray[], obstacles: Obstacle[], halfWidth = 0.15): number[] {
  const boxes = prepare(obstacles);
  const holding = new Set(obstacles.map((o) => o.spray));
  return sprays.map((s, index) => {
    const reach = clipLine(s.at, s.dir, s.length, boxes, s.length * halfWidth, index);
    if (reach >= s.length) return s.length;
    // A spray holding an ornament keeps at least the part it hangs from.
    const least = holding.has(index) ? s.length * (ANCHOR_ALONG + 0.05) : s.length * 0.02;
    return Math.max(least, reach);
  });
}
