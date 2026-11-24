import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { saveCustomProfile, savedCustomProfile } from '../lib/cmyk';
import type { CoverResult } from '../lib/covers';
import { PAPER, sheetLayout } from '../lib/layout';
import {
  applyPreset,
  cutterSettings,
  formatMm,
  leavesPreset,
  outputMode,
  SHEETS,
  SHOP_PRESETS,
  shopGap,
  shopSettings,
  withOutput,
  labelCut,
  type CutLine,
  type CutterSettings,
  type OutputMode,
  type ShopSettings,
} from '../lib/output';
import { cricutWidths, makeFiles, shopWarnings, type Download } from '../lib/printFiles';
import type { Book, CustomCover, PaperKey, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  pages: Book[][];
  labelCount: number;
  coverOf: (book: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
}

const MODES: [OutputMode, string][] = [
  ['home', 'My printer'],
  ['shop', 'A print shop (PDF)'],
  ['cricut', 'Cricut Print Then Cut'],
  ['silhouette', 'Silhouette Print & Cut'],
];

const cutSummary = (line: CutLine) => (line.ink === 'spot' ? `${line.name} spot colour` : `100% ${line.ink}`);

const megabytes = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

/** A file made in this browser, offered as a link (one click each, so no multiple-download prompt). */
interface Made extends Download {
  url: string;
}

export function OutputPanel({ settings, onChange, pages, labelCount, coverOf, customCovers }: Props) {
  const mode = outputMode(settings);
  const shop = shopSettings(settings);
  const cutter = cutterSettings(settings);
  const layout = sheetLayout(settings);
  const [made, setMade] = useState<Made[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  // Covers keep arriving while files are made; the export always reads the latest.
  const latestCover = useRef(coverOf);
  latestCover.current = coverOf;
  const [customName, setCustomName] = useState(() => savedCustomProfile()?.name ?? null);

  // Files made for other settings or books are stale: drop them.
  const key = JSON.stringify([settings, pages.map((p) => p.map((b) => b.id))]);
  const madeKey = useRef(key);
  useEffect(() => {
    if (madeKey.current === key) return;
    madeKey.current = key;
    setMade((m) => {
      m.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    setError('');
  }, [key]);
  useEffect(() => () => made.forEach((f) => URL.revokeObjectURL(f.url)), [made]);

  const warnings = useMemo(() => (mode === 'shop' && shop.warnings ? shopWarnings(settings, shop, layout) : []), [mode, settings, shop, layout]);

  const setMode = (m: OutputMode) => onChange(withOutput(settings, { mode: m }));
  const setShop = (patch: Partial<ShopSettings>) => {
    let next = { ...shop, ...patch };
    if (shop.preset !== 'custom' && !('preset' in patch) && leavesPreset(shop, next)) next = { ...next, preset: 'custom' };
    onChange(withOutput(settings, { shop: next }));
  };
  const setCutter = (patch: Partial<CutterSettings>) => onChange(withOutput(settings, { cutter: { ...cutter, ...patch } }));

  async function make() {
    setError('');
    setBusy({ done: 0, total: labelCount });
    try {
      const files = await makeFiles({ pages, coverOf: (b) => latestCover.current(b), customCovers, settings }, (done, total) => setBusy({ done, total }));
      setMade((old) => {
        old.forEach((f) => URL.revokeObjectURL(f.url));
        return files.map((f) => ({ ...f, url: URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.type })) }));
      });
      madeKey.current = key;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const num = (label: ReactNode, value: number, onValue: (v: number) => void, min = 0, step = 0.1) => (
    <label>
      {label}
      <input type="number" min={min} step={step} value={Number(value.toFixed(2))} onChange={(e) => onValue(Math.max(min, Number(e.target.value) || 0))} />
    </label>
  );
  const check = (key: 'cropMarks' | 'slug' | 'sheetCut' | 'pullIn' | 'warnings', label: string) => (
    <label className="check">
      <input type="checkbox" checked={shop[key]} onChange={(e) => setShop({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  const cutLine = (which: 'kiss' | 'thru', title: string) => {
    const line = shop[which];
    const set = (patch: Partial<CutLine>) => setShop({ [which]: { ...line, ...patch } });
    return (
      <div className="cut-line-fields">
        <span className="field-title">{title}</span>
        <div className="row">
          <label>
            Marked as
            <select value={line.ink} onChange={(e) => set({ ink: e.target.value as CutLine['ink'] })}>
              <option value="spot">Spot colour</option>
              <option value="magenta">100% magenta</option>
              <option value="cyan">100% cyan</option>
            </select>
          </label>
          {line.ink === 'spot' && (
            <label>
              Spot colour name
              <input type="text" value={line.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
          )}
        </div>
        <div className="row">
          <label>
            Layer
            <input type="text" value={line.layer} onChange={(e) => set({ layer: e.target.value })} />
          </label>
          {num('Line (pt)', line.weight, (v) => set({ weight: v }), 0.05, 0.05)}
        </div>
      </div>
    );
  };

  const sheets = pages.length;
  const summary =
    layout.perPage === 0 ? (
      <p className="error">A label does not fit with these sizes and margins.</p>
    ) : (
      <p className="muted">
        {labelCount} labels on {sheets} {mode === 'cricut' ? (sheets === 1 ? 'image' : 'images') : sheets === 1 ? 'sheet' : 'sheets'} ({layout.cols} × {layout.rows} a{' '}
        {mode === 'cricut' ? 'image' : 'sheet'}).
      </p>
    );

  const downloadButton = (text: string) => (
    <>
      <button className="primary" disabled={pages.length === 0 || busy !== null} onClick={() => void make()}>
        {busy ? `Drawing label ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…` : text}
      </button>
      {error && <p className="error">{error}</p>}
      {made.length > 0 && (
        <ul className="made-files">
          {made.map((f) => (
            <li key={f.name}>
              <a href={f.url} download={f.name}>
                {f.name}
              </a>{' '}
              <span className="muted">{megabytes(f.data.length)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="fields output-panel">
      <label>
        Print with
        <select value={mode} onChange={(e) => setMode(e.target.value as OutputMode)}>
          {MODES.map(([m, label]) => (
            <option key={m} value={m}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {mode === 'home' && (
        <>
          {layout.perPage === 0 ? (
            <p className="error">A label does not fit on the page with these sizes and margins.</p>
          ) : (
            <p className="muted">
              {labelCount} labels on {sheets} {sheets === 1 ? 'page' : 'pages'} ({layout.cols} x {layout.rows} per page). Print at 100% scale ("Actual
              size"), then check the 50 mm ruler.
            </p>
          )}
          <button className="primary" disabled={pages.length === 0} onClick={() => window.print()}>
            Print sheet
          </button>
        </>
      )}

      {mode === 'shop' && (
        <>
          <label>
            Shop setup
            <select
              value={shop.preset}
              onChange={(e) => onChange(withOutput(settings, { shop: applyPreset(shop, e.target.value as ShopSettings['preset']) }))}
            >
              {Object.entries(SHOP_PRESETS).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Cut
            <select value={shop.cut} onChange={(e) => setShop({ cut: e.target.value as ShopSettings['cut'] })}>
              <option value="kiss">Kiss cut: a sheet of peel-off labels</option>
              <option value="die">Die cut: loose labels</option>
            </select>
          </label>
          <div className="row">
            <label>
              Sheet
              <select value={shop.sheet} onChange={(e) => setShop({ sheet: e.target.value as ShopSettings['sheet'] })}>
                {Object.entries(SHEETS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </select>
            </label>
            {num('Margin (mm)', shop.margin, (v) => setShop({ margin: v }))}
          </div>
          {shop.sheet === 'custom' && (
            <div className="row">
              {num('Sheet width (mm)', shop.sheetW, (v) => setShop({ sheetW: v }), 20)}
              {num('Sheet height (mm)', shop.sheetH, (v) => setShop({ sheetH: v }), 20)}
            </div>
          )}
          <div className="row">
            {num('Bleed (mm)', shop.bleed, (v) => setShop({ bleed: v }))}
            {num('Safe zone (mm)', shop.safe, (v) => setShop({ safe: v }))}
          </div>
          <div className="row">
            <label>
              Spacing
              <select value={shop.spacing} onChange={(e) => setShop({ spacing: e.target.value as ShopSettings['spacing'] })}>
                <option value="gap">Apart</option>
                <option value="shared" disabled={shop.minSpacing > 0}>
                  Touching
                </option>
              </select>
            </label>
            {shop.spacing === 'gap' && num('Gap (mm)', shopGap(shop), (v) => setShop({ gap: v }), Math.max(2 * shop.bleed, shop.minSpacing))}
          </div>
          <label>
            Bleed fill
            <select value={shop.bleedFill} onChange={(e) => setShop({ bleedFill: e.target.value as ShopSettings['bleedFill'] })}>
              <option value="extend">Extend the artwork</option>
              <option value="mirror">Mirror the edges</option>
              <option value="stretch">Stretch the edges</option>
            </select>
          </label>

          <details className="output-details">
            <summary>
              Cut lines: {cutSummary(labelCut(shop))}
            </summary>
            {cutLine('kiss', 'Kiss cut')}
            {cutLine('thru', 'Thru-cut (die cut and sheet edge)')}
            <label>
              Artwork layer
              <input type="text" value={shop.artworkLayer} onChange={(e) => setShop({ artworkLayer: e.target.value })} />
            </label>
          </details>

          <fieldset>
            <legend>Colour</legend>
            <div className="row">
              <label>
                Colour
                <select value={shop.colour} onChange={(e) => setShop({ colour: e.target.value as ShopSettings['colour'] })}>
                  <option value="rgb">RGB</option>
                  <option value="cmyk">CMYK</option>
                </select>
              </label>
              {shop.colour === 'rgb' ? (
                <label>
                  Images
                  <select value={shop.images} onChange={(e) => setShop({ images: e.target.value as ShopSettings['images'] })}>
                    <option value="jpeg">JPEG</option>
                    <option value="lossless">Lossless</option>
                  </select>
                </label>
              ) : (
                <label>
                  Profile
                  <select value={shop.profile} onChange={(e) => setShop({ profile: e.target.value as ShopSettings['profile'] })}>
                    <option value="gracol">GRACoL 2013 (North America)</option>
                    <option value="fogra39">FOGRA39 (Europe)</option>
                    <option value="custom">The shop's own</option>
                  </select>
                </label>
              )}
            </div>
            <p className="muted">{shop.colour === 'cmyk' ? 'Coated stock, lossless, 400 dpi.' : 'Tagged sRGB, about 600 dpi. The shop converts to CMYK.'}</p>
            {shop.colour === 'cmyk' && shop.profile === 'custom' && (
              <label className="file-field">
                {customName ? `Profile: ${customName}. Choose another .icc file` : 'Choose the .icc file'}
                <input
                  type="file"
                  accept=".icc,.icm"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    saveCustomProfile(file).then(
                      (p) => {
                        setCustomName(p.name);
                        setError('');
                      },
                      (err) => setError(err instanceof Error ? err.message : String(err)),
                    );
                  }}
                />
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend>Marks and checks</legend>
            {check('cropMarks', 'Crop marks')}
            {check('slug', 'Slug line with the sheet details')}
            {check('sheetCut', "Thru-cut round the sheet's edge")}
            {check('pullIn', 'Keep text inside the safe zone')}
            {check('warnings', 'Show checks')}
          </fieldset>

          {warnings.length > 0 && (
            <ul className="print-warnings">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {summary}
          <p className="muted">
            Bleed {formatMm(shop.bleed)}. The print file goes to the shop; the proof is for checking.
          </p>
          {downloadButton('Make print file and proof')}
        </>
      )}

      {mode === 'cricut' && (
        <>
          <p className="note">Untested on a real Cricut.</p>
          {num('Gap between labels (mm)', cutter.gap, (v) => setCutter({ gap: v }), 2)}
          {summary}
          {pages.length > 0 && (
            <p className="muted">
              Widths to set in Design Space:{' '}
              {cricutWidths(settings, pages)
                .map((w, i) => `image ${i + 1}, ${Number(w.toFixed(1))} mm (${(w / 25.4).toFixed(2)} in)`)
                .join('; ')}
              . Design Space adds the bleed.
            </p>
          )}
          {downloadButton('Make Cricut images')}
        </>
      )}

      {mode === 'silhouette' && (
        <>
          <p className="note">Untested on a real Silhouette.</p>
          <div className="row">
            <label>
              Paper
              <select value={settings.paper} onChange={(e) => onChange({ ...settings, paper: e.target.value as PaperKey })}>
                {Object.entries(PAPER).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {num('Margin (mm)', cutter.margin, (v) => setCutter({ margin: v }))}
          </div>
          <div className="row">
            {num('Bleed (mm)', cutter.bleed, (v) => setCutter({ bleed: v }))}
            {num('Gap (mm)', cutter.gap, (v) => setCutter({ gap: v }))}
          </div>
          {summary}
          <p className="muted">A PNG of each page, its cut lines as DXF, and both together as SVG.</p>
          {downloadButton('Make Silhouette files')}
        </>
      )}
    </div>
  );
}
