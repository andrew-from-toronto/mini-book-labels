import Module from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildBookMesh, DEFAULT_MODEL_OPTIONS, type Wasm } from './bookModel';
import { dimsAtScale } from './scales';
import { crc32, meshTo3mf, modelXml, storedZip } from './threeMf';

const nodeLoader = async (): Promise<Wasm> => {
  const m = await Module();
  m.setup();
  return m;
};

/** Reads a stored (uncompressed) zip back via its central directory, checking every CRC. */
function readZip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 16, true));
    files.set(name, new TextDecoder().decode(data));
    at += 46 + nameLength;
  }
  return files;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('storedZip', () => {
  it('round-trips files', () => {
    const files = readZip(storedZip([{ name: 'a/b.txt', data: new TextEncoder().encode('hello') }]));
    expect([...files]).toEqual([['a/b.txt', 'hello']]);
  });
});

describe('meshTo3mf', () => {
  it('packages the model with the parts slicers look for', async () => {
    const mesh = await buildBookMesh(dimsAtScale(7), DEFAULT_MODEL_OPTIONS, true, nodeLoader);
    const files = readZip(meshTo3mf(mesh, 'Mini book'));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const xml = files.get('3D/3dmodel.model')!;
    expect(xml).toContain('unit="millimeter"');
    expect(xml.match(/<vertex /g)).toHaveLength(mesh.positions.length / 3);
    expect(xml.match(/<triangle /g)).toHaveLength(mesh.triangles.length / 3);
  });

  it('sits the model on the plate at the origin', () => {
    const mesh = { positions: new Float32Array([5, -3, 2, 6, -3, 2, 5, -2, 4]), triangles: new Uint32Array([0, 1, 2]) };
    const xml = modelXml(mesh, 'a & b');
    expect(xml).toContain('<vertex x="0" y="0" z="0"/>');
    expect(xml).toContain('<vertex x="0" y="1" z="2"/>');
    expect(xml).toContain('name="a &amp; b"');
  });
});
