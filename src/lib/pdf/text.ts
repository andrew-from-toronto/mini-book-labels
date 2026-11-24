/**
 * Text set as vector outlines (Inter, from its font file), so print files carry no fonts to embed or
 * substitute. Glyphs are placed one by one with the font's kerning; nothing here needs shaping.
 */
import { num } from './writer';

/** The parts of an opentype.js font used here. */
interface Glyph {
  advanceWidth?: number;
  getPath(x: number, y: number, size: number): { commands: PathCommand[] };
}
type PathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };
export interface Font {
  unitsPerEm: number;
  charToGlyph(c: string): Glyph;
  getKerningValue(a: Glyph, b: Glyph): number;
}

export type Weight = 'regular' | 'bold';

export interface Outliner {
  /** Width of `text` at `size` points, in points. */
  width(text: string, size: number, weight?: Weight): number;
  /** PDF path operators (then filled by the caller) for `text` with its baseline starting at (x, y), points, y up. */
  path(text: string, x: number, y: number, size: number, weight?: Weight): string;
}

export function outliner(fonts: Record<Weight, Font>): Outliner {
  const layout = (text: string, size: number, weight: Weight, each?: (g: Glyph, x: number) => void) => {
    const font = fonts[weight];
    const scale = size / font.unitsPerEm;
    let x = 0;
    let prev: Glyph | null = null;
    for (const ch of text) {
      const g = font.charToGlyph(ch);
      if (prev) x += font.getKerningValue(prev, g) * scale;
      each?.(g, x);
      x += (g.advanceWidth ?? 0) * scale;
      prev = g;
    }
    return x;
  };
  return {
    width: (text, size, weight = 'regular') => layout(text, size, weight),
    path(text, x0, y0, size, weight = 'regular') {
      const out: string[] = [];
      layout(text, size, weight, (g, gx) => {
        let cx = 0;
        let cy = 0;
        // opentype.js paths run y down from the baseline; PDF runs y up.
        const P = (x: number, y: number) => `${num(x0 + gx + x)} ${num(y0 - y)}`;
        for (const c of g.getPath(0, 0, size).commands) {
          if (c.type === 'M') out.push(`${P(c.x, c.y)} m`);
          else if (c.type === 'L') out.push(`${P(c.x, c.y)} l`);
          else if (c.type === 'C') out.push(`${P(c.x1, c.y1)} ${P(c.x2, c.y2)} ${P(c.x, c.y)} c`);
          else if (c.type === 'Q') {
            // A quadratic as the cubic with the same curve.
            const c1 = [cx + ((c.x1 - cx) * 2) / 3, cy + ((c.y1 - cy) * 2) / 3];
            const c2 = [c.x + ((c.x1 - c.x) * 2) / 3, c.y + ((c.y1 - c.y) * 2) / 3];
            out.push(`${P(c1[0], c1[1])} ${P(c2[0], c2[1])} ${P(c.x, c.y)} c`);
          } else out.push('h');
          if (c.type !== 'Z') {
            cx = c.x;
            cy = c.y;
          }
        }
      });
      return out.join('\n');
    },
  };
}

let loading: Promise<Outliner> | null = null;

/** Loads opentype.js and Inter on first use (only when a print file is made). */
export function loadOutliner(): Promise<Outliner> {
  loading ??= (async () => {
    const [{ default: opentype }, regular, bold] = await Promise.all([
      import('opentype.js'),
      import('@fontsource/inter/files/inter-latin-400-normal.woff?url'),
      import('@fontsource/inter/files/inter-latin-600-normal.woff?url'),
    ]);
    const load = async (url: string) => opentype.parse(await (await fetch(url)).arrayBuffer()) as unknown as Font;
    const [r, b] = await Promise.all([load(regular.default), load(bold.default)]);
    return outliner({ regular: r, bold: b });
  })();
  loading.catch(() => (loading = null));
  return loading;
}
