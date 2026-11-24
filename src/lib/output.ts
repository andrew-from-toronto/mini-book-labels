/**
 * Where the sheet goes once it is designed: a home printer (the browser's print dialog), a print shop
 * (a prepress PDF with bleed and cut lines, lib/pdf/), or a home cutting machine (Cricut Print Then Cut,
 * Silhouette Print & Cut; lib/cutters.ts). Shop settings come from a preset per shop and stay editable.
 */
import type { OutputSettings, Settings } from './types';

export type OutputMode = 'home' | 'shop' | 'cricut' | 'silhouette';

/**
 * How a cut line is marked for the shop's cutter: a named spot colour (the usual RIP convention, e.g.
 * CutContour), or a 100% process stroke on a named layer (what some online shops ask for).
 */
export type CutInk = 'spot' | 'magenta' | 'cyan';

export interface CutLine {
  ink: CutInk;
  /** The spot colour's name; used when ink is 'spot'. Case matters to most RIPs. */
  name: string;
  /** The PDF layer (optional content group) the line sits on. */
  layer: string;
  /** Stroke weight in points. */
  weight: number;
}

/** Kiss cut: through the label, not the backing (a peelable sheet). Die cut: through both (loose labels). */
export type CutKind = 'kiss' | 'die';

/** How the bleed past each label's edge is filled. */
export type BleedFill = 'extend' | 'mirror' | 'stretch';

export type SheetKey = 'letter' | 'a4' | 'legal' | 'tabloid' | 'arch-b' | 'super-b' | 'sra3' | 'custom';

