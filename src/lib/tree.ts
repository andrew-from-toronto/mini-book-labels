import { mulberry32 } from './color';

/**
 * A Christmas tree to hang the books on (components/Tree3D.tsx), worked out here as plain numbers so it
 * can be tested: its outline, the branches and needle sprays that fill it out, a string of lights
 * spiralling round it, and where each book hangs. Everything is in metres, z up, the trunk on the z axis.
 * Seeded, so the same books hang in the same places until shuffled.
 */

export type TreeSize = 'tabletop' | 'small' | 'medium' | 'large' | 'tall';

export const FOOT = 0.3048;
/** The heights trees are sold in, in feet as in North America, with centimetres alongside. */
const sized = (feet: number, name?: string) => ({
  label: `${name ? `${name}, ` : ''}${feet} ft (${Math.round(feet * FOOT * 100)} cm)`,
  height: feet * FOOT,
});

export const TREE_SIZES: Record<TreeSize, { label: string; height: number }> = {
  tabletop: sized(2, 'Tabletop'),
  small: sized(4),
  medium: sized(6),
  large: sized(7.5),
  tall: sized(9),
};

/** A custom height can be anything from a 1 ft tabletop tree to a 12 ft one for a high ceiling. */
export const CUSTOM_HEIGHT = { min: 1 * FOOT, max: 12 * FOOT };

export type HeightUnit = 'ft' | 'cm';

/** A height typed in feet or centimetres, in metres; null if it is not a number. Kept within CUSTOM_HEIGHT. */
export function parseHeight(text: string, unit: HeightUnit): number | null {
  const n = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  const metres = unit === 'ft' ? n * FOOT : n / 100;
  return Math.min(CUSTOM_HEIGHT.max, Math.max(CUSTOM_HEIGHT.min, metres));
}

/** A height in metres as it is shown for editing: feet to the nearest half, or whole centimetres. */
export function formatHeight(metres: number, unit: HeightUnit): string {
  return unit === 'ft' ? String(Math.round((metres / FOOT) * 2) / 2) : String(Math.round(metres * 100));
}

export type LightStyle = 'warm' | 'colour';

export type Vec3 = [number, number, number];

export interface TreeShape {
  height: number;
  /** Where the lowest branches start, above the stand. */
  bottom: number;
  /** The tip of the leader, under the star. */
  top: number;
  /** Half the width at the lowest branches. */
  radius: number;
}

/** Proportions of the trees sold for homes: about 0.6 as wide as tall, branches from a tenth of the way up. */
export function treeShape(height: number): TreeShape {
  return { height, bottom: height * 0.1, top: height * 0.95, radius: height * 0.3 };
}

/** The tree's outline at height z: a cone with a slight outward curve, as trees fill out lower down. */
export function radiusAt(shape: TreeShape, z: number): number {
  if (z <= shape.bottom) return shape.radius;
  if (z >= shape.top) return 0;
  return shape.radius * ((shape.top - z) / (shape.top - shape.bottom)) ** 0.92;
}

export interface Branch {
  start: Vec3;
  end: Vec3;
  /** Thickness at the trunk. */
  radius: number;
}

export interface Spray {
  /** Where the spray starts, on its branch. */
  at: Vec3;
  /** Unit direction it grows in. */
  dir: Vec3;
  length: number;
  /** Turn about its own axis, so the crossed needle cards do not all line up. */
  spin: number;
  /** Shade of green, about 1. */
  shade: number;
}

