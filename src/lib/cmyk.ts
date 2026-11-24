/**
 * RGB to CMYK for print shop files, with LittleCMS (WebAssembly) and a press profile: GRACoL 2013 for
 * North American coated stock, FOGRA39 for European, or a shop's own .icc. Loaded only when a CMYK file
 * is made. Relative colorimetric with black point compensation, the usual choice for artwork.
 */

export type ProfileKey = 'gracol' | 'fogra39' | 'custom';

export interface Profile {
  /** As written in the file's output intent, e.g. "GRACoL2013_CRPC6". */
  name: string;
  bytes: Uint8Array;
}

const BUILT_IN: Record<Exclude<ProfileKey, 'custom'>, { file: string; name: string; condition: string }> = {
  gracol: { file: 'GRACoL2013_CRPC6.icc', name: 'GRACoL2013_CRPC6', condition: 'CGATS 21-2 CRPC6' },
  fogra39: { file: 'FOGRA39L_coated.icc', name: 'FOGRA39L_coated', condition: 'FOGRA39' },
};

/** The characterisation a built-in profile was made for, for the output intent's condition identifier. */
export const conditionOf = (key: ProfileKey, profile: Profile) =>
  key === 'custom' ? profile.name : BUILT_IN[key].condition;

const CUSTOM_KEY = 'mini-book-labels:icc';

/** A shop's own profile, kept in this browser. */
export function savedCustomProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const { name, data } = JSON.parse(raw) as { name: string; data: string };
    return { name, bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) };
  } catch {
    return null;
  }
}

/** Checks a .icc file is a CMYK output profile, then keeps it in this browser. Returns its description. */
export async function saveCustomProfile(file: File): Promise<Profile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lcms = await engine();
  const handle = lcms.module.cmsOpenProfileFromMem(bytes, bytes.length);
  if (!handle) throw new Error('That file is not an ICC profile.');
  try {
    if (lcms.module.cmsGetColorSpaceASCII(handle) !== 'CMYK') throw new Error('That profile is not a CMYK profile.');
    const description = lcms.module.cmsGetProfileInfoASCII(handle, lcms.cmsInfoDescription, 'en', 'US').trim();
    const profile = { name: description || file.name.replace(/\.ic[cm]$/i, ''), bytes };
    try {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(CUSTOM_KEY, JSON.stringify({ name: profile.name, data: btoa(binary) }));
    } catch {
      /* too big for storage or storage blocked: it still works until the page is reloaded */
    }
    memoryCustom = profile;
    return profile;
  } finally {
    lcms.module.cmsCloseProfile(handle);
  }
}

let memoryCustom: Profile | null = null;

export async function loadProfile(key: ProfileKey): Promise<Profile> {
  if (key === 'custom') {
    const p = memoryCustom ?? savedCustomProfile();
    if (!p) throw new Error('Choose a .icc profile file first.');
    return p;
  }
  const { file, name } = BUILT_IN[key];
  const res = await fetch(`${import.meta.env.BASE_URL}icc/${file}`);
  if (!res.ok) throw new Error(`The ${name} colour profile did not load.`);
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** The sRGB profile images are tagged with in RGB files. */
export async function loadSrgb(): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}icc/sRGB.icc`);
  if (!res.ok) throw new Error('The sRGB colour profile did not load.');
  return new Uint8Array(await res.arrayBuffer());
}

type Engine = { module: import('lcms-wasm').Lcms; cmsInfoDescription: number; consts: typeof import('lcms-wasm') };
let loading: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  loading ??= (async () => {
    const [lib, wasm] = await Promise.all([import('lcms-wasm'), import('lcms-wasm/dist/lcms.wasm?url')]);
    const module = await lib.instantiate({ locateFile: () => wasm.default });
    return { module, cmsInfoDescription: lib.cmsInfoDescription, consts: lib };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Converts RGBA pixels (alpha ignored) to CMYK, 4 bytes a pixel, through `profile`. */
export async function rgbaToCmyk(rgba: Uint8ClampedArray, profile: Profile): Promise<Uint8Array> {
  const { module: m, consts } = await engine();
  const srgb = m.cmsCreate_sRGBProfile();
  const out = m.cmsOpenProfileFromMem(profile.bytes, profile.bytes.length);
  if (!out) throw new Error(`The ${profile.name} profile could not be read.`);
  const transform = m.cmsCreateTransform(srgb, consts.TYPE_RGB_8, out, consts.TYPE_CMYK_8, consts.INTENT_RELATIVE_COLORIMETRIC, consts.cmsFLAGS_BLACKPOINTCOMPENSATION);
  try {
    if (!transform) throw new Error(`The ${profile.name} profile cannot convert from RGB.`);
    const pixels = rgba.length / 4;
    const cmyk = new Uint8Array(pixels * 4);
    // In chunks, so the WebAssembly heap stays small.
    const CHUNK = 1 << 18;
    const rgb = new Uint8Array(Math.min(pixels, CHUNK) * 3);
    for (let start = 0; start < pixels; start += CHUNK) {
      const n = Math.min(CHUNK, pixels - start);
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = rgba[(start + i) * 4];
        rgb[i * 3 + 1] = rgba[(start + i) * 4 + 1];
        rgb[i * 3 + 2] = rgba[(start + i) * 4 + 2];
      }
      cmyk.set(m.cmsDoTransform(transform, rgb.subarray(0, n * 3), n), start * 4);
    }
    return cmyk;
  } finally {
    if (transform) m.cmsDeleteTransform(transform);
    m.cmsCloseProfile(out);
    m.cmsCloseProfile(srgb);
  }
}
