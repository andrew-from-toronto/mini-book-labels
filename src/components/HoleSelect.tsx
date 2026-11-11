import { DEFAULT_HOLE, HOLE_SIZES } from '../lib/hook';
import type { ModelOptions } from '../lib/types';

const HOLE_LABELS: Record<number, string> = { 1.6: '1.6 mm · wire hook', 3: '3 mm · twine, ribbon' };

/** The hook's hole size. */
export function HoleSelect({ options, onChange }: { options: ModelOptions; onChange: (patch: Partial<ModelOptions>) => void }) {
  return (
    <label>
      Hole
      <select value={options.holeSize ?? DEFAULT_HOLE} onChange={(e) => onChange({ holeSize: Number(e.target.value) })}>
        {HOLE_SIZES.map((size) => (
          <option key={size} value={size}>
            {HOLE_LABELS[size] ?? `${size} mm`}
          </option>
        ))}
      </select>
    </label>
  );
}
