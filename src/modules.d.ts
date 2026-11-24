// Libraries without type declarations of their own: only what the app uses.

declare module 'opentype.js' {
  const opentype: { parse(buffer: ArrayBuffer): unknown };
  export default opentype;
}

declare module 'lcms-wasm' {
  export interface Lcms {
    cmsOpenProfileFromMem(data: Uint8Array, size: number): number;
    cmsCreate_sRGBProfile(): number;
    cmsCloseProfile(profile: number): void;
    cmsCreateTransform(input: number, inFormat: number, output: number, outFormat: number, intent: number, flags: number): number;
    cmsDeleteTransform(transform: number): void;
    cmsDoTransform(transform: number, input: Uint8Array, pixels: number): Uint8Array;
    cmsGetColorSpaceASCII(profile: number): string | null;
    cmsGetProfileInfoASCII(profile: number, info: number, language: string, country: string): string;
  }
  export function instantiate(options?: { locateFile?: (name: string) => string }): Promise<Lcms>;
  export const TYPE_RGB_8: number;
  export const TYPE_CMYK_8: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const INTENT_PERCEPTUAL: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsInfoDescription: number;
}
