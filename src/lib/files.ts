/**
 * Small file formats for the cutting machine downloads: a ZIP (stored, no compression: PNGs and PDFs are
 * compressed already), a resolution tag for PNGs, and cut lines as DXF and SVG.
 */

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** A ZIP of `files`, stored uncompressed. */
export function zip(files: { name: string; data: Uint8Array }[], now = new Date()): Uint8Array {
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, f.data.length, true);
    central.setUint32(24, f.data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, f.data);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + f.data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The PNG with a pHYs chunk saying it is `dpi` dots per inch, so apps open it at its real size. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  // Signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 crc).
  const afterIhdr = 8 + 25;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new DataView(new ArrayBuffer(21));
  chunk.setUint32(0, 9);
  encoder.encodeInto('pHYs', new Uint8Array(chunk.buffer, 4, 4));
  chunk.setUint32(8, ppm);
  chunk.setUint32(12, ppm);
  chunk.setUint8(16, 1); // metres
  const bytes = new Uint8Array(chunk.buffer);
  chunk.setUint32(17, crc32(bytes.subarray(4, 17)));
  // Drop any pHYs the browser wrote, so there is only one.
  const rest = withoutChunk(png.subarray(afterIhdr), 'pHYs');
  return concat([png.subarray(0, afterIhdr), bytes, rest]);
}

function withoutChunk(chunks: Uint8Array, type: string): Uint8Array {
  const parts: Uint8Array[] = [];
  const view = new DataView(chunks.buffer, chunks.byteOffset, chunks.byteLength);
  let at = 0;
  while (at + 8 <= chunks.length) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...chunks.subarray(at + 4, at + 8));
    const size = 12 + length;
    if (name !== type) parts.push(chunks.subarray(at, at + size));
    at += size;
  }
  return concat(parts);
}

export interface CutRect {
  /** mm from the page's top left */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Closed rectangles as an R12 DXF in millimetres, y up from the page's bottom left, as CAD expects. */
export function cutDxf(rects: CutRect[], pageH: number): string {
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  for (const r of rects) {
    lines.push('0', 'POLYLINE', '8', 'CUT', '66', '1', '70', '1');
    const corners: [number, number][] = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ];
    for (const [x, y] of corners) lines.push('0', 'VERTEX', '8', 'CUT', '10', n(x), '20', n(pageH - y), '30', '0');
    lines.push('0', 'SEQEND', '8', 'CUT');
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

/** The page as SVG at real size: the printed image underneath and the cut lines on top. */
export function cutSvg(rects: CutRect[], page: { w: number; h: number }, pngDataUrl: string | null): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  const image = pngDataUrl
    ? `  <g id="Print"><image x="0" y="0" width="${n(page.w)}" height="${n(page.h)}" href="${pngDataUrl}"/></g>\n`
    : '';
  const cuts = rects.map((r) => `    <rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.w)}mm" height="${n(page.h)}mm" viewBox="0 0 ${n(page.w)} ${n(page.h)}">
${image}  <g id="Cut" fill="none" stroke="#e6007e" stroke-width="0.1">
${cuts}
  </g>
</svg>
`;
}
