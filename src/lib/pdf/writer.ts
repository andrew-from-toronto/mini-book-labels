/**
 * A small PDF writer: just what print files need. Numbered objects, streams (raw, already-compressed
 * JPEG, or deflated here), and a cross-reference table. Callers write the page content in PDF operators.
 */

const encoder = new TextEncoder();

/** A reference to object `n`, as written in another object. */
export const ref = (n: number) => `${n} 0 R`;

/** A PDF literal string, escaped. Non-ASCII characters are replaced: info strings stay plain ASCII. */
export function str(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[^\x20-\x7e]/g, (c) => ({ '·': '-', '×': 'x', '—': '-', '–': '-' })[c] ?? '');
  return `(${ascii.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** A PDF name, with anything outside the regular characters written as #xx. */
export function name(text: string): string {
  return `/${[...encoder.encode(text)].map((b) => (b > 0x20 && b < 0x7f && !'#()<>[]{}/%'.includes(String.fromCharCode(b)) ? String.fromCharCode(b) : `#${b.toString(16).padStart(2, '0')}`)).join('')}`;
}

/** A number as PDF writes it: no exponent, at most 4 decimals, no trailing zeros. */
export function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a number: ${n}`);
  const fixed = n.toFixed(4).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

export const MM = 72 / 25.4;

/** Deflates (zlib format, which FlateDecode reads) with the browser's or Node's CompressionStream. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class PdfWriter {
  private objects: (Uint8Array[] | undefined)[] = [];

  /** Reserves an object number, to refer to before the object is written. */
  alloc(): number {
    this.objects.push(undefined);
    return this.objects.length;
  }

  /** Writes object `id` (from alloc) as a dictionary, array or other plain value. */
  set(id: number, body: string) {
    this.objects[id - 1] = [encoder.encode(body)];
  }

  add(body: string): number {
    const id = this.alloc();
    this.set(id, body);
    return id;
  }

  /** Writes a stream object; `dict` is the inside of its dictionary, without /Length. */
  setStream(id: number, dict: string, data: Uint8Array) {
    this.objects[id - 1] = [encoder.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, encoder.encode('\nendstream')];
  }

  addStream(dict: string, data: Uint8Array | string): number {
    const id = this.alloc();
    this.setStream(id, dict, typeof data === 'string' ? encoder.encode(data) : data);
    return id;
  }

  /** A stream deflated here. */
  async addDeflated(dict: string, data: Uint8Array | string): Promise<number> {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    return this.addStream(`${dict} /Filter /FlateDecode`.trim(), await deflate(bytes));
  }

  /** The finished file. `root` is the catalog, `info` the document information dictionary. */
  finish(root: number, info: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (c: Uint8Array) => {
      chunks.push(c);
      length += c.length;
    };
    // The comment's high bytes mark the file as binary for transfer tools.
    push(encoder.encode('%PDF-1.6\n'));
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const offsets: number[] = [];
    this.objects.forEach((parts, i) => {
      if (!parts) throw new Error(`object ${i + 1} was reserved but never written`);
      offsets.push(length);
      push(encoder.encode(`${i + 1} 0 obj\n`));
      parts.forEach(push);
      push(encoder.encode('\nendobj\n'));
    });
    const xref = length;
    const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    push(
      encoder.encode(
        `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${offsets.length + 1} /Root ${ref(root)} /Info ${ref(info)} /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`,
      ),
    );
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** A PDF date string for `d`, in UTC. */
export function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}
