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
