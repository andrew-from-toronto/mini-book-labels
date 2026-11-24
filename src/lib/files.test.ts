import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, cutDxf, cutSvg, pngWithDpi, zip } from './files';

// A 1 × 1 PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

describe('files', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a ZIP that unzip lists and reads back', () => {
    const data = zip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b/c.txt', data: new TextEncoder().encode('world!') },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'test.zip');
    writeFileSync(file, data);
    let listing: string;
    try {
      listing = execFileSync('unzip', ['-l', file]).toString();
    } catch {
      // No unzip here: check the end of central directory record instead.
      expect(new DataView(data.buffer).getUint32(data.length - 22, true)).toBe(0x06054b50);
      return;
    }
    expect(listing).toContain('a.txt');
    expect(listing).toContain('b/c.txt');
    execFileSync('unzip', ['-o', '-q', file, '-d', dir]);
    expect(readFileSync(join(dir, 'b/c.txt'), 'utf8')).toBe('world!');
  });

  it('tags a PNG with its resolution right after the header', () => {
    const out = pngWithDpi(PNG, 300);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(41)).toBe(11811);
    expect(view.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
    // Tagging twice still leaves one pHYs chunk.
    const twice = pngWithDpi(out, 150);
    expect(new TextDecoder('latin1').decode(twice).split('pHYs').length).toBe(2);
  });

  it('writes cut lines as closed DXF polylines with y up', () => {
    const dxf = cutDxf([{ x: 10, y: 20, w: 45, h: 30 }], 279.4);
    expect(dxf.match(/POLYLINE/g)).toHaveLength(1);
    expect(dxf.match(/VERTEX/g)).toHaveLength(4);
    expect(dxf).toContain('20\r\n259.4\r\n');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('writes the page as SVG at its real size', () => {
    const svg = cutSvg([{ x: 10, y: 20, w: 45, h: 30 }], { w: 215.9, h: 279.4 }, null);
    expect(svg).toContain('width="215.9mm" height="279.4mm" viewBox="0 0 215.9 279.4"');
    expect(svg).toContain('<rect x="10" y="20" width="45" height="30"/>');
  });
});
