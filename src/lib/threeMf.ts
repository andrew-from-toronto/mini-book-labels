/**
 * 3MF export: the format modern slicers prefer. Unlike STL it stores each vertex once and refers to it
 * by index, so the solid's topology survives exactly. A 3MF file is a zip of a few XML files; this
 * writes them uncompressed, which the format allows, so no compression library is needed.
 */
import type { BookMesh } from './bookModel';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Coordinates to a tenth of a micron: exact for printing, and short. */
const num = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** The model XML. The mesh is moved so its lowest corner sits at the origin, on the build plate. */
export function modelXml({ positions, triangles }: BookMesh, name: string): string {
  const min = [Infinity, Infinity, Infinity];
  for (let i = 0; i < positions.length; i++) min[i % 3] = Math.min(min[i % 3], positions[i]);
  const parts: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    parts.push(
      `<vertex x="${num(positions[i] - min[0])}" y="${num(positions[i + 1] - min[1])}" z="${num(positions[i + 2] - min[2])}"/>`,
    );
  }
  const vertices = parts.join('');
  parts.length = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    parts.push(`<triangle v1="${triangles[t]}" v2="${triangles[t + 1]}" v3="${triangles[t + 2]}"/>`);
  }
  const title = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${title}</metadata>
  <metadata name="Application">Mini Book Labels</metadata>
  <resources>
    <object id="1" type="model" name="${title}">
      <mesh><vertices>${vertices}</vertices><triangles>${parts.join('')}</triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The zip format's checksum (CRC-32). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive with every file stored uncompressed. */
export function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = files.map((f) => ({ ...f, nameBytes: encoder.encode(f.name), crc: crc32(f.data) }));
  const localSize = entries.reduce((n, e) => n + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = entries.reduce((n, e) => n + 46 + e.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  // 1 January 2026, 00:00, in DOS format: a fixed date keeps the file the same for the same model.
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  let at = 0;
  const offsets: number[] = [];

  for (const e of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true); // local file header
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // flags: UTF-8 names
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, 0, true); // time
    view.setUint16(at + 12, dosDate, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.nameBytes.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(e.nameBytes, at + 30);
    out.set(e.data, at + 30 + e.nameBytes.length);
    at += 30 + e.nameBytes.length + e.data.length;
  }

  const centralStart = at;
  entries.forEach((e, i) => {
    view.setUint32(at, 0x02014b50, true); // central directory header
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, dosDate, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.nameBytes.length, true);
    // Extra field, comment, disk number, internal and external attributes: all zero.
    view.setUint32(at + 42, offsets[i], true);
    out.set(e.nameBytes, at + 46);
    at += 46 + e.nameBytes.length;
  });

  view.setUint32(at, 0x06054b50, true); // end of central directory
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}

export function meshTo3mf(mesh: BookMesh, name: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return storedZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(RELS) },
    { name: '3D/3dmodel.model', data: encoder.encode(modelXml(mesh, name)) },
  ]);
}
