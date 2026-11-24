/**
 * Print shop files, built from labels already drawn with their bleed.
 *
 * Production: one page per sheet, the sheet's own size (MediaBox = TrimBox = BleedBox). Layers (optional
 * content groups): the artwork; each cut line, stroked as a hairline in its spot colour (or 100% process
 * colour) set to overprint, one closed path per label; crop marks and the slug line in the margin.
 *
 * Proof: a spec page, then each sheet with its cut line, bleed edge and safe zone drawn over it, for
 * checking. Never sent to press.
 */
import { formatMm, labelCut, type CutLine, type ShopSettings } from '../output';
import { trimLines, usedBlock, type SheetLayout, type Slot } from '../layout';
import type { Outliner } from './text';
import { MM, name, num, PdfWriter, pdfDate, ref, str } from './writer';

/** One label's image, with its bleed. */
export interface LabelImage {
  /** 'jpeg': DCT-encoded RGB. 'rgb' / 'cmyk': raw samples, deflated here. */
  kind: 'jpeg' | 'rgb' | 'cmyk';
  data: Uint8Array;
  width: number;
  height: number;
}

export type Colour = { mode: 'rgb'; srgb: Uint8Array } | { mode: 'cmyk'; profile: { name: string; bytes: Uint8Array }; condition: string };

export interface PrintJob {
  layout: SheetLayout;
  shop: ShopSettings;
  /** Per sheet, the images of its labels in slot order. */
  sheets: LabelImage[][];
  colour: Colour;
  text: Outliner | null;
  /** e.g. "1:7" or "custom size". */
  scale: string;
  /** Things worth checking before sending, shown on the proof. */
  warnings: string[];
  now: Date;
}

const Y = (layout: SheetLayout, yMm: number) => (layout.page.h - yMm) * MM;
const P = (v: number) => num(v * MM);

/** `x y w h re`, from mm with y down to points with y up. */
function rect(layout: SheetLayout, x: number, y: number, w: number, h: number): string {
  return `${P(x)} ${num(Y(layout, y + h))} ${P(w)} ${P(h)} re`;
}

function slotImageRect(layout: SheetLayout, slot: Slot) {
  return { x: slot.x - layout.bleed, y: slot.y - layout.bleed, w: layout.trimW + 2 * layout.bleed, h: layout.trimH + 2 * layout.bleed };
}

