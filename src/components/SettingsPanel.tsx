import { useState } from 'react';
import { PAPER } from '../lib/layout';
import { dimsAtScale, matchingScale, resizeProportionally, SCALES, type Dims } from '../lib/scales';
import type { LabelStyle, PaperKey, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

type NumericKey = 'height' | 'width' | 'spine' | 'margin' | 'gap';

const isDim = (key: NumericKey): key is keyof Dims => key === 'height' || key === 'width' || key === 'spine';

export function SettingsPanel({ settings, onChange }: Props) {
  const [locked, setLocked] = useState(false);

  const num = (key: NumericKey, label: string, min: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        step={0.1}
        value={settings[key]}
        onChange={(e) => {
          const value = Math.max(min, Number(e.target.value) || min);
          onChange(
            locked && isDim(key)
              ? { ...settings, ...resizeProportionally(settings, key, value) }
              : { ...settings, [key]: value },
          );
        }}
      />
    </label>
  );

  return (
    <div className="fields">
      <label>
        Scale
        <select
          value={matchingScale(settings) ?? ''}
          onChange={(e) => e.target.value && onChange({ ...settings, ...dimsAtScale(Number(e.target.value)) })}
        >
          <option value="">Custom size</option>
          {SCALES.map(({ ratio, note }) => (
            <option key={ratio} value={ratio}>
              1:{ratio}
              {note ? ` (${note})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        {num('height', 'Cover height (mm)', 5)}
        {num('width', 'Cover width (mm)', 5)}
        {num('spine', 'Spine (mm)', 1)}
      </div>
      <label className="check">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        Keep proportions when resizing
      </label>
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
      <label>
        Alignment guide opacity: {Math.round(settings.guideOpacity * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.guideOpacity}
          onChange={(e) => onChange({ ...settings, guideOpacity: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
