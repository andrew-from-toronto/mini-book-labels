/**
 * Filament colours blanks are printed in. Add a colour here and it appears in the order view, in the
 * order code and in admin. `swatch` is the colour shown on screen and in the 3D preview.
 */
export interface Filament {
  id: string;
  name: string;
  swatch: string;
  /** Turn off to stop offering a colour without breaking older orders that used it. */
  available: boolean;
}

export const FILAMENTS: Filament[] = [
  { id: 'white', name: 'White', swatch: '#f1efea', available: true },
  { id: 'black', name: 'Black', swatch: '#2a2a2e', available: true },
];

export const DEFAULT_FILAMENT = FILAMENTS[0].id;

export const filamentById = (id: string) => FILAMENTS.find((f) => f.id === id);

/** Whether a swatch colour is dark, so a preview can sit it on a light background to stay visible. */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived brightness (Rec. 601 weights), 0 to 255.
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}