/** Adds an image XObject; returns its object number. */
async function addImage(pdf: PdfWriter, img: LabelImage, colourSpace: string): Promise<number> {
  const base = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`;
  if (img.kind === 'jpeg') return pdf.addStream(`${base} /ColorSpace ${colourSpace} /Filter /DCTDecode`, img.data);
  return pdf.addDeflated(`${base} /ColorSpace ${img.kind === 'cmyk' ? '/DeviceCMYK' : colourSpace}`, img.data);
}

function info(pdf: PdfWriter, job: PrintJob, title: string): number {
  const date = pdfDate(job.now);
  return pdf.add(
    `<< /Title ${str(title)} /Creator ${str('Mini Book Labels, minibookornaments.com')} /Producer ${str('Mini Book Labels')} /CreationDate ${date} /ModDate ${date} /Trapped /False >>`,
  );
}

function labelCount(job: PrintJob) {
  return job.sheets.reduce((n, s) => n + s.length, 0);
}

const inkText = (line: CutLine) =>
  line.ink === 'spot' ? `spot colour "${line.name}"` : `100% ${line.ink}`;

export interface SlugInfo {
  sheet: number;
  sheets: number;
  labels: number;
  scale: string;
  /** e.g. "RGB, sRGB" or "CMYK, GRACoL2013_CRPC6". */
  colour: string;
}

export const colourText = (c: Colour) => (c.mode === 'cmyk' ? `CMYK, ${c.profile.name}` : 'RGB, sRGB');

/** The slug line: what the sheet is, for whoever handles it. */
export function slugText(layout: SheetLayout, shop: ShopSettings, info: SlugInfo): string {
  const cut = labelCut(shop);
  return [
    'Mini Book Labels',
    `Sheet ${info.sheet + 1} of ${info.sheets}`,
    `${info.labels} labels`,
    `Trim ${num(layout.trimW)} × ${num(layout.trimH)} mm (${info.scale})`,
    `Bleed ${formatMm(shop.bleed)}`,
    `${shop.cut === 'kiss' ? 'Kiss cut' : 'Die cut'}: ${inkText(cut)}, layer "${cut.layer}"`,
    info.colour,
  ].join('  ·  ');
}

/** Crop marks at each trim line, in the margin outside the block of labels, mm. Empty if the margin is too small. */
export function cropMarks(layout: SheetLayout, used: number): [number, number, number, number][] {
  const block = usedBlock(layout, used);
  const { xs, ys } = trimLines(layout, used);
  const offset = 1;
  // Room is left at the bottom for the slug line.
  const length = Math.min(5, layout.margin - offset - 5);
  if (length < 2) return [];
  const top = block.y - offset;
  const bottom = block.y + block.h + offset;
  const left = block.x - offset;
  const right = block.x + block.w + offset;
  return [
    ...xs.flatMap((x): [number, number, number, number][] => [
      [x, top - length, x, top],
      [x, bottom, x, bottom + length],
    ]),
    ...ys.flatMap((y): [number, number, number, number][] => [
      [left - length, y, left, y],
      [right, y, right + length, y],
    ]),
  ];
}

export async function buildProductionPdf(job: PrintJob): Promise<Uint8Array> {
  const { layout, shop } = job;
  const pdf = new PdfWriter();
  const catalog = pdf.alloc();
  const pagesId = pdf.alloc();

  // Colour spaces.
  let imageSpace = '/DeviceRGB';
  let outputIntents = '';
  if (job.colour.mode === 'rgb') {
    const icc = await pdf.addDeflated('/N 3 /Alternate /DeviceRGB', job.colour.srgb);
    imageSpace = ref(pdf.add(`[/ICCBased ${ref(icc)}]`));
  } else {
    const icc = await pdf.addDeflated('/N 4 /Alternate /DeviceCMYK', job.colour.profile.bytes);
    outputIntents = ` /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${str(job.colour.condition)} /Info ${str(job.colour.profile.name)} /DestOutputProfile ${ref(icc)} >>]`;
  }
  const tint = pdf.add('<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>');
  const spots = new Map<string, string>();
  const spotSpace = (spotName: string) => {
    if (!spots.has(spotName)) spots.set(spotName, `/CS${spots.size}`);
    return spots.get(spotName)!;
  };
  // Registration: prints on every plate, for crop marks.
  const allTint = pdf.add('<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 1 1 1] /N 1 >>');
  const allSpace = pdf.add(`[/Separation /All /DeviceCMYK ${ref(allTint)}]`);
  const overprint = pdf.add('<< /Type /ExtGState /OP true /op true /OPM 1 >>');

  // Layers.
  const layers = new Map<string, { id: number; key: string }>();
  const layer = (layerName: string) => {
    if (!layers.has(layerName)) layers.set(layerName, { id: pdf.add(`<< /Type /OCG /Name ${str(layerName)} >>`), key: `/L${layers.size}` });
    return layers.get(layerName)!.key;
  };
  const artLayer = layer(shop.artworkLayer || 'Artwork');
  const cut = labelCut(shop);
  const cutLayer = layer(cut.layer || 'Cut');
  const sheetCutLayer = shop.sheetCut ? layer(shop.thru.layer || 'Thru-cut') : null;
  const marksLayer = shop.cropMarks || (shop.slug && job.text) ? layer('Marks') : null;

  const stroke = (line: CutLine) =>
    line.ink === 'spot' ? `${spotSpace(line.name || 'CutContour')} CS 1 SCN` : line.ink === 'magenta' ? '0 1 0 0 K' : '1 0 0 0 K';

  const pageIds: number[] = [];
  for (let s = 0; s < job.sheets.length; s++) {
    const images = job.sheets[s];
    const xobjects: string[] = [];
    const ops: string[] = [`/OC ${artLayer} BDC`];
    for (let i = 0; i < images.length; i++) {
      const id = await addImage(pdf, images[i], imageSpace);
      xobjects.push(`/Im${i} ${ref(id)}`);
      const slot = layout.slots[i];
      const r = slotImageRect(layout, slot);
      const clip = { x: slot.x - slot.bleed.left, y: slot.y - slot.bleed.top, w: layout.trimW + slot.bleed.left + slot.bleed.right, h: layout.trimH + slot.bleed.top + slot.bleed.bottom };
      ops.push(`q ${rect(layout, clip.x, clip.y, clip.w, clip.h)} W n ${P(r.w)} 0 0 ${P(r.h)} ${P(r.x)} ${num(Y(layout, r.y + r.h))} cm /Im${i} Do Q`);
    }
    ops.push('EMC');

    ops.push(`/OC ${cutLayer} BDC q /GSop gs ${stroke(cut)} ${num(cut.weight)} w 0 J 0 j`);
    for (let i = 0; i < images.length; i++) {
      const slot = layout.slots[i];
      ops.push(`${rect(layout, slot.x, slot.y, layout.trimW, layout.trimH)} S`);
    }
    ops.push('Q EMC');

    if (sheetCutLayer) {
      ops.push(`/OC ${sheetCutLayer} BDC q /GSop gs ${stroke(shop.thru)} ${num(shop.thru.weight)} w ${rect(layout, 0, 0, layout.page.w, layout.page.h)} S Q EMC`);
    }

    if (marksLayer) {
      ops.push(`/OC ${marksLayer} BDC`);
      if (shop.cropMarks) {
        const marks = cropMarks(layout, images.length);
        if (marks.length) {
          ops.push('q /CSall CS 1 SCN 0.25 w 0 J');
          for (const [x1, y1, x2, y2] of marks) ops.push(`${P(x1)} ${num(Y(layout, y1))} m ${P(x2)} ${num(Y(layout, y2))} l S`);
          ops.push('Q');
        }
      }
      if (shop.slug && job.text && layout.margin >= 4) {
        const size = 5.5;
        const text = slugText(layout, shop, { sheet: s, sheets: job.sheets.length, labels: images.length, scale: job.scale, colour: colourText(job.colour) });
        const width = job.text.width(text, size);
        const x = Math.max(layout.margin * MM, (layout.page.w * MM - width) / 2);
        ops.push(`q 0 0 0 1 k ${job.text.path(text, x, 2.5 * MM, size)} f Q`);
      }
      ops.push('EMC');
    }

    const content = await pdf.addDeflated('', ops.join('\n'));
    const spaces = [...spots].map(([spot, key]) => `${key} [/Separation ${name(spot)} /DeviceCMYK ${ref(tint)}]`);
    const props = [...layers.values()].map((l) => `${l.key} ${ref(l.id)}`).join(' ');
    const resources = [
      `/XObject << ${xobjects.join(' ')} >>`,
      `/ColorSpace << ${spaces.join(' ')} /CSall ${ref(allSpace)} >>`,
      `/ExtGState << /GSop ${ref(overprint)} >>`,
      `/Properties << ${props} >>`,
    ];
    const box = `[0 0 ${P(layout.page.w)} ${P(layout.page.h)}]`;
    pageIds.push(
      pdf.add(`<< /Type /Page /Parent ${ref(pagesId)} /MediaBox ${box} /TrimBox ${box} /BleedBox ${box} /Resources << ${resources.join(' ')} >> /Contents ${ref(content)} >>`),
    );
  }

  pdf.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`);
  const ocgs = [...layers.values()].map((l) => ref(l.id)).join(' ');
  pdf.set(
    catalog,
    `<< /Type /Catalog /Pages ${ref(pagesId)} /OCProperties << /OCGs [${ocgs}] /D << /Name ${str('Mini Book Labels')} /Order [${ocgs}] /ON [${ocgs}] /OFF [] >> >>${outputIntents} >>`,
  );
  const n = labelCount(job);
  return pdf.finish(catalog, info(pdf, job, `Mini Book Labels: ${n} labels, ${job.scale}, print file`));
}

