import { averageColor, colorFromText, css, hashString, mulberry32, textColorOn, type Rgb } from './color';
import { cleanTitle, firstAuthor } from './covers';
import { flipScale, focusAt, resolveBack, type BackOptions } from './back';
import type { BackStyle, Book, Crop, LabelStyle, Settings, WrapSpine } from './types';

/** About 610 DPI, enough for crisp spine text on a home printer. */
const PRINT_PX_PER_MM = 24;
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const WHITE: Rgb = [250, 250, 250];

type Ctx = CanvasRenderingContext2D;

const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };

let filterWorks: boolean | null = null;

/** Whether this browser's canvas can blur with ctx.filter (not every Safari can): tried once, then remembered. */
function canvasFilterWorks(): boolean {
  if (filterWorks !== null) return filterWorks;
  try {
    const c = document.createElement('canvas');
    c.width = 9;
    c.height = 1;
    const g = c.getContext('2d')!;
    g.filter = 'blur(2px)';
    g.fillStyle = '#fff';
    g.fillRect(4, 0, 1, 1);
    // Blurred, the single white pixel spreads to its neighbours.
    filterWorks = g.getImageData(2, 0, 1, 1).data[3] > 0;
  } catch {
    filterWorks = false;
  }
  return filterWorks;
}

/**
 * Blurs RGBA pixels in place by about `radius` (a Gaussian's standard deviation): three box blurs in a
 * row, each across then down, using running sums so the cost does not grow with the radius.
 */
export function gaussianish(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  // Box sizes whose three passes together match a Gaussian of this spread (Kovesi's method).
  const n = 3;
  const ideal = Math.sqrt((12 * radius * radius) / n + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const m = Math.round((12 * radius * radius - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4));
  const temp = new Float32Array(data.length);
  for (let pass = 0; pass < n; pass++) {
    const r = ((pass < m ? lower : lower + 2) - 1) / 2;
    if (r < 1) continue;
    boxPass(data, temp, w, h, r, true);
    boxPass(temp, data, w, h, r, false);
  }
}

/** One box blur of radius r along rows (`across`) or columns, from `src` into `dst`, edges held. */
function boxPass(src: ArrayLike<number>, dst: { [i: number]: number }, w: number, h: number, r: number, across: boolean) {
  const lines = across ? h : w;
  const length = across ? w : h;
  const stride = across ? 4 : 4 * w;
  const scale = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const start = across ? line * w * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      const at = (i: number) => src[start + Math.min(length - 1, Math.max(0, i)) * stride + c];
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < length; i++) {
        dst[start + i * stride + c] = sum * scale;
        sum += at(i + r + 1) - at(i - r);
      }
    }
  }
}

/**
 * A smooth blur of `source` by about `radius` pixels, at full resolution. The canvas's own Gaussian blur
 * where the browser has one; otherwise halving the image step by step and doubling it back up, which is
 * smooth too, unlike stretching one tiny copy, which shows blocks. The edges are padded with the image's
 * own edge colours first, so they do not fade to dark.
 */
function softBlur(source: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const { width: w, height: h } = source;
  const pad = Math.ceil(radius * 2);
  const padded = document.createElement('canvas');
  padded.width = w + 2 * pad;
  padded.height = h + 2 * pad;
  const p = padded.getContext('2d')!;
  // The image stretched to fill the border, then the image itself in the middle.
  p.drawImage(source, 0, 0, padded.width, padded.height);
  p.drawImage(source, pad, pad);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const o = out.getContext('2d')!;
  if (canvasFilterWorks()) {
    o.filter = `blur(${radius}px)`;
    o.drawImage(padded, -pad, -pad);
    o.filter = 'none';
    return out;
  }
  // No canvas blur (Safari): blur the pixels here, three box blurs being as smooth as a Gaussian.
  try {
    const image = p.getImageData(0, 0, padded.width, padded.height);
    gaussianish(image.data, padded.width, padded.height, radius);
    p.putImageData(image, 0, 0);
    o.drawImage(padded, -pad, -pad);
    return out;
  } catch {
    /* pixels not readable (a cover without CORS): fall back to scaling, smooth if not exact */
  }
  // Down by halves until a pixel spans about the radius, then back up by doubles.
  const levels: HTMLCanvasElement[] = [padded];
  while (levels.length < 12) {
    const last = levels[levels.length - 1];
    if (last.width / 2 < padded.width / Math.max(1, radius) || last.width < 8 || last.height < 8) break;
    const next = document.createElement('canvas');
    next.width = Math.max(1, Math.round(last.width / 2));
    next.height = Math.max(1, Math.round(last.height / 2));
    const g = next.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(last, 0, 0, next.width, next.height);
    levels.push(next);
  }
  let current = levels[levels.length - 1];
  for (let i = levels.length - 2; i >= 0; i--) {
    const up = document.createElement('canvas');
    up.width = levels[i].width;
    up.height = levels[i].height;
    const g = up.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(current, 0, 0, up.width, up.height);
    current = up;
  }
  o.drawImage(current, -pad, -pad);
  return out;
}

