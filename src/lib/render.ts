import { averageColor, colorFromText, css, hashString, mulberry32, textColorOn, type Rgb } from './color';
import { firstAuthor } from './covers';
import type { Book, LabelStyle, Settings, WrapSpine } from './types';

/** About 610 DPI, enough for crisp spine text on a home printer. */
const PX_PER_MM = 24;
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const WHITE: Rgb = [250, 250, 250];

type Ctx = CanvasRenderingContext2D;

function drawCoverFit(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

/** Average colour of the cover's left edge, where it meets the spine. Null if the image is not CORS-readable. */
function edgeColor(img: HTMLImageElement): Rgb | null {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 36;
  const ctx = c.getContext('2d')!;
  try {
    drawCoverFit(ctx, img, 0, 0, c.width, c.height);
    return averageColor(ctx.getImageData(0, 0, 2, c.height).data);
  } catch {
    return null;
  }
}

function truncate(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawGeneratedCover(ctx: Ctx, book: Book, bg: Rgb, x: number, w: number, h: number) {
  const ink = textColorOn(bg);
  ctx.fillStyle = css(bg);
  ctx.fillRect(x, 0, w, h);
  ctx.strokeStyle = css(ink, 0.5);
  ctx.lineWidth = w * 0.012;
  ctx.strokeRect(x + w * 0.07, w * 0.07, w * 0.86, h - w * 0.14);

  const maxWidth = w * 0.72;
  ctx.fillStyle = css(ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let size = w * 0.15;
  let lines: string[];
  for (;;) {
    ctx.font = `bold ${size}px ${FONT}`;
    lines = wrapLines(ctx, book.title, maxWidth);
    const fits = lines.length <= 4 && lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (fits || size <= w * 0.06) break;
    size *= 0.9;
  }
  lines = lines.slice(0, 6);
  const top = h * 0.4 - ((lines.length - 1) * size * 1.2) / 2;
  lines.forEach((l, i) => ctx.fillText(truncate(ctx, l, maxWidth), x + w / 2, top + i * size * 1.2));

  ctx.font = `${w * 0.085}px ${FONT}`;
  ctx.fillText(truncate(ctx, firstAuthor(book.authors), maxWidth), x + w / 2, h * 0.82);
}

function drawSpine(ctx: Ctx, book: Book, ink: Rgb, x: number, w: number, h: number) {
  const surname = firstAuthor(book.authors).split(/\s+/).at(-1) ?? '';
  const pad = h * 0.05;
  const avail = h - 2 * pad;

  ctx.save();
  // Rotated so the text reads top to bottom, the English-language spine convention.
  ctx.translate(x + w / 2, 0);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = css(ink);
  ctx.textBaseline = 'middle';

  let size = w * 0.5;
  const measure = () => {
    ctx.font = `${size * 0.8}px ${FONT}`;
    const author = ctx.measureText(surname).width;
    ctx.font = `bold ${size}px ${FONT}`;
    return { author, title: ctx.measureText(book.title).width, gap: surname ? size : 0 };
  };
  let m = measure();
  const total = m.title + m.gap + m.author;
  if (total > avail) {
    size *= Math.max(0.6, avail / total);
    m = measure();
  }
  const authorMax = Math.min(m.author, avail * 0.4);
  ctx.textAlign = 'left';
  ctx.fillText(truncate(ctx, book.title, avail - m.gap - authorMax), pad, 0);
  ctx.font = `${size * 0.8}px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(truncate(ctx, surname, authorMax), h - pad, 0);
  ctx.restore();
}

/** Placeholder blurb bars and a fake barcode: enough to read as a back cover at a glance. */
function drawBack(ctx: Ctx, ink: Rgb, seed: number, w: number, h: number) {
  const rnd = mulberry32(seed);
  const mx = w * 0.14;
  const step = h * 0.065;
  let y = h * 0.14;
  ctx.fillStyle = css(ink, 0.3);
  for (const paragraph of [4, 3]) {
    for (let i = 0; i < paragraph; i++) {
      const last = i === paragraph - 1;
      const frac = last ? 0.35 + rnd() * 0.4 : 0.88 + rnd() * 0.12;
      ctx.fillRect(mx, y, (w - 2 * mx) * frac, h * 0.035);
      y += step;
    }
    y += step * 0.8;
  }

  const bw = w * 0.38;
  const bh = h * 0.13;
  const bx = w - mx - bw;
  const by = h * 0.92 - bh;
  ctx.fillStyle = '#fff';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#111';
  const unit = bw / 60;
  const end = bx + bw * 0.92;
  let x = bx + bw * 0.08;
  let bar = true;
  while (x < end - 0.01) {
    const width = Math.min(unit * (1 + Math.floor(rnd() * 3)), end - x);
    if (bar) ctx.fillRect(x, by + bh * 0.12, width, bh * 0.76);
    x += width;
    bar = !bar;
  }
}

export function drawLabel(
  canvas: HTMLCanvasElement,
  book: Book,
  cover: HTMLImageElement | null,
  dims: Pick<Settings, 'height' | 'width' | 'spine'>,
  style: LabelStyle,
  /** Set when the cover image is complete back + spine + front artwork. Nothing is generated. */
  wrapSpine?: WrapSpine,
) {
  const coverW = Math.round(dims.width * PX_PER_MM);
  const spineW = Math.round(dims.spine * PX_PER_MM);
  const h = Math.round(dims.height * PX_PER_MM);
  const frontX = coverW + spineW;
  canvas.width = frontX + coverW;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (cover && wrapSpine) {
    // Artwork panels rarely share the label's proportions, so each is stretched onto its own
    // label panel. Cropping instead would cut off titles that run edge to edge.
    const iw = cover.naturalWidth;
    const ih = cover.naturalHeight;
    const l = iw * wrapSpine.left;
    const r = iw * wrapSpine.right;
    ctx.drawImage(cover, 0, 0, l, ih, 0, 0, coverW, h);
    ctx.drawImage(cover, l, 0, r - l, ih, coverW, 0, spineW, h);
    ctx.drawImage(cover, r, 0, iw - r, ih, frontX, 0, coverW, h);
    return;
  }
  const fallback = colorFromText(book.title);

  let ink: Rgb;
  if (style === 'blur' && cover) {
    // Scaling a tiny copy back up is a blur that works in every browser, unlike ctx.filter.
    const tiny = document.createElement('canvas');
    tiny.width = 8;
    tiny.height = 12;
    drawCoverFit(tiny.getContext('2d')!, cover, 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    // Mirrored so the colours next to the front cover continue from its left edge.
    ctx.translate(frontX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(tiny, 0, 0, frontX, h);
    ctx.restore();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, frontX, h);
    ink = WHITE;
  } else {
    const base = (cover && edgeColor(cover)) ?? fallback;
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, frontX, h);
    ink = textColorOn(base);
  }

  if (cover) drawCoverFit(ctx, cover, frontX, 0, coverW, h);
  else drawGeneratedCover(ctx, book, fallback, frontX, coverW, h);

  drawBack(ctx, ink, hashString(book.title), coverW, h);
  drawSpine(ctx, book, ink, coverW, spineW, h);

  // Faint fold guides on both spine edges.
  ctx.fillStyle = css(ink, 0.15);
  ctx.fillRect(coverW - 1, 0, 2, h);
  ctx.fillRect(frontX - 1, 0, 2, h);
}