/** The settings, as rows on the proof's spec page. */
export function specRows(job: PrintJob): [string, string][] {
  const { shop, layout } = job;
  const cut = labelCut(shop);
  const n = labelCount(job);
  const sheet = `${num(layout.page.w)} × ${num(layout.page.h)} mm (${num(layout.page.w / 25.4)} × ${num(layout.page.h / 25.4)} in)`;
  return [
    ['Labels', `${n} on ${job.sheets.length} ${job.sheets.length === 1 ? 'sheet' : 'sheets'}, up to ${layout.perPage} a sheet (${layout.cols} × ${layout.rows})`],
    ['Label size at trim', `${num(layout.trimW)} × ${num(layout.trimH)} mm, ${job.scale}`],
    ['Sheet', sheet],
    ['Bleed', formatMm(shop.bleed)],
    ['Safe zone', formatMm(shop.safe)],
    ['Spacing', layout.gap === 0 ? 'Touching' : `${formatMm(layout.gap)} apart`],
    ['Cut', shop.cut === 'kiss' ? 'Kiss cut' : 'Die cut'],
    ['Cut line', `${inkText(cut)}, ${num(cut.weight)} pt, overprint, layer "${cut.layer}"`],
    ...(shop.sheetCut ? ([['Sheet edge', `${inkText(shop.thru)}, layer "${shop.thru.layer}"`]] as [string, string][]) : []),
    ['Colour', job.colour.mode === 'cmyk' ? colourText(job.colour) : 'RGB, tagged sRGB'],
    ['Images', job.sheets[0]?.[0]?.kind === 'jpeg' ? 'JPEG, about 600 dpi' : job.colour.mode === 'cmyk' ? 'Lossless, 400 dpi' : 'Lossless, about 600 dpi'],
    ['Marks', [shop.cropMarks ? 'Crop marks' : '', shop.slug ? 'Slug line' : ''].filter(Boolean).join(', ') || 'None'],
  ];
}