export interface TreeParts {
  branches: Branch[];
  sprays: Spray[];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Whorls of drooping branches up the trunk, fewer and shorter towards the top, each carrying needle
 * sprays along it and fanning out to the sides. Sprays are sized for the tree, so a tall tree has about
 * as many as a small one and draws as quickly.
 */
export function buildTree(shape: TreeShape, seed = 7): TreeParts {
  const rng = mulberry32(seed);
  const branches: Branch[] = [];
  const sprays: Spray[] = [];
  const sprayLength = Math.min(0.22, Math.max(0.07, shape.height * 0.11));
  const tiers = 26;
  const span = shape.top - shape.bottom;
  for (let t = 0; t < tiers; t++) {
    const z0 = shape.bottom + (span * (t + rng() * 0.4)) / tiers;
    const reach = radiusAt(shape, z0);
    if (reach < sprayLength * 0.3) continue;
    const count = Math.round(6 + 10 * (reach / shape.radius));
    const offset = rng() * Math.PI * 2;
    for (let b = 0; b < count; b++) {
      const angle = offset + (b / count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const z = z0 + (rng() - 0.5) * (span / tiers) * 0.6;
      // The lowest boughs droop less, so they end above the floor and the presents rather than on them.
      const droop = Math.min(0.12 + rng() * 0.25, Math.asin(Math.min(1, Math.max(0, (z - shape.bottom * 0.6) / (radiusAt(shape, z) * 0.8)))));
      // Short of the outline by most of a spray, so the needle tips, not the branch ends, make the edge.
      // Wood stays within the packed inside (lib/hanging.ts SOLID); only needles reach past it.
      const length = Math.min(
        radiusAt(shape, z) * 0.78,
        Math.max(sprayLength * 0.5, radiusAt(shape, z) * (0.92 + rng() * 0.14) - sprayLength * 0.65),
      ) / Math.cos(droop);
      const dir = norm([Math.cos(angle) * Math.cos(droop), Math.sin(angle) * Math.cos(droop), -Math.sin(droop)]);
      const end: Vec3 = [dir[0] * length, dir[1] * length, z + dir[2] * length];
      branches.push({ start: [0, 0, z], end, radius: Math.max(0.002, shape.height * 0.006 * (reach / shape.radius) + 0.002) });

      // Sprays the whole length of the branch, from close to the trunk out: one leading outwards and a
      // pair angled off to the sides. Their density is what makes the tree full, with no filler inside.
      const along = Math.max(3, Math.round(length / (sprayLength * 0.2)));
      for (let i = 0; i < along; i++) {
        const f = 0.06 + (0.94 * (i + rng() * 0.5)) / along;
        const at: Vec3 = [dir[0] * length * f, dir[1] * length * f, z + dir[2] * length * f];
        // How far the needles can reach from here and stay within the tree's outline.
        const local = Math.max(sprayLength * 0.25, (radiusAt(shape, at[2]) - Math.hypot(at[0], at[1])) * 1.25 + sprayLength * 0.15);
        const sideways: Vec3 = [-Math.sin(angle), Math.cos(angle), 0];
        // Some lift at the tips, some hang: real boughs are not level shelves.
        const lift = -0.15 + rng() * 0.55;
        for (const side of [0, -1, 1]) {
          if (side !== 0 && rng() < 0.15) continue;
          const spread = side * (0.55 + rng() * 0.45);
          const d = norm([
            dir[0] + sideways[0] * spread,
            dir[1] + sideways[1] * spread,
            dir[2] + lift + (rng() - 0.5) * 0.5,
          ]);
          sprays.push({
            at,
            dir: d,
            // Shorter where the tree is narrow, as a fir's sprays are towards the top, so none stick out.
            length: Math.min(sprayLength, local) * (0.65 + rng() * 0.5) * (side === 0 ? 1 : 0.85),
            spin: rng() * Math.PI,
            // Darker towards the trunk, where little light reaches inside a real tree.
            shade: (0.82 + rng() * 0.3) * (0.3 + 0.7 * f ** 1.5),
          });
        }
        // Inner twigs reaching up from the branch, filling the space between whorls as a real tree's do.
        if (f < 0.6 && rng() < 0.7) {
          sprays.push({
            at,
            dir: norm([dir[0] * 0.5 + (rng() - 0.5) * 0.6, dir[1] * 0.5 + (rng() - 0.5) * 0.6, 0.8 + rng() * 0.4]),
            length: Math.min(sprayLength, local) * (0.6 + rng() * 0.4),
            spin: rng() * Math.PI,
            shade: (0.8 + rng() * 0.25) * (0.3 + 0.7 * f ** 1.5),
          });
        }
      }
    }
  }
  // The leader: a few upright sprays at the very top.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    sprays.push({
      at: [0, 0, shape.top - sprayLength * 0.9],
      dir: norm([Math.cos(a) * 0.35, Math.sin(a) * 0.35, 1]),
      length: sprayLength * 0.8,
      spin: rng() * Math.PI,
      shade: 1,
    });
  }
  return { branches, sprays };
}

/** Fairy-light colours, in linear RGB. Warm white like old filament bulbs, or the classic coloured set. */
const WARM: Vec3 = [1, 0.62, 0.3];
const COLOURS: Vec3[] = [
  [1, 0.12, 0.08],
  [0.1, 0.75, 0.2],
  [0.15, 0.3, 1],
  [1, 0.55, 0.05],
  [0.85, 0.2, 0.9],
];

export interface Bulb {
  at: Vec3;
  colour: Vec3;
  /** Its own flicker, so the string twinkles rather than pulsing as one. */
  phase: number;
  speed: number;
}

/**
 * Pre-lit, as trees are sold: bulbs clipped along the branches all through the tree, not one string
 * wound round it, about 110 per foot of height (a 7.5 ft tree has some 800). Most sit out towards the
 * tips, where they show; some deeper in, glowing through the needles.
 */
export function buildLights(shape: TreeShape, style: LightStyle, sprays: Spray[], seed = 11): Bulb[] {
  const rng = mulberry32(seed);
  const count = Math.round((shape.height / 0.3048) * 110);
  // Sprays far enough out to carry a bulb, and below the very tip.
  const carriers = sprays.filter((s) => {
    const r = Math.hypot(s.at[0], s.at[1]);
    return r > radiusAt(shape, s.at[2]) * 0.55 && s.at[2] < shape.top - shape.height * 0.02;
  });
  const bulbs: Bulb[] = [];
  for (let i = 0; i < count && carriers.length; i++) {
    const s = carriers[Math.floor(rng() * carriers.length)];
    const along = s.length * (0.55 + rng() * 0.4);
    bulbs.push({
      at: [s.at[0] + s.dir[0] * along, s.at[1] + s.dir[1] * along, s.at[2] + s.dir[2] * along],
      colour: style === 'warm' ? WARM : COLOURS[i % COLOURS.length],
      phase: rng() * Math.PI * 2,
      speed: 0.6 + rng() * 1.6,
    });
  }
  return bulbs;
}

