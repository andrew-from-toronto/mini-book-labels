import { DEFAULT_HOLE, HOLE_SIZES } from '../lib/hook';
import type { ModelOptions } from '../lib/types';

const HOLE_LABELS: Record<number, string> = { 1.6: '1.6 mm · wire hook', 3: '3 mm · twine, ribbon' };

/** Rarely needed hook settings, folded away: the hole size. */
export function HookAdvanced({ options, onChange }: { options: ModelOptions; onChange: (patch: Partial<ModelOptions>) => void }) {
  const hole = options.holeSize ?? DEFAULT_HOLE;
  return (
    <details className="advanced" open={hole !== DEFAULT_HOLE}>
      <summary>Advanced</summary>
      <label>
        Hole
        <select value={hole} onChange={(e) => onChange({ holeSize: Number(e.target.value) })}>
          {HOLE_SIZES.map((size) => (
            <option key={size} value={size}>
              {HOLE_LABELS[size] ?? `${size} mm`}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}