/** The part of the image left after trimming, in source pixels. */
function sourceRect(img: HTMLImageElement, crop: Crop) {
  const x = img.naturalWidth * crop.left;
  const y = img.naturalHeight * crop.top;
  return { x, y, w: img.naturalWidth * (1 - crop.right) - x, h: img.naturalHeight * (1 - crop.bottom) - y };
}

function drawCoverFit(ctx: Ctx, img: HTMLImageElement, crop: Crop, x: number, y: number, w: number, h: number) {
  const src = sourceRect(img, crop);
  const scale = Math.max(w / src.w, h / src.h);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, src.x + (src.w - sw) / 2, src.y + (src.h - sh) / 2, sw, sh, x, y, w, h);
}

/** Average colour of the cover's left edge, where it meets the spine. Null if the image is not CORS-readable. */
function edgeColor(img: HTMLImageElement, crop: Crop): Rgb | null {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 36;
  const ctx = c.getContext('2d')!;
  try {
    drawCoverFit(ctx, img, crop, 0, 0, c.width, c.height);
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

function drawSpine(ctx: Ctx, book: Book, ink: Rgb, x: number, w: number, h: number, overArtwork = false) {
  const surname = firstAuthor(book.authors).split(/\s+/).at(-1) ?? '';
  const pad = h * 0.05;
  const avail = h - 2 * pad;

  ctx.save();
  // Rotated so the text reads top to bottom, the English-language spine convention.
  ctx.translate(x + w / 2, 0);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = css(ink);
  ctx.textBaseline = 'middle';
  // Over artwork, a soft shadow in the opposite tone keeps the title readable whatever is behind it.
  if (overArtwork) {
    const dark = ink[0] + ink[1] + ink[2] > 380;
    ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.75)';
    ctx.shadowBlur = w * 0.25;
  }

  const titleFont = (s: number) => `bold ${s}px ${FONT}`;
  const authorFont = (s: number) => `${s * 0.8}px ${FONT}`;
  /** Largest size up to maxSize at which the title lines plus the author fit the spine's length. */
  const fit = (lines: string[], maxSize: number) => {
    ctx.font = titleFont(maxSize);
    const titleWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.font = authorFont(maxSize);
    const authorWidth = surname ? ctx.measureText(surname).width + maxSize : 0;
    return Math.min(maxSize, (maxSize * avail) / (titleWidth + authorWidth));
  };

  // Real spines never truncate: they drop the subtitle, shrink the type, or stack the title on two lines.
  const title = cleanTitle(book.title) || book.title;
  let lines = [title];
  let size = fit(lines, w * 0.5);
  const words = title.split(/\s+/);
  if (size < w * 0.3 && words.length > 1) {
    let split = 1;
    for (let i = 2; i < words.length; i++) {
      const imbalance = (at: number) =>
        Math.abs(words.slice(0, at).join(' ').length - words.slice(at).join(' ').length);
      if (imbalance(i) < imbalance(split)) split = i;
    }
    const stacked = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    const stackedSize = fit(stacked, w * 0.36);
    if (stackedSize > size) {
      lines = stacked;
      size = stackedSize;
    }
  }

  ctx.font = titleFont(size);
  ctx.textAlign = 'left';
  // After the rotation, local -y is the right-hand side of the spine, where the first line sits.
  if (lines.length === 1) ctx.fillText(lines[0], pad, 0);
  else lines.forEach((l, i) => ctx.fillText(l, pad, (i === 0 ? -1 : 1) * size * 0.55));
  ctx.font = authorFont(size);
  ctx.textAlign = 'right';
  ctx.fillText(surname, h - pad, 0);
  ctx.restore();
}

/** Placeholder blurb bars: enough, with a barcode, to read as a back cover at a glance. */
function drawBlurb(ctx: Ctx, ink: Rgb, seed: number, w: number, h: number) {
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
}

/** A white barcode box in the back cover's bottom corner, `size` of its width across. */
function drawBarcode(ctx: Ctx, rnd: () => number, w: number, h: number, size: number) {
  const mx = w * 0.14;
  const bw = w * size;
  const bh = h * size * 0.34;
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Finished March 2024" from a yyyy-mm-dd date read, or null without one. */
export function finishedText(lastRead: string | null): string | null {
  const m = lastRead?.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `Finished ${month} ${m[1]}` : `Finished ${m[1]}`;
}

/** How full each of five stars is for a rating out of 5: 1, 1, 1, 0.5, 0 for 3.5. */
export function starFills(rating: number): number[] {
  return [0, 1, 2, 3, 4].map((i) => Math.max(0, Math.min(1, rating - i)));
}

/** A five-pointed star path, centred on (x, y), `r` to its points. */
function starPath(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  ctx.closePath();
}

/**
 * The back as a keepsake: the title and author, your star rating and when you finished it, from
 * your library export. Whatever the export lacks is left out.
 */
function drawNotes(ctx: Ctx, book: Book, ink: Rgb, w: number, h: number, o: Required<BackOptions>) {
  const maxWidth = w * 0.76;
  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = css(ink);

  const finished = o.showDate ? finishedText(book.lastRead) : null;
  const rated = o.showRating && book.rating !== null && book.rating > 0;
  const author = o.showTitle ? firstAuthor(book.authors) : '';
  // The largest size at which the title fits on three lines and the author and date on one each.
  let size = w * 0.11;
  let lines: string[];
  for (;;) {
    ctx.font = `bold ${size}px ${FONT}`;
    lines = wrapLines(ctx, cleanTitle(book.title) || book.title, maxWidth);
    const titleFits = lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxWidth);
    ctx.font = `${size * 0.75}px ${FONT}`;
    const authorFits = ctx.measureText(author).width <= maxWidth;
    ctx.font = `italic ${size * 0.7}px ${FONT}`;
    const dateFits = !finished || ctx.measureText(finished).width <= maxWidth;
    if ((titleFits && authorFits && dateFits) || size <= w * 0.045) break;
    size *= 0.92;
  }
  lines = o.showTitle ? lines.slice(0, 3) : [];
  // The rule only parts the book from your notes on it: with only one of them, it goes.
  const rule = lines.length > 0 && (rated || finished !== null);
  // Everything stacked and centred as one block.
  const blockHeight =
    lines.length * size * 1.2 + (author ? size * 1.3 : 0) + (rule ? size * 1.2 : 0) + (rated ? size * 1.6 : 0) + (finished ? size * 1.3 : 0);
  let y = h / 2 - blockHeight / 2 + size * 0.6;
  ctx.font = `bold ${size}px ${FONT}`;
  for (const l of lines) {
    ctx.fillText(truncate(ctx, l, maxWidth), cx, y);
    y += size * 1.2;
  }
  if (author) {
    ctx.font = `${size * 0.75}px ${FONT}`;
    ctx.fillText(truncate(ctx, author, maxWidth), cx, y + size * 0.1);
    y += size * 1.3;
  }
  // A short rule between the book and your notes on it.
  if (rule) {
    ctx.fillStyle = css(ink, 0.5);
    ctx.fillRect(cx - w * 0.12, y, w * 0.24, Math.max(1, size * 0.06));
    y += size * 1.2;
  }
  if (rated) {
    const r = size * 0.55;
    const gap = r * 2.5;
    starFills(book.rating!).forEach((fill, i) => {
      const x = cx + (i - 2) * gap;
      starPath(ctx, x, y, r);
      ctx.fillStyle = css(ink, 0.25);
      ctx.fill();
      if (fill > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - r, y - r, 2 * r * fill, 2 * r);
        ctx.clip();
        starPath(ctx, x, y, r);
        ctx.fillStyle = css(ink);
        ctx.fill();
        ctx.restore();
      }
    });
    y += size * 1.6;
  }
  if (finished) {
    ctx.fillStyle = css(ink, 0.85);
    ctx.font = `italic ${size * 0.7}px ${FONT}`;
    ctx.fillText(truncate(ctx, finished, maxWidth), cx, y);
  }
}

