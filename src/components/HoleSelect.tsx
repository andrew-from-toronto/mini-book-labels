import { useState } from 'react';
import { DEFAULT_HOLE, HOLE_RANGE, HOLE_SIZES, validHole } from '../lib/hook';
import type { ModelOptions } from '../lib/types';

const HOLE_LABELS: Record<number, string> = { 1.6: '1.6 mm · wire hook', 3: '3 mm · twine, ribbon' };
const isPreset = (mm: number) => (HOLE_SIZES as readonly number[]).includes(mm);

/** The hook's hole size: a preset, or a custom size in mm. */
export function HoleSelect({
  options,
  onChange,
  onValid,
}: {
  options: ModelOptions;
  onChange: (patch: Partial<ModelOptions>) => void;
  /** Whether the hole shown is one that gets ordered: false while a custom size is out of range. */
  onValid?: (ok: boolean) => void;
}) {
  const hole = options.holeSize ?? DEFAULT_HOLE;
  const [custom, setCustom] = useState(!isPreset(hole));
  const [draft, setDraft] = useState(String(hole));
  const typed = Math.round(Number(draft) * 10) / 10;

  return (
    <>
      <label>
        Hole
        <select
          value={custom ? 'custom' : String(hole)}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true);
              setDraft(String(hole));
              return;
            }
            setCustom(false);
            onValid?.(true);
            onChange({ holeSize: Number(e.target.value) });
          }}
        >
          {HOLE_SIZES.map((size) => (
            <option key={size} value={size}>
              {HOLE_LABELS[size] ?? `${size} mm`}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {custom && (
        <label>
          Hole (mm)
          <input
            type="number"
            inputMode="decimal"
            min={HOLE_RANGE.min}
            max={HOLE_RANGE.max}
            step={0.1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const mm = Math.round(Number(e.target.value) * 10) / 10;
              onValid?.(validHole(mm));
              if (validHole(mm)) onChange({ holeSize: mm });
            }}
          />
          {!validHole(typed) && (
            <span className="error">
              {HOLE_RANGE.min}-{HOLE_RANGE.max} mm
            </span>
          )}
        </label>
      )}
    </>
  );
}
