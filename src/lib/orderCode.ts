/**
 * An order code names the exact blank book ordered. It travels with the payment as the Stripe Checkout
 * Session's order_code metadata (and client_reference_id, for the dashboard), and turns back into the
 * model to print.
 *
 *   v1-h300-w200-s50-flat-hook-center-front-c-black  =  30 x 20 x 5 mm, flat spine, centred hook flush
 *                                                       with the front, in black filament
 *   v1-h175-w117-s29-round-nohook                    =  17.5 x 11.7 x 2.9 mm, rounded spine, no hook, white
 *
 *   v1-h300-w200-s50-flat-hook-center-front-o30-c-white  =  as the first, with a 3 mm hook hole
 *
 * The hole part is optional and means the default hole when missing. The colour part is optional and means white when missing, so codes from before colours still read.
 *
 * Sizes are in tenths of a millimetre, since the reference cannot hold a decimal point.
 */
import type { Dims } from './scales';
import { DEFAULT_FILAMENT } from './filaments';
import { DEFAULT_HOLE, HOLE_SIZES } from './hook';
import type { HookPosition, HookSide, ModelOptions } from './types';

const VERSION = 'v1';
const HOOK_POSITIONS: HookPosition[] = ['center', 'spine', 'fore-edge'];
const HOOK_SIDES: HookSide[] = ['front', 'back'];

export interface Order {
  dims: Dims;
  options: ModelOptions;
  /** Filament colour id (src/lib/filaments.ts). */
  colour: string;
}

const tenths = (mm: number) => Math.round(mm * 10);

export function encodeOrder({ dims, options, colour }: Order): string {
  const size = `h${tenths(dims.height)}-w${tenths(dims.width)}-s${tenths(dims.spine)}`;
  const spine = options.roundSpine ? 'round' : 'flat';
  const hole = options.holeSize && options.holeSize !== DEFAULT_HOLE ? `-o${tenths(options.holeSize)}` : '';
  const hook = options.hook ? `hook-${options.hookPosition}-${options.hookSide}${hole}` : 'nohook';
  return `${VERSION}-${size}-${spine}-${hook}-c-${colour}`;
}

const PATTERN =
  /^v1-h(\d{1,4})-w(\d{1,4})-s(\d{1,4})-(flat|round)-(?:nohook|hook-(center|spine|fore-edge)-(front|back)(?:-o(\d{1,3}))?)(?:-c-([a-z0-9]{1,20}))?$/;

/** The book an order code describes, or null if it is not a valid code. Spaces around it are ignored. */
export function decodeOrder(code: string): Order | null {
  const match = code.trim().match(PATTERN);
  if (!match) return null;
  const [, h, w, s, spine, position, side, hole, colour] = match;
  const holeSize = hole ? Number(hole) / 10 : undefined;
  if (holeSize !== undefined && !(HOLE_SIZES as readonly number[]).includes(holeSize)) return null;
  const dims = { height: Number(h) / 10, width: Number(w) / 10, spine: Number(s) / 10 };
  if (!dims.height || !dims.width || !dims.spine) return null;
  return {
    dims,
    options: {
      hook: Boolean(position),
      hookPosition: (position as HookPosition | undefined) ?? HOOK_POSITIONS[0],
      hookSide: (side as HookSide | undefined) ?? HOOK_SIDES[0],
      roundSpine: spine === 'round',
      ...(holeSize !== undefined && holeSize !== DEFAULT_HOLE ? { holeSize } : {}),
    },
    colour: colour ?? DEFAULT_FILAMENT,
  };
}

/** "30 x 20 x 5 mm, black, flat spine, hook centred, front": the book in words, for buyers and the shop. */
export function describeOrder({ dims, options: o, colour }: Order): string {
  const where = { center: 'centred', spine: 'at the spine corner', 'fore-edge': 'at the fore-edge corner' }[o.hookPosition];
  const hole = o.holeSize ? `, ${o.holeSize} mm hole` : '';
  const hook = o.hook ? `hook ${where}, ${o.hookSide}${hole}` : 'no hook';
  return `${dims.height} x ${dims.width} x ${dims.spine} mm, ${colour}, ${o.roundSpine ? 'rounded' : 'flat'} spine, ${hook}`;
}