/**
 * The front cover mirrored onto the back, as wraparound artwork continues round a real book. Zoomed in
 * a little, so the title is not repeated whole, and softened (a blur over a fainter sharp copy,
 * darker towards the spine, a little grain) so mirrored lettering reads as texture rather than
 * backwards writing. A small barcode makes it read as a back cover.
 */
function drawArtworkBack(
  ctx: Ctx,
  img: HTMLImageElement,
  crop: Crop,
  w: number,
  h: number,
  seed: number,
  o: Required<BackOptions>,
  /** Where the back cover meets the spine; less than `w` when the artwork carries on across the spine. */
  fold = w,
) {
  const src = sourceRect(img, crop);
  const sharp = document.createElement('canvas');
  sharp.width = w;
  sharp.height = h;
  const s = sharp.getContext('2d')!;
  // Zoomed in, by default to the part of the cover with the least lettering: mostly artwork.
  const scale = Math.max(w / src.w, h / src.h) * o.zoom;
  const sw = w / scale;
  const sh = h / scale;
  const at = focusAt(o.focus) ?? quietestBand(img, src, sh / src.h).at;
  const top = src.y + (src.h - sh) * at;
  const [fx, fy] = flipScale(o);
  s.translate(fx < 0 ? w : 0, fy < 0 ? h : 0);
  s.scale(fx, fy);
  s.drawImage(img, src.x + (src.w - sw) / 2, top, sw, sh, 0, 0, w, h);

  // Softened: a smooth blur at full resolution over a faint sharp copy, so lettering left reads as
  // texture while the artwork's shapes and colour are kept. 50% is about 2% of the width.
  if (o.blur > 0) {
    const soft = softBlur(sharp, w * 0.045 * o.blur);
    ctx.save();
    ctx.drawImage(sharp, 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(soft, 0, 0);
    ctx.restore();
  } else ctx.drawImage(sharp, 0, 0);

  if (o.darken > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${o.darken})`;
    ctx.fillRect(0, 0, w, h);
  }
  // Darker towards the spine, where a real back cover's artwork tucks into the fold.
  if (o.fold) {
    const shade = ctx.createLinearGradient(fold * 0.7, 0, fold, 0);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, fold, h);
  }
  // Fine grain, as on printed card.
  if (o.grain) {
    const rnd = mulberry32(seed);
    const dot = Math.max(1, w / 220);
    for (let i = 0; i < (w * h) / (dot * dot * 18); i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(rnd() * w, rnd() * h, dot, dot);
    }
  }
}

/**
 * Where, from 0 (top) to 1 (bottom), a band `share` of the cover's height has the least lettering.
 * Text is dense, sharp edges along each row; artwork is mostly smooth. Covers whose pixels cannot be
 * read (no CORS) get the lower middle, where artwork most often is.
 */
const bands = new WeakMap<HTMLImageElement, Map<string, { at: number; busy: number }>>();

export function quietestBand(
  img: HTMLImageElement,
  src: { x: number; y: number; w: number; h: number },
  share: number,
): { at: number; busy: number } {
  // The same for every redraw of a cover (only sliders change), so worked out once.
  const key = `${src.x},${src.y},${src.w},${src.h},${share.toFixed(3)}`;
  let byKey = bands.get(img);
  if (!byKey) bands.set(img, (byKey = new Map()));
  const known = byKey.get(key);
  if (known) return known;
  const found = scanBands(img, src, share);
  byKey.set(key, found);
  return found;
}

function scanBands(img: HTMLImageElement, src: { x: number; y: number; w: number; h: number }, share: number): { at: number; busy: number } {
  const cols = 96;
  const rows = 144;
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const g = c.getContext('2d')!;
  let data: Uint8ClampedArray;
  try {
    g.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, cols, rows);
    data = g.getImageData(0, 0, cols, rows).data;
  } catch {
    return { at: 0.7, busy: 0 };
  }
  const lum = (x: number, y: number) => {
    const p = 4 * (y * cols + x);
    return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  };
  const busy: number[] = [];
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    // Hard edges only: crisp lettering against its background, not the soft gradients of artwork.
    for (let x = 1; x < cols; x++) if (Math.abs(lum(x, y) - lum(x - 1, y)) > 48) sum++;
    busy.push(sum);
  }
  const size = Math.max(1, Math.round(rows * share));
  const at = bandWithLeast(busy, size);
  const start = Math.round(at * (rows - size));
  // Share of neighbouring pixels in the band with a hard edge between them: high for lettering.
  const band = busy.slice(start, start + size).reduce((a, b) => a + b, 0) / (size * (cols - 1));
  return { at, busy: band };
}

/** Where (0 to 1) a run of `size` consecutive values has the smallest total, among `values`. */
export function bandWithLeast(values: number[], size: number): number {
  if (size >= values.length) return 0.5;
  let sum = values.slice(0, size).reduce((a, b) => a + b, 0);
  let best = sum;
  let at = 0;
  for (let i = size; i < values.length; i++) {
    sum += values[i] - values[i - size];
    if (sum < best) {
      best = sum;
      at = i - size + 1;
    }
  }
  return at / (values.length - size);
}

export interface LabelOptions {
  /** Set when the cover image is complete back + spine + front artwork. Nothing is generated. */
  wrapSpine?: WrapSpine;
  /** Trims the cover image's edges before it is used. */
  crop?: Crop;
  /** Canvas resolution. Lower it for on-screen thumbnails. */
  pxPerMm?: number;
  /** What goes on the back cover; placeholder blurb if not given. */
  back?: BackStyle;
  /** Fine control of the back and spine; defaults for anything not given. */
  backOptions?: Partial<BackOptions>;
}

export function drawLabel(
  canvas: HTMLCanvasElement,
  book: Book,
  cover: HTMLImageElement | null,
  dims: Pick<Settings, 'height' | 'width' | 'spine'>,
  style: LabelStyle,
  options: LabelOptions = {},
) {
  const { wrapSpine, crop = NO_CROP, pxPerMm = PRINT_PX_PER_MM, back = 'blurb' } = options;
  const o = resolveBack(back, options.backOptions);
  const coverW = Math.round(dims.width * pxPerMm);
  const spineW = Math.round(dims.spine * pxPerMm);
  const h = Math.round(dims.height * pxPerMm);
  const frontX = coverW + spineW;
  canvas.width = frontX + coverW;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (cover && wrapSpine) {
    // Artwork panels rarely share the label's proportions, so each is stretched onto its own
    // label panel. Cropping instead would cut off titles that run edge to edge.
    const src = sourceRect(cover, crop);
    // Spine positions are fractions of the untrimmed image, so trimming never moves the spine.
    const l = cover.naturalWidth * wrapSpine.left;
    const r = cover.naturalWidth * wrapSpine.right;
    ctx.drawImage(cover, src.x, src.y, l - src.x, src.h, 0, 0, coverW, h);
    ctx.drawImage(cover, l, src.y, r - l, src.h, coverW, 0, spineW, h);
    ctx.drawImage(cover, r, src.y, src.x + src.w - r, src.h, frontX, 0, coverW, h);
    return;
  }
  const fallback = colorFromText(book.title);

  let ink: Rgb;
  if (style === 'blur' && cover) {
    // The cover heavily blurred (smoothly, at full resolution) across the back and spine. Drawn small
    // first, as so much blur needs no detail, then blurred and stretched; the blur hides the stretch.
    const base = document.createElement('canvas');
    base.width = Math.max(16, Math.round(frontX / 4));
    base.height = Math.max(16, Math.round(h / 4));
    drawCoverFit(base.getContext('2d')!, cover, crop, 0, 0, base.width, base.height);
    const blurred = softBlur(base, base.width * 0.12);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    // Mirrored so the colours next to the front cover continue from its left edge.
    ctx.translate(frontX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(blurred, 0, 0, frontX, h);
    ctx.restore();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, frontX, h);
    ink = WHITE;
  } else {
    const base = (cover && edgeColor(cover, crop)) ?? fallback;
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, frontX, h);
    ink = textColorOn(base);
  }

  if (cover) drawCoverFit(ctx, cover, crop, frontX, 0, coverW, h);
  else drawGeneratedCover(ctx, book, fallback, frontX, coverW, h);

  // The artwork back needs a cover image; a generated cover gets the placeholder blurb instead.
  const seed = hashString(book.title);
  // Across the spine too, if asked, at the artwork's own proportions, so its graphics wrap round.
  const artSpine = back === 'mirror' && cover !== null && o.artSpine;
  if (back === 'mirror' && cover) drawArtworkBack(ctx, cover, crop, artSpine ? frontX : coverW, h, seed, o, coverW);
  else if (back === 'notes') drawNotes(ctx, book, ink, coverW, h, o);
  else if (back === 'blurb' || back === 'mirror') {
    if (o.blurb) drawBlurb(ctx, ink, seed, coverW, h);
  }
  // Smaller over artwork, where it should not take over.
  if (o.barcode) drawBarcode(ctx, mulberry32(seed + 1), coverW, h, back === 'mirror' ? 0.3 : 0.38);
  if (o.spineText) drawSpine(ctx, book, ink, coverW, spineW, h, artSpine);

  // Faint fold guides on both spine edges.
  ctx.fillStyle = css(ink, 0.15);
  ctx.fillRect(coverW - 1, 0, 2, h);
  ctx.fillRect(frontX - 1, 0, 2, h);
}
