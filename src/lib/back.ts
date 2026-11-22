import type { BackStyle } from './types';

/**
 * Fine control over the back cover and spine (lib/render.ts draws them). Each option has a default,
 * so settings saved with only some of them, or none, still draw as before.
 */

/** Which part of the front the back zooms in on: wherever there is least lettering, or a fixed part. */
export type Focus = 'auto' | 'top' | 'middle' | 'bottom';

export interface BackOptions {
  /**
   * Front artwork back: mirrored left to right (as a wraparound continues) and/or flipped upside down,
   * either, both or neither; how far zoomed in (1, the default, is the same scale as the front; up to
   * 3); and on which part.
   */
  mirror: boolean;
  upsideDown: boolean;
  zoom: number;
  /** Carry the artwork on across the spine too, so its graphics wrap round the book. */
  artSpine: boolean;
  focus: Focus;
  /** Softening, 0 (sharp) to 1 (heavy); darkening, 0 to 0.6; shade into the spine fold; print grain. */
  blur: number;
  darken: number;
  fold: boolean;
  grain: boolean;
  /** Placeholder blurb lines (the blurb back). */
  blurb: boolean;
  /** A barcode in the corner; unset means the back style's own default (on for blurb and artwork). */
  barcode?: boolean;
  /** Reading notes back: which notes to show. */
  showTitle: boolean;
  showRating: boolean;
  showDate: boolean;
  /** The title and author down the spine. */
  spineText: boolean;
}

export const DEFAULT_BACK_OPTIONS: BackOptions = {
  mirror: true,
  upsideDown: false,
  zoom: 1,
  artSpine: false,
  focus: 'auto',
  blur: 0.5,
  darken: 0.16,
  fold: true,
  grain: true,
  blurb: true,
  showTitle: true,
  showRating: true,
  showDate: true,
  spineText: true,
};

/** Whether a back style has a barcode unless told otherwise: real backs with blurb or artwork do. */
export const barcodeByDefault = (style: BackStyle) => style === 'blurb' || style === 'mirror';

/** The options in full for a back style: saved ones over the defaults, the barcode settled. */
export function resolveBack(style: BackStyle, saved: Partial<BackOptions> | undefined): Required<BackOptions> {
  const merged = { ...DEFAULT_BACK_OPTIONS, ...saved };
  return {
    ...merged,
    zoom: Math.min(3, Math.max(1, merged.zoom)),
    blur: Math.min(1, Math.max(0, merged.blur)),
    darken: Math.min(0.6, Math.max(0, merged.darken)),
    barcode: merged.barcode ?? barcodeByDefault(style),
  };
}

/** The canvas scale that turns the artwork as asked: [x, y], -1 to flip along that axis. */
export function flipScale({ mirror, upsideDown }: Pick<BackOptions, 'mirror' | 'upsideDown'>): [number, number] {
  return [mirror ? -1 : 1, upsideDown ? -1 : 1];
}

/** Where (0 top to 1 bottom) a fixed focus puts the zoomed-in part; null for automatic. */
export function focusAt(focus: Focus): number | null {
  return focus === 'top' ? 0 : focus === 'middle' ? 0.5 : focus === 'bottom' ? 1 : null;
}