/** A place an ornament can hang: a point near the tip of an outer needle spray, which holds it. */
export interface Anchor {
  at: Vec3;
  /** Which spray, in buildTree's list, holds it. */
  spray: number;
}

/** Where along a spray an ornament's thread is hooked over it: most of the way out, as people hang them. */
export const ANCHOR_ALONG = 0.85;

/**
 * The hanging places on a tree: near the tips of sprays that reach the outside, so every ornament hangs
 * from needles, never from thin air. The leader at the top is left bare.
 */
export function anchorsOf(shape: TreeShape, sprays: Spray[]): Anchor[] {
  const anchors: Anchor[] = [];
  sprays.forEach((s, spray) => {
    const tip: Vec3 = [s.at[0] + s.dir[0] * s.length, s.at[1] + s.dir[1] * s.length, s.at[2] + s.dir[2] * s.length];
    const reach = Math.hypot(tip[0], tip[1]);
    const outline = radiusAt(shape, tip[2]);
    // Only the outermost tips: one further in would hold a hanging ornament against the branches below.
    if (reach < outline * 0.92 || reach > outline * 1.25 + 0.01 || s.dir[2] > 0.6) return;
    const k = s.length * ANCHOR_ALONG;
    anchors.push({ at: [s.at[0] + s.dir[0] * k, s.at[1] + s.dir[1] * k, s.at[2] + s.dir[2] * k], spray });
  });
  return anchors;
}

/** A wrapped present under the tree: its footprint centre on the floor, size (width, depth, height), turn. */
export interface Present {
  at: Vec3;
  size: Vec3;
  turn: number;
  paper: string;
  ribbon: string;
}

/**
 * Presents round the front of the tree, never overlapping each other or the stand. Under the boughs
 * they are kept low enough to fit below the lowest branches; out past the branch tips they can be taller,
 * as people arrange them.
 */
export function presentsFor(shape: TreeShape, seed = 99): Present[] {
  const rng = mulberry32(seed);
  const papers = ['#7d1518', '#1e4d2b', '#c9b48a', '#22314f', '#8a1c2b', '#d8d0c0'];
  const ribbons = ['#d7b25a', '#f1ebe0', '#b0121b'];
  const H = shape.height;
  const presents: Present[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const base = H * (0.06 + rng() * 0.07);
      const w = base * (0.8 + rng() * 0.6);
      const d = base * (0.7 + rng() * 0.5);
      const footprint = Math.hypot(w, d) / 2;
      // Round the front of the tree, from the left to the right of where the room looks from.
      const angle = -Math.PI / 2 + (i / (count - 1) - 0.5) * Math.PI * 1.3 + (rng() - 0.5) * 0.4;
      const r = shape.radius * (0.5 + rng() * 0.75);
      if (r - footprint < H * 0.14) continue;
      const under = r - footprint < shape.radius;
      const h = under ? Math.min(base * (0.5 + rng() * 0.5), shape.bottom * 0.55) : base * (0.6 + rng() * 0.5);
      const at: Vec3 = [Math.cos(angle) * r, Math.sin(angle) * r, 0];
      if (presents.some((p) => Math.hypot(p.at[0] - at[0], p.at[1] - at[1]) < footprint + Math.hypot(p.size[0], p.size[1]) / 2)) continue;
      presents.push({ at, size: [w, d, h], turn: rng() * Math.PI, paper: papers[i % papers.length], ribbon: ribbons[i % ribbons.length] });
      break;
    }
  }
  return presents;
}

export type BaubleStyle = 'classic' | 'traditional' | 'silver' | 'gold' | 'red' | 'rose' | 'none';

/** Glass bauble sets to hang among the books, as they are sold. */
export const BAUBLE_STYLES: Record<BaubleStyle, { label: string; colours: string[] }> = {
  classic: { label: 'Red and gold baubles', colours: ['#8c0f12', '#b8862b', '#6e0d1f', '#c99a3c'] },
  traditional: { label: 'Red, gold and silver baubles', colours: ['#8c0f12', '#b8862b', '#b9bcc2'] },
  silver: { label: 'Silver and blue baubles', colours: ['#b9bcc2', '#2b4a8c', '#dfe3ea', '#1c2f5e'] },
  gold: { label: 'Gold and champagne baubles', colours: ['#b8862b', '#d9c7a0', '#a3742a'] },
  red: { label: 'Red baubles', colours: ['#8c0f12', '#a3141a', '#6e0d1f'] },
  rose: { label: 'Rose gold baubles', colours: ['#c48a7a', '#e3b8ad', '#b06e5f'] },
  none: { label: 'No baubles', colours: [] },
};
