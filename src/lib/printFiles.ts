/**
 * Makes the downloads for print shops and cutting machines: draws every label at print resolution with
 * its bleed, encodes it, and hands it to the file builders (lib/pdf/shopPdf.ts, lib/files.ts).
 */
import { drawLabelWithBleed } from './bleed';
import { conditionOf, loadProfile, loadSrgb, rgbaToCmyk } from './cmyk';
import type { CoverResult } from './covers';
import { cutDxf, cutSvg, pngWithDpi, zip, type CutRect } from './files';
import { defaultWrapSpine, sheetLayout, usedBlock, type SheetLayout } from './layout';
import { cutterSettings, formatMm, outputMode, shopSettings, type BleedFill, type ShopSettings } from './output';
import { buildProductionPdf, buildProofPdf, cropMarks, type LabelImage } from './pdf/shopPdf';
import { loadOutliner } from './pdf/text';
import { PRINT_PX_PER_MM, type LabelOptions } from './render';
import { matchingScale } from './scales';
import type { Book, CustomCover, Settings } from './types';

/** Everything drawLabel needs for one book, as the sheet's Label component works it out. */
export function labelOptions(cover: CoverResult | undefined, custom: CustomCover | undefined, settings: Settings): LabelOptions {
  const wrap = cover?.source === 'wrap' ? (custom?.spine ?? cover.detectedSpine ?? defaultWrapSpine(settings)) : undefined;
  return {
    back: settings.back,
    backOptions: settings.backOptions,
    wrapSpine: wrap,
    crop: custom?.crop ?? cover?.detectedCrop ?? undefined,
  };
}

/** "1:7", or "custom size". */
export function scaleText(s: Settings): string {
  const ratio = matchingScale(s);
  return ratio ? `1:${ratio}` : 'custom size';
}

/** Spine text and barcode sit this far (mm) from the label's top and bottom edges, as drawn (lib/render.ts). */
const spineEdge = (h: number) => h * 0.05;
const barcodeEdge = (h: number) => h * 0.08;

/** What is worth checking before a sheet goes to a shop. */
export function shopWarnings(s: Settings, shop: ShopSettings = shopSettings(s), layout: SheetLayout = sheetLayout(s)): string[] {
  const out: string[] = [];
  const h = s.height;
  const back = { spineText: true, barcode: true, ...s.backOptions };
  const mm = (v: number) => `${Number((v + 1e-9).toFixed(1))} mm`;
  if (!shop.pullIn && shop.safe > 0) {
    if (back.spineText !== false && spineEdge(h) < shop.safe) {
      out.push(`Spine titles start ${mm(spineEdge(h))} from the top and bottom edges, inside the ${formatMm(shop.safe)} safe zone.`);
    }
    if (back.barcode !== false && barcodeEdge(h) < shop.safe) {
      out.push(`The barcode sits ${mm(barcodeEdge(h))} from the bottom edge, inside the ${formatMm(shop.safe)} safe zone.`);
    }
  }
  if (shop.safe * 2 > h * 0.25) out.push(`The safe zone takes ${Math.round(((shop.safe * 2) / h) * 100)}% of the label's height.`);
  if (h < 15) out.push(`Labels are ${mm(h)} tall. Ask the shop for the smallest label it can kiss-cut.`);
  if (shop.bleed === 0) out.push('No bleed: a cut that lands off the line shows white paper.');
  if (shop.cropMarks && cropMarks(layout, layout.perPage).length === 0) out.push('Crop marks need a sheet margin of at least 8 mm.');
  if (shop.slug && layout.margin < 4) out.push('The slug line needs a sheet margin of at least 4 mm.');
  if (layout.perPage === 0) out.push('A label does not fit on the sheet with this margin.');
  return out;
}

export interface Progress {
  (done: number, total: number): void;
}

const tick = () => new Promise((r) => setTimeout(r));

interface DrawInput {
  pages: Book[][];
  coverOf: (b: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
  settings: Settings;
}

/** The book's cover, waiting up to 30 seconds for one still loading. */
async function coverFor(input: DrawInput, book: Book): Promise<CoverResult> {
  for (let waited = 0; ; waited += 250) {
    const cover = input.coverOf(book);
    if (cover) return cover;
    if (waited >= 30_000) throw new Error(`The cover for "${book.title}" did not load. Try again in a moment.`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Draws one label with its bleed at `pxPerMm`. */
async function drawOne(input: DrawInput, book: Book, pxPerMm: number, bleed: number, fill: BleedFill, safe: number) {
  const cover = await coverFor(input, book);
  const canvas = document.createElement('canvas');
  const { height, width, spine, style } = input.settings;
  drawLabelWithBleed(
    canvas,
    book,
    cover.image,
    { height, width, spine },
    style,
    { ...labelOptions(cover, input.customCovers[book.id], input.settings), pxPerMm, safe },
    { bleed, fill },
  );
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('The image could not be encoded.'))),
        type,
        quality,
      );
    } catch (e) {
      reject(e);
    }
  });
}

