import { useState } from 'react';
import { PAPER } from '../lib/layout';
import { outputMode } from '../lib/output';
import { dimsAtScale, matchingScale, resizeProportionally, SCALES, type Dims } from '../lib/scales';
import { resolveBack, type BackOptions, type Focus } from '../lib/back';
import type { BackStyle, LabelStyle, PaperKey, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

type NumericKey = 'height' | 'width' | 'spine' | 'margin' | 'gap';

const isDim = (key: NumericKey): key is keyof Dims => key === 'height' || key === 'width' || key === 'spine';

export function SettingsPanel({ settings, onChange }: Props) {
  const [locked, setLocked] = useState(false);
  const back = settings.back ?? 'blurb';
  const o = resolveBack(back, settings.backOptions);
  const setBack = (patch: Partial<BackOptions>) => onChange({ ...settings, backOptions: { ...settings.backOptions, ...patch } });
  type Toggle = 'mirror' | 'upsideDown' | 'artSpine' | 'fold' | 'grain' | 'blurb' | 'barcode' | 'showTitle' | 'showRating' | 'showDate' | 'spineText';
  const check = (key: Toggle, label: string) => (
    <label className="check">
      <input type="checkbox" checked={o[key]} onChange={(e) => setBack({ [key]: e.target.checked })} />
      {label}
    </label>
  );

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
      <label>
        Back cover
        <select value={settings.back ?? 'blurb'} onChange={(e) => onChange({ ...settings, back: e.target.value as BackStyle })}>
          <option value="blurb">Placeholder blurb and barcode</option>
          <option value="mirror">Front cover mirrored, softened</option>
          <option value="notes">Your rating and date read</option>
          <option value="plain">Plain</option>
        </select>
      </label>
      <fieldset className="back-options">
        <legend>Back cover and spine details</legend>
        {back === 'mirror' && (
          <>
            {check('mirror', 'Mirror left to right')}
            {check('upsideDown', 'Flip upside down')}
            {check('artSpine', 'Carry the artwork across the spine')}
            <label>
              Zoom: {o.zoom.toFixed(1)}x{o.zoom === 1 ? ', the same scale as the front' : ''}
              <input type="range" min={1} max={3} step={0.1} value={o.zoom} onChange={(e) => setBack({ zoom: Number(e.target.value) })} />
            </label>
            <label>
              Part of the cover shown when zoomed in
              <select value={o.focus} disabled={o.zoom === 1} onChange={(e) => setBack({ focus: e.target.value as Focus })}>
                <option value="auto">The part with least lettering</option>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>
              Blur: {Math.round(o.blur * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={o.blur} onChange={(e) => setBack({ blur: Number(e.target.value) })} />
            </label>
            <label>
              Darken: {Math.round(o.darken * 100)}%
              <input type="range" min={0} max={0.6} step={0.02} value={o.darken} onChange={(e) => setBack({ darken: Number(e.target.value) })} />
            </label>
            {check('fold', 'Shade towards the spine')}
            {check('grain', 'Print grain')}
          </>
        )}
        {back === 'blurb' && check('blurb', 'Placeholder blurb lines')}
        {back === 'notes' && (
          <>
            {check('showTitle', 'Title and author')}
            {check('showRating', 'Star rating')}
            {check('showDate', 'Date read')}
          </>
        )}
        {check('barcode', 'Barcode')}
        {check('spineText', 'Title and author on the spine')}
        <button className="link" onClick={() => onChange({ ...settings, backOptions: undefined })}>
          Reset back to defaults
        </button>
      </fieldset>
      {outputMode(settings) === 'home' && (
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
      )}
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
      <label>
        Alignment guide width: {settings.guideWidth.toFixed(2)} mm, centred on the fold
        <input
          type="range"
          min={0.02}
          max={0.6}
          step={0.01}
          value={settings.guideWidth}
          onChange={(e) => onChange({ ...settings, guideWidth: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
