export type Rgb = [number, number, number];

export const css = ([r, g, b]: Rgb, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 0.179 is where black and white text have equal WCAG contrast against the background. */
export const textColorOn = (bg: Rgb): Rgb => (luminance(bg) > 0.179 ? [24, 24, 24] : [250, 250, 250]);

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export const colorFromText = (text: string): Rgb => hslToRgb(hashString(text) % 360, 0.35, 0.32);

export function averageColor(rgba: ArrayLike<number>): Rgb {
  const sum = [0, 0, 0];
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    sum[0] += rgba[i];
    sum[1] += rgba[i + 1];
    sum[2] += rgba[i + 2];
  }
  return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
