/**
 * Hook hole sizes offered, in mm: the default fits wire ornament hooks and thread, the larger twine and
 * thin ribbon. Kept apart from the model code so the Worker can read order codes without it.
 */
export const HOLE_SIZES = [1.6, 3] as const;
export const DEFAULT_HOLE = HOLE_SIZES[0];