/** Canvases whose cover image the browser will not let us read cannot be saved; say which book. */
function unreadable(book: Book): Error {
  return new Error(`The cover for "${book.title}" cannot be saved into a file: its image host does not allow it. Replace that cover with an uploaded image.`);
}

function pixels(canvas: HTMLCanvasElement, book: Book): Uint8ClampedArray {
  try {
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    throw unreadable(book);
  }
}

function scaled(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * factor));
  out.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

const date = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface Download {
  name: string;
  data: Uint8Array;
  type: string;
}

/** The print file and its proof. */
export async function makeShopFiles(input: DrawInput, progress: Progress): Promise<Download[]> {
  const { settings, pages } = input;
  const shop = shopSettings(settings);
  const layout = sheetLayout(settings);
  const total = pages.reduce((n, p) => n + p.length, 0);
  const cmyk = shop.colour === 'cmyk';
  // 600 dpi for RGB; CMYK is lossless, so 400 dpi keeps files a sensible size.
  const pxPerMm = cmyk ? 400 / 25.4 : PRINT_PX_PER_MM;
  const [text, colour] = await Promise.all([
    loadOutliner().catch(() => null),
    cmyk
      ? loadProfile(shop.profile).then((profile) => ({ mode: 'cmyk' as const, profile, condition: conditionOf(shop.profile, profile) }))
      : loadSrgb().then((srgb) => ({ mode: 'rgb' as const, srgb })),
  ]);
  const sheets: LabelImage[][] = [];
  const proofSheets: LabelImage[][] = [];
  let done = 0;
  progress(0, total);
  for (const page of pages) {
    const images: LabelImage[] = [];
    const proofs: LabelImage[] = [];
    for (const book of page) {
      const canvas = await drawOne(input, book, pxPerMm, shop.bleed, shop.bleedFill, shop.pullIn ? shop.safe : 0);
      const { width, height } = canvas;
      if (colour.mode === 'cmyk') {
        const data = await rgbaToCmyk(pixels(canvas, book), colour.profile);
        images.push({ kind: 'cmyk', data, width, height });
      } else if (shop.images === 'lossless') {
        const rgba = pixels(canvas, book);
        const rgb = new Uint8Array((rgba.length / 4) * 3);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
          rgb[j] = rgba[i];
          rgb[j + 1] = rgba[i + 1];
          rgb[j + 2] = rgba[i + 2];
        }
        images.push({ kind: 'rgb', data: rgb, width, height });
      } else {
        images.push({ kind: 'jpeg', data: await toBlob(canvas, 'image/jpeg', 0.95).catch(() => Promise.reject(unreadable(book))), width, height });
      }
      // The proof at about 150 dpi.
      const small = scaled(canvas, 6 / pxPerMm);
      proofs.push({ kind: 'jpeg', data: await toBlob(small, 'image/jpeg', 0.85).catch(() => Promise.reject(unreadable(book))), width: small.width, height: small.height });
      canvas.width = canvas.height = 0;
      progress(++done, total);
      await tick();
    }
    sheets.push(images);
    proofSheets.push(proofs);
  }
  const job = { layout, shop, sheets, colour, text, scale: scaleText(settings), warnings: shopWarnings(settings, shop, layout), now: new Date() };
  const production = await buildProductionPdf(job);
  const proof = await buildProofPdf(job, proofSheets);
  const base = `mini-book-labels-${total}-${scaleText(settings).replace(':', 'to').replace(' ', '-')}-${date()}`;
  return [
    { name: `${base}-print.pdf`, data: production, type: 'application/pdf' },
    { name: `${base}-proof.pdf`, data: proof, type: 'application/pdf' },
  ];
}

/** Home cutters print at about 300 dpi. */
const CUTTER_PX_PER_MM = 300 / 25.4;

const pngOf = async (canvas: HTMLCanvasElement) => pngWithDpi(await toBlob(canvas, 'image/png'), 300);

/** A page with each label drawn into its slot (bleed clipped where labels touch). */
async function composePage(input: DrawInput, layout: SheetLayout, page: Book[], area: { x: number; y: number; w: number; h: number }, fill: BleedFill, background: string | null, progress: () => void) {
  const px = CUTTER_PX_PER_MM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.w * px);
  canvas.height = Math.round(area.h * px);
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (let i = 0; i < page.length; i++) {
    const slot = layout.slots[i];
    const label = await drawOne(input, page[i], px, layout.bleed, fill, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      (slot.x - slot.bleed.left - area.x) * px,
      (slot.y - slot.bleed.top - area.y) * px,
      (layout.trimW + slot.bleed.left + slot.bleed.right) * px,
      (layout.trimH + slot.bleed.top + slot.bleed.bottom) * px,
    );
    ctx.clip();
    ctx.drawImage(label, (slot.x - layout.bleed - area.x) * px, (slot.y - layout.bleed - area.y) * px, (layout.trimW + 2 * layout.bleed) * px, (layout.trimH + 2 * layout.bleed) * px);
    ctx.restore();
    label.width = label.height = 0;
    progress();
    await tick();
  }
  return canvas;
}

const inches = (mm: number) => `${(mm / 25.4).toFixed(2)} in`;

