/**
 * Hook hole sizes, in mm: two presets (the default fits wire ornament hooks and thread, the larger twine and
 * thin ribbon), or any custom size in HOLE_RANGE. Kept apart from the model code so the Worker can read
 * order codes without it.
 */
export const HOLE_SIZES = [1.6, 3] as const;
export const DEFAULT_HOLE = HOLE_SIZES[0];

/** Custom holes, mm: the smallest a printer makes cleanly, to one for thick twine or ribbon. */
export const HOLE_RANGE = { min: 1, max: 5 };

/** A hole size we print: within the range, in tenths of a millimetre. */
export const validHole = (mm: number) =>
  Number.isFinite(mm) && mm >= HOLE_RANGE.min && mm <= HOLE_RANGE.max && Math.abs(mm * 10 - Math.round(mm * 10)) < 1e-9;
