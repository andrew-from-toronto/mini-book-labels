import { PAPER } from '../lib/layout';
import type { LabelStyle, PaperKey, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

type NumericKey = 'height' | 'width' | 'spine' | 'margin' | 'gap';

export function SettingsPanel({ settings, onChange }: Props) {
  const num = (key: NumericKey, label: string, min: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        step={0.5}
        value={settings[key]}
        onChange={(e) => onChange({ ...settings, [key]: Math.max(min, Number(e.target.value) || min) })}
      />
    </label>
  );

  return (
    <div className="fields">
      <div className="row">
        {num('height', 'Cover height (mm)', 5)}
        {num('width', 'Cover width (mm)', 5)}
        {num('spine', 'Spine (mm)', 1)}
      </div>
      <label>
        Spine and back style
        <select value={settings.style} onChange={(e) => onChange({ ...settings, style: e.target.value as LabelStyle })}>
          <option value="edge">Solid colour from the cover edge</option>
          <option value="blur">Blurred cover artwork</option>
        </select>
      </label>
      <div className="row">
        <label>
          Paper
          <select value={settings.paper} onChange={(e) => onChange({ ...settings, paper: e.target.value as PaperKey })}>
            {Object.entries(PAPER).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {num('margin', 'Margin (mm)', 0)}
        {num('gap', 'Gap (mm)', 0)}
      </div>
    </div>
  );
}