/** The width each Cricut image must be set to in Design Space, mm. */
export function cricutWidths(settings: Settings, pages: Book[][]): number[] {
  const layout = sheetLayout(settings);
  return pages.map((p) => usedBlock(layout, p.length).w);
}

/** Cricut Print Then Cut: one PNG per batch, labels at trim size with clear gaps; Design Space adds the bleed. */
export async function makeCricutFiles(input: DrawInput, progress: Progress): Promise<Download> {
  const layout = sheetLayout(input.settings);
  const total = input.pages.reduce((n, p) => n + p.length, 0);
  let done = 0;
  progress(0, total);
  const files: { name: string; data: Uint8Array }[] = [];
  for (const [i, page] of input.pages.entries()) {
    const area = usedBlock(layout, page.length);
    const canvas = await composePage(input, layout, page, area, 'stretch', null, () => progress(++done, total));
    let png: Uint8Array;
    try {
      png = await pngOf(canvas);
    } catch {
      throw unreadable(page[0]);
    }
    const width = `${Number(area.w.toFixed(1))}mm-${inches(area.w).replace(' ', '')}`;
    files.push({ name: `cricut-${i + 1}-of-${input.pages.length}-width-${width}.png`, data: png });
  }
  files.push({ name: 'README.txt', data: new TextEncoder().encode(cricutReadme(input.pages.length, cricutWidths(input.settings, input.pages))) });
  return { name: `mini-book-labels-cricut-${date()}.zip`, data: zip(files), type: 'application/zip' };
}

function cricutReadme(count: number, widths: number[]): string {
  return [
    'Mini Book Labels for Cricut Print Then Cut',
    '',
    'These files are untested on a real machine.',
    '',
    `${count} image${count === 1 ? '' : 's'}. In Design Space, for each one:`,
    '1. Upload the PNG and choose "Print Then Cut image".',
    '2. Set its width exactly as below (lock the proportions).',
    '3. Make it, with "Add bleed" on, at 100% scale.',
    '',
    ...widths.map((w, i) => `Image ${i + 1}: width ${Number(w.toFixed(1))} mm (${inches(w)})`),
    '',
  ].join('\r\n');
}

/** Silhouette Print & Cut: the page as a PNG with bleed, and its cut lines as DXF (any edition) and SVG (Designer Edition). */
export async function makeSilhouetteFiles(input: DrawInput, progress: Progress): Promise<Download> {
  const layout = sheetLayout(input.settings);
  const total = input.pages.reduce((n, p) => n + p.length, 0);
  let done = 0;
  progress(0, total);
  const files: { name: string; data: Uint8Array }[] = [];
  const full = { x: 0, y: 0, w: layout.page.w, h: layout.page.h };
  for (const [i, page] of input.pages.entries()) {
    const canvas = await composePage(input, layout, page, full, 'mirror', '#ffffff', () => progress(++done, total));
    let png: Uint8Array;
    try {
      png = await pngOf(canvas);
    } catch {
      throw unreadable(page[0]);
    }
    const rects: CutRect[] = layout.slots.slice(0, page.length).map((s) => ({ x: s.x, y: s.y, w: layout.trimW, h: layout.trimH }));
    const n = `${i + 1}-of-${input.pages.length}`;
    const dataUrl = `data:image/png;base64,${base64(png)}`;
    files.push(
      { name: `silhouette-page-${n}.png`, data: png },
      { name: `silhouette-page-${n}-cut.dxf`, data: new TextEncoder().encode(cutDxf(rects, layout.page.h)) },
      { name: `silhouette-page-${n}.svg`, data: new TextEncoder().encode(cutSvg(rects, layout.page, dataUrl)) },
    );
  }
  const c = cutterSettings(input.settings);
  files.push({ name: 'README.txt', data: new TextEncoder().encode(silhouetteReadme(input.settings.paper, c.margin)) });
  return { name: `mini-book-labels-silhouette-${date()}.zip`, data: zip(files), type: 'application/zip' };
}

function silhouetteReadme(paper: string, margin: number): string {
  return [
    'Mini Book Labels for Silhouette Print & Cut',
    '',
    'These files are untested on a real machine.',
    '',
    `Each page is ${paper === 'a4' ? 'A4' : 'Letter'}, with labels at least ${margin} mm from every edge, clear of the registration marks.`,
    '',
    'Designer Edition and up: open the SVG. It holds the printed page and the cut lines, already lined up.',
    '',
    'Basic Edition: set the page size, open the DXF (the cut lines), then import the PNG and place it at the',
    "page's top left corner at the full page size, under the cut lines.",
    '',
    'Then turn on registration marks in Page Setup, print, and cut with the marks read by the machine.',
    '',
  ].join('\r\n');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The downloads for the current output mode. */
export async function makeFiles(input: DrawInput, progress: Progress): Promise<Download[]> {
  const mode = outputMode(input.settings);
  if (mode === 'shop') return makeShopFiles(input, progress);
  if (mode === 'cricut') return [await makeCricutFiles(input, progress)];
  if (mode === 'silhouette') return [await makeSilhouetteFiles(input, progress)];
  return [];
}