export const SHEETS: Record<Exclude<SheetKey, 'custom'>, { w: number; h: number; label: string }> = {
  letter: { w: 215.9, h: 279.4, label: 'Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
  legal: { w: 215.9, h: 355.6, label: 'Legal' },
  tabloid: { w: 279.4, h: 431.8, label: '11 × 17 in' },
  'arch-b': { w: 304.8, h: 457.2, label: '12 × 18 in' },
  'super-b': { w: 330.2, h: 482.6, label: '13 × 19 in' },
  sra3: { w: 320, h: 450, label: 'SRA3' },
};

export type ShopPresetKey = 'generic' | 'uprinting' | 'jukebox' | 'stickermule' | 'custom';

export interface ShopSettings {
  preset: ShopPresetKey;
  /** Artwork past each label's cut line, mm. */
  bleed: number;
  /** Distance inside the cut line that text should stay clear of, mm. */
  safe: number;
  cut: CutKind;
  /** 'gap': labels apart, each with its full bleed. 'shared': labels touching, one cut line between. */
  spacing: 'gap' | 'shared';
  /** Space between labels' cut lines in 'gap' spacing, mm; never less than twice the bleed. */
  gap: number;
  /** The shop's least space between cut lines, mm; 0 for none. Rules out shared cut lines. */
  minSpacing: number;
  sheet: SheetKey;
  /** Custom sheet size, mm. */
  sheetW: number;
  sheetH: number;
  /** Clear space round the sheet's edge, mm. */
  margin: number;
  kiss: CutLine;
  thru: CutLine;
  /** The layer the artwork sits on. */
  artworkLayer: string;
  cropMarks: boolean;
  slug: boolean;
  /** A thru-cut line round the sheet's edge. */
  sheetCut: boolean;
  warnings: boolean;
  /** Moves spine text, barcode and blurb inside the safe zone. */
  pullIn: boolean;
  bleedFill: BleedFill;
  colour: 'rgb' | 'cmyk';
  profile: 'gracol' | 'fogra39' | 'custom';
  images: 'jpeg' | 'lossless';
}

/** Settings for home cutting machines. */
export interface CutterSettings {
  /** Silhouette: artwork past each label's cut line, mm. Cricut adds its own. */
  bleed: number;
  /** Space between labels, mm. */
  gap: number;
  /** Silhouette: clear space round the page, which its registration marks need, mm. */
  margin: number;
}

const INCH = 25.4;

/** The fields a shop preset sets. Everything else is the user's own choice and survives a preset change. */
type PresetFields = Pick<ShopSettings, 'bleed' | 'safe' | 'minSpacing' | 'kiss' | 'thru' | 'artworkLayer'>;

export const SHOP_PRESETS: Record<Exclude<ShopPresetKey, 'custom'>, { label: string; values: PresetFields }> = {
  generic: {
    label: 'Generic (CutContour spot colour)',
    values: {
      bleed: INCH / 8,
      safe: INCH / 16,
      minSpacing: 0,
      kiss: { ink: 'spot', name: 'CutContour', layer: 'CutContour', weight: 0.25 },
      thru: { ink: 'spot', name: 'Thru-cut', layer: 'Thru-cut', weight: 0.25 },
      artworkLayer: 'Artwork',
    },
  },
  uprinting: {
    label: 'UPrinting style (magenta kiss cut, cyan thru-cut)',
    values: {
      bleed: INCH / 8,
      safe: INCH / 16,
      minSpacing: 0,
      kiss: { ink: 'magenta', name: 'Kiss Cut', layer: 'Kiss Cut', weight: 0.25 },
      thru: { ink: 'cyan', name: 'Thru Cut', layer: 'Thru Cut', weight: 0.25 },
      artworkLayer: 'Artwork',
    },
  },
  jukebox: {
    label: 'Jukebox style (Kiss Cut, Thru-Cut, Artwork layers)',
    values: {
      bleed: INCH / 16,
      safe: INCH / 16,
      minSpacing: 1.5,
      kiss: { ink: 'magenta', name: 'Kiss Cut', layer: 'Kiss Cut', weight: 0.25 },
      thru: { ink: 'cyan', name: 'Thru-Cut', layer: 'Thru-Cut', weight: 0.25 },
      artworkLayer: 'Artwork',
    },
  },
  stickermule: {
    label: 'Sticker Mule style (magenta cut line)',
    values: {
      bleed: INCH / 16,
      safe: INCH / 16,
      minSpacing: 0,
      kiss: { ink: 'magenta', name: 'Cut line', layer: 'Cut line', weight: 0.5 },
      thru: { ink: 'magenta', name: 'Cut line', layer: 'Cut line', weight: 0.5 },
      artworkLayer: 'Artwork',
    },
  },
};

export const DEFAULT_SHOP: ShopSettings = {
  preset: 'generic',
  ...SHOP_PRESETS.generic.values,
  cut: 'kiss',
  spacing: 'gap',
  gap: 0,
  sheet: 'letter',
  sheetW: 215.9,
  sheetH: 279.4,
  margin: 10,
  cropMarks: false,
  slug: true,
  sheetCut: false,
  warnings: true,
  pullIn: false,
  bleedFill: 'extend',
  colour: 'rgb',
  profile: 'gracol',
  images: 'jpeg',
};

export const DEFAULT_CUTTER: CutterSettings = { bleed: 1.5, gap: 4, margin: 20 };

/** Cricut Print Then Cut's largest printed image on Letter or A4 paper, mm (6.75 × 9.25 in). */
export const CRICUT_AREA = { w: 6.75 * INCH, h: 9.25 * INCH };

export const outputMode = (s: Settings): OutputMode => s.output?.mode ?? 'home';

export function shopSettings(s: Settings): ShopSettings {
  const saved = s.output?.shop ?? {};
  return {
    ...DEFAULT_SHOP,
    ...saved,
    kiss: { ...DEFAULT_SHOP.kiss, ...saved.kiss },
    thru: { ...DEFAULT_SHOP.thru, ...saved.thru },
  };
}

export const cutterSettings = (s: Settings): CutterSettings => ({ ...DEFAULT_CUTTER, ...s.output?.cutter });

/** The shop settings with a preset's values applied. */
export function applyPreset(shop: ShopSettings, preset: ShopPresetKey): ShopSettings {
  if (preset === 'custom') return { ...shop, preset };
  const values = SHOP_PRESETS[preset].values;
  return {
    ...shop,
    ...values,
    kiss: { ...values.kiss },
    thru: { ...values.thru },
    preset,
    // Shared cut lines are not allowed where the shop wants space between cuts.
    spacing: values.minSpacing > 0 ? 'gap' : shop.spacing,
  };
}

/** Whether a change touched a field a preset sets, which makes the settings custom. */
export function leavesPreset(before: ShopSettings, after: ShopSettings): boolean {
  const keys: (keyof PresetFields)[] = ['bleed', 'safe', 'minSpacing', 'kiss', 'thru', 'artworkLayer'];
  return keys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

export function sheetSize(shop: ShopSettings): { w: number; h: number } {
  return shop.sheet === 'custom' ? { w: shop.sheetW, h: shop.sheetH } : SHEETS[shop.sheet];
}

/** The cut line every label gets. */
export const labelCut = (shop: ShopSettings): CutLine => (shop.cut === 'die' ? shop.thru : shop.kiss);

/** Space between labels' cut lines on the sheet, mm. */
export function shopGap(shop: ShopSettings): number {
  if (shop.spacing === 'shared' && shop.minSpacing === 0) return 0;
  return Math.max(shop.gap, 2 * shop.bleed, shop.minSpacing);
}

export function withOutput(s: Settings, patch: Partial<OutputSettings>): Settings {
  return { ...s, output: { mode: outputMode(s), ...s.output, ...patch } };
}

/** mm, as the shops write it: fractions of an inch where they are exact. */
export function formatMm(mm: number): string {
  const fractions: [number, string][] = [
    [1 / 16, '1/16 in'],
    [1 / 8, '1/8 in'],
    [1 / 4, '1/4 in'],
  ];
  const hit = fractions.find(([f]) => Math.abs(mm - f * INCH) < 0.001);
  // Nudged so halves round up (1/8 in is 3.175 mm, which floating point holds as a hair under).
  const metric = `${Number((mm + 1e-9).toFixed(2))} mm`;
  return hit ? `${metric} (${hit[1]})` : metric;
}
