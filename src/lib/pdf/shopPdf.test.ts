import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { sheetLayout } from '../layout';
import { DEFAULT_SHOP, applyPreset, shopSettings } from '../output';
import type { Settings } from '../types';
import { buildProductionPdf, buildProofPdf, cropMarks, slugText, type LabelImage, type PrintJob } from './shopPdf';
import { outliner, type Font } from './text';
import { name, num, str } from './writer';

const settings: Settings = { height: 30, width: 20, spine: 5, style: 'edge', paper: 'letter', margin: 10, gap: 2, guideOpacity: 1, guideWidth: 0.15, model: { hook: false, hookPosition: 'center', hookSide: 'front', roundSpine: false } };

const font = (file: string) => {
  const buf = readFileSync(resolve('node_modules/@fontsource/inter/files', file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as Font;
};
const text = outliner({ regular: font('inter-latin-400-normal.woff'), bold: font('inter-latin-600-normal.woff') });

const image = (kind: LabelImage['kind'] = 'rgb'): LabelImage => ({
  kind,
  width: 2,
  height: 2,
  data: new Uint8Array(kind === 'cmyk' ? 16 : 12).fill(128),
});

function job(patch: Partial<typeof DEFAULT_SHOP> = {}, count = 5): PrintJob {
  const s: Settings = { ...settings, output: { mode: 'shop', shop: patch } };
  const layout = sheetLayout(s);
  const sheets: LabelImage[][] = [];
  for (let i = 0; i < count; i += layout.perPage) sheets.push(Array.from({ length: Math.min(layout.perPage, count - i) }, () => image()));
  return { layout, shop: shopSettings(s), sheets, colour: { mode: 'rgb', srgb: new Uint8Array(64) }, text, scale: '1:7', warnings: [], now: new Date('2026-11-23T12:00:00Z') };
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** The file's objects and its page content streams, inflated. */
function read(bytes: Uint8Array) {
  const raw = latin1(bytes);
  const xrefAt = Number(/startxref\n(\d+)/.exec(raw)![1]);
  const offsets = [...raw.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  const contents: string[] = [];
  for (const m of raw.matchAll(/<< \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    contents.push(latin1(inflateSync(bytes.subarray(start, start + Number(m[1])))));
  }
  return { raw, offsets, contents };
}

describe('the PDF writer', () => {
  it('writes numbers, names and strings as PDF does', () => {
    expect(num(1.23456)).toBe('1.2346');
    expect(num(2)).toBe('2');
    expect(num(-0.00001)).toBe('0');
    expect(name('Thru-cut')).toBe('/Thru-cut');
    expect(name('Kiss Cut')).toBe('/Kiss#20Cut');
    expect(str('a (b) \\ c · 1×2')).toBe('(a \\(b\\) \\\\ c - 1x2)');
  });
});

describe('the print file', () => {
  it('has a cross-reference table that points at every object', async () => {
    const { raw, offsets } = read(await buildProductionPdf(job()));
    expect(raw.startsWith('%PDF-1.6')).toBe(true);
    expect(offsets.length).toBeGreaterThan(5);
    offsets.forEach((o, i) => expect(raw.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it('cuts each label with a closed path in the CutContour spot colour, on its own layer, overprinting', async () => {
    const { raw, contents } = read(await buildProductionPdf(job()));
    expect(raw).toContain('[/Separation /CutContour /DeviceCMYK');
    expect(raw).toContain('/Type /OCG /Name (CutContour)');
    expect(raw).toContain('/Type /OCG /Name (Artwork)');
    expect(raw).toContain('/OP true /op true');
    const page = contents.find((c) => c.includes('/Im0 Do'))!;
    const cut = page.slice(page.indexOf('/GSop gs'), page.indexOf('Q EMC'));
    expect(cut).toContain('/CS0 CS 1 SCN 0.25 w');
    expect(cut.match(/ re S/g)).toHaveLength(5);
  });

  it('marks the page as the trim, with bleed inside it round each label', async () => {
    const { raw } = read(await buildProductionPdf(job()));
    expect(raw).toMatch(/\/MediaBox \[0 0 612 792\] \/TrimBox \[0 0 612 792\] \/BleedBox \[0 0 612 792\]/);
  });

  it('uses process magenta and cyan on named layers for UPrinting', async () => {
    const shop = applyPreset(DEFAULT_SHOP, 'uprinting');
    const { raw, contents } = read(await buildProductionPdf(job({ ...shop, sheetCut: true })));
    expect(raw).not.toContain('/Separation /CutContour');
    expect(raw).toContain('/Type /OCG /Name (Kiss Cut)');
    expect(raw).toContain('/Type /OCG /Name (Thru Cut)');
    const page = contents.find((c) => c.includes('/Im0 Do'))!;
    expect(page).toContain('0 1 0 0 K');
    expect(page).toContain('1 0 0 0 K');
  });

  it('puts die cut lines in the thru-cut colour', async () => {
    const { raw } = read(await buildProductionPdf(job({ cut: 'die' })));
    expect(raw).toContain('[/Separation /Thru-cut /DeviceCMYK');
  });

  it('embeds the press profile as the output intent for CMYK', async () => {
    const j = { ...job(), colour: { mode: 'cmyk' as const, profile: { name: 'GRACoL2013_CRPC6', bytes: new Uint8Array(64) }, condition: 'CGATS 21-2 CRPC6' } };
    j.sheets = j.sheets.map((s) => s.map(() => image('cmyk')));
    const { raw } = read(await buildProductionPdf(j));
    expect(raw).toContain('/S /GTS_PDFX /OutputConditionIdentifier (CGATS 21-2 CRPC6) /Info (GRACoL2013_CRPC6)');
    expect(raw).toContain('/ColorSpace /DeviceCMYK');
  });

  it('sets the slug line as outlines in black only, and crop marks in registration', async () => {
    const { contents, raw } = read(await buildProductionPdf(job({ cropMarks: true })));
    const page = contents.find((c) => c.includes('/Im0 Do'))!;
    expect(page).toContain('0 0 0 1 k');
    expect(page).toContain('/CSall CS 1 SCN 0.25 w');
    expect(raw).toContain('/Separation /All');
    expect(raw).not.toContain('/Font');
  });

  it('describes the sheet in the slug line', () => {
    expect(slugText(job().layout, job().shop, { sheet: 0, sheets: 1, labels: 5, scale: '1:7', colour: 'RGB, sRGB' })).toBe(
      'Mini Book Labels  ·  Sheet 1 of 1  ·  5 labels  ·  Trim 45 × 30 mm (1:7)  ·  Bleed 3.18 mm (1/8 in)  ·  Kiss cut: spot colour "CutContour", layer "CutContour"  ·  RGB, sRGB',
    );
  });

  it('keeps crop marks outside the bleed and clear of the slug line, or leaves them off', () => {
    const j = job({ cropMarks: true }, 3);
    const marks = cropMarks(j.layout, 3);
    expect(marks.length).toBeGreaterThan(0);
    for (const [, y1, , y2] of marks) expect(Math.max(y1, y2)).toBeLessThanOrEqual(j.layout.page.h - 5);
    expect(cropMarks(job({ margin: 5 }).layout, 3)).toEqual([]);
  });
});

describe('the proof', () => {
  it('starts with a spec page, then a page per sheet', async () => {
    const j = job({}, 30);
    const bytes = await buildProofPdf({ ...j, warnings: ['Spine titles sit inside the safe zone.'] }, j.sheets);
    const { raw } = read(bytes);
    expect(raw).toContain(`/Count ${j.sheets.length + 1}`);
    expect(raw).not.toContain('/OCG');
  });
});