/** RGB colours for the proof's overlays. */
const PROOF = {
  ink: [0.13, 0.13, 0.15],
  muted: [0.42, 0.43, 0.47],
  rule: [0.82, 0.83, 0.86],
  cut: [0.9, 0, 0.55],
  bleed: [0, 0.6, 0.86],
  safe: [0.1, 0.62, 0.32],
  warn: [0.75, 0.33, 0],
};
const rgb = (c: number[], fill: boolean) => `${c.map(num).join(' ')} ${fill ? 'rg' : 'RG'}`;

export async function buildProofPdf(job: PrintJob, proofSheets: LabelImage[][]): Promise<Uint8Array> {
  const { layout, shop } = job;
  const pdf = new PdfWriter();
  const catalog = pdf.alloc();
  const pagesId = pdf.alloc();
  const t = job.text;
  const W = layout.page.w * MM;
  const H = layout.page.h * MM;
  const box = `[0 0 ${num(W)} ${num(H)}]`;
  const pageIds: number[] = [];
  const text = (s: string, x: number, y: number, size: number, colour: number[], weight: 'regular' | 'bold' = 'regular') =>
    t ? `q ${rgb(colour, true)} ${t.path(s, x, y, size, weight)} f Q` : '';
  const wrap = (s: string, size: number, maxWidth: number): string[] => {
    if (!t) return [s];
    const lines: string[] = [];
    let line = '';
    for (const word of s.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && t.width(next, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };

  // The spec page.
  {
    const left = 18 * MM;
    const right = W - 18 * MM;
    let y = H - 24 * MM;
    const ops: string[] = [];
    ops.push(text('Print proof', left, y, 22, PROOF.ink, 'bold'));
    y -= 16;
    const date = job.now.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    ops.push(text(`Mini Book Labels  ·  ${labelCount(job)} labels  ·  ${date}`, left, y, 9.5, PROOF.muted));
    y -= 14;
    ops.push(`q ${rgb(PROOF.rule, false)} 0.5 w ${num(left)} ${num(y)} m ${num(right)} ${num(y)} l S Q`);
    y -= 22;
    const col = left + 34 * MM;
    for (const [label, value] of specRows(job)) {
      ops.push(text(label, left, y, 8.5, PROOF.muted));
      const lines = wrap(value, 9.5, right - col);
      lines.forEach((l, i) => ops.push(text(l, col, y - i * 12.5, 9.5, PROOF.ink)));
      y -= 12.5 * lines.length + 6;
    }
    y -= 10;
    ops.push(text('Key', left, y, 11, PROOF.ink, 'bold'));
    y -= 20;
    const legend: [number[], string, boolean][] = [
      [PROOF.cut, 'Cut line', false],
      [PROOF.bleed, 'Bleed edge', true],
      [PROOF.safe, 'Safe zone', true],
    ];
    for (const [colour, label, dashed] of legend) {
      ops.push(`q ${rgb(colour, false)} 1 w ${dashed ? '[3 2] 0 d' : ''} ${num(left)} ${num(y + 3)} m ${num(left + 22)} ${num(y + 3)} l S Q`);
      ops.push(text(label, left + 30, y, 9.5, PROOF.ink));
      y -= 16;
    }
    if (job.warnings.length) {
      y -= 10;
      ops.push(text('Warnings', left, y, 11, PROOF.warn, 'bold'));
      y -= 18;
      for (const w of job.warnings) {
        for (const [i, l] of wrap(w, 9.5, right - left - 12).entries()) {
          if (i === 0) ops.push(text('•', left, y, 9.5, PROOF.warn));
          ops.push(text(l, left + 12, y, 9.5, PROOF.ink));
          y -= 13;
        }
        y -= 4;
      }
    }
    ops.push(`q ${rgb(PROOF.rule, false)} 0.5 w ${num(left)} ${num(22 * MM)} m ${num(right)} ${num(22 * MM)} l S Q`);
    ops.push(
      text('Proof. Not for printing.', left, 15 * MM, 8.5, PROOF.muted),
    );
    const content = await pdf.addDeflated('', ops.join('\n'));
    pageIds.push(pdf.add(`<< /Type /Page /Parent ${ref(pagesId)} /MediaBox ${box} /TrimBox ${box} /Resources << >> /Contents ${ref(content)} >>`));
  }

  // The sheets, with what the shop will do drawn over them.
  for (let s = 0; s < proofSheets.length; s++) {
    const images = proofSheets[s];
    const xobjects: string[] = [];
    const ops: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const id = await addImage(pdf, images[i], '/DeviceRGB');
      xobjects.push(`/Im${i} ${ref(id)}`);
      const slot = layout.slots[i];
      const r = slotImageRect(layout, slot);
      const clip = { x: slot.x - slot.bleed.left, y: slot.y - slot.bleed.top, w: layout.trimW + slot.bleed.left + slot.bleed.right, h: layout.trimH + slot.bleed.top + slot.bleed.bottom };
      ops.push(`q ${rect(layout, clip.x, clip.y, clip.w, clip.h)} W n ${P(r.w)} 0 0 ${P(r.h)} ${P(r.x)} ${num(Y(layout, r.y + r.h))} cm /Im${i} Do Q`);
    }
    ops.push(`q ${rgb(PROOF.bleed, false)} 0.4 w [2 1.5] 0 d`);
    for (let i = 0; i < images.length; i++) {
      const slot = layout.slots[i];
      ops.push(`${rect(layout, slot.x - slot.bleed.left, slot.y - slot.bleed.top, layout.trimW + slot.bleed.left + slot.bleed.right, layout.trimH + slot.bleed.top + slot.bleed.bottom)} S`);
    }
    ops.push('Q');
    if (shop.safe > 0) {
      ops.push(`q ${rgb(PROOF.safe, false)} 0.4 w [1 1.5] 0 d`);
      for (let i = 0; i < images.length; i++) {
        const slot = layout.slots[i];
        ops.push(`${rect(layout, slot.x + shop.safe, slot.y + shop.safe, layout.trimW - 2 * shop.safe, layout.trimH - 2 * shop.safe)} S`);
      }
      ops.push('Q');
    }
    ops.push(`q ${rgb(PROOF.cut, false)} 0.6 w`);
    for (let i = 0; i < images.length; i++) {
      const slot = layout.slots[i];
      ops.push(`${rect(layout, slot.x, slot.y, layout.trimW, layout.trimH)} S`);
    }
    ops.push('Q');
    const header = `Proof  ·  Sheet ${s + 1} of ${proofSheets.length}  ·  ${images.length} labels`;
    ops.push(text(header, layout.margin * MM, H - Math.max(3, layout.margin / 2 + 1.2) * MM, 7, PROOF.muted));
    const content = await pdf.addDeflated('', ops.join('\n'));
    pageIds.push(
      pdf.add(`<< /Type /Page /Parent ${ref(pagesId)} /MediaBox ${box} /TrimBox ${box} /Resources << /XObject << ${xobjects.join(' ')} >> >> /Contents ${ref(content)} >>`),
    );
  }

  pdf.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${pageIds.length} >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${ref(pagesId)} >>`);
  return pdf.finish(catalog, info(pdf, job, `Mini Book Labels: ${labelCount(job)} labels, ${job.scale}, proof`));
}
