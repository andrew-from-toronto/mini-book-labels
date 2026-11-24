import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Field, InfoTip } from './InfoTip';
import { saveCustomProfile, savedCustomProfile } from '../lib/cmyk';
import type { CoverResult } from '../lib/covers';
import { PAPER, sheetLayout } from '../lib/layout';
import {
  applyPreset,
  cutterSettings,
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
import { coverCounts, cricutWidths, makeFiles, scaleText, shopWarnings, type Download } from '../lib/printFiles';
import { scrub, track } from '../lib/telemetry';
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
  ['shop', 'Print shop (PDF)'],
  ['cricut', 'Cricut Print Then Cut'],
  ['silhouette', 'Silhouette Print & Cut'],
];

const cutSummary = (line: CutLine) => (line.ink === 'spot' ? line.name : `100% ${line.ink}`);

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
    const started = performance.now();
    // Labels sent out: the north star (lib/usage.ts).
    const report = (ok: boolean, error = '') =>
      track('output', {
        mode,
        ok,
        // Messages name the book in quotes; titles never leave the browser.
        error: scrub(error).slice(0, 120),
        labels: labelCount,
        sheets: pages.length,
        ms: Math.round(performance.now() - started),
        scale: scaleText(settings),
        back: settings.back ?? 'blurb',
        style: settings.style,
        ...(mode === 'shop' && { preset: shop.preset, colour: shop.colour, cut: shop.cut }),
        ...coverCounts(pages.flat(), latestCover.current),
      });
    try {
      const files = await makeFiles({ pages, coverOf: (b) => latestCover.current(b), customCovers, settings }, (done, total) => setBusy({ done, total }));
      report(true);
      setMade((old) => {
        old.forEach((f) => URL.revokeObjectURL(f.url));
        return files.map((f) => ({ ...f, url: URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.type })) }));
      });
      madeKey.current = key;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      report(false, message);
    } finally {
      setBusy(null);
    }
  }

  const num = (label: string, value: number, onValue: (v: number) => void, min = 0, step = 0.1, tip?: ReactNode) => (
    <Field label={label} tip={tip}>
      {(id) => (
        <input id={id} type="number" min={min} step={step} value={Number((value + 1e-9).toFixed(2))} onChange={(e) => onValue(Math.max(min, Number(e.target.value) || 0))} />
      )}
    </Field>
  );
  const select = <T extends string>(label: string, value: T, options: [T, string, boolean?][], onValue: (v: T) => void, tip?: ReactNode) => (
    <Field label={label} tip={tip}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onValue(e.target.value as T)}>
          {options.map(([v, text, disabled]) => (
            <option key={v} value={v} disabled={disabled}>
              {text}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const text = (label: string, value: string, onValue: (v: string) => void) => (
    <Field label={label}>{(id) => <input id={id} type="text" value={value} onChange={(e) => onValue(e.target.value)} />}</Field>
  );
  const check = (key: 'cropMarks' | 'slug' | 'sheetCut' | 'pullIn' | 'warnings', label: string, tip?: ReactNode) => (
    <Check label={label} checked={shop[key]} onChange={(on) => setShop({ [key]: on })} tip={tip} />
  );
  const cutLine = (which: 'kiss' | 'thru', title: string) => {
    const line = shop[which];
    const set = (patch: Partial<CutLine>) => setShop({ [which]: { ...line, ...patch } });
    return (
      <div className="cut-line-fields">
        <span className="field-title">{title}</span>
        <div className="row">
          {select(
            'Marked as',
            line.ink,
            [
              ['spot', 'Spot colour'],
              ['magenta', '100% magenta'],
              ['cyan', '100% cyan'],
            ],
            (ink) => set({ ink }),
            'How the cutter finds the line. Most shops look for a named spot colour, often CutContour. Some want a plain magenta or cyan line instead.',
          )}
          {line.ink === 'spot' && text('Spot colour name', line.name, (name) => set({ name }))}
        </div>
        <div className="row">
          {text('Layer', line.layer, (layer) => set({ layer }))}
          {num('Line (pt)', line.weight, (weight) => set({ weight }), 0.05, 0.05)}
        </div>
      </div>
    );
  };

  const sheets = pages.length;
  const per = mode === 'cricut' ? 'image' : 'sheet';
  const summary =
    layout.perPage === 0 ? (
      <p className="error">A label does not fit with these sizes and margins.</p>
    ) : (
      <p className="muted">
        {labelCount} labels on {sheets} {sheets === 1 ? per : `${per}s`} ({layout.cols} × {layout.rows} a {per})
      </p>
    );

  const downloadButton = (label: string) => (
    <>
      <button className="primary" disabled={pages.length === 0 || busy !== null} onClick={() => void make()}>
        {busy ? `Drawing label ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…` : label}
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

  const bleedTip = 'Extra artwork past the cut line. If a cut lands a little outside the line, you see more of the cover instead of a white edge. It gets trimmed off.';

  return (
    <div className="fields output-panel">
      {select('Print with', mode, MODES, setMode)}

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
          {select(
            'Shop setup',
            shop.preset,
            [...Object.entries(SHOP_PRESETS).map(([k, p]): [ShopSettings['preset'], string] => [k as ShopSettings['preset'], p.label]), ['custom', 'Custom']],
            (preset) => onChange(withOutput(settings, { shop: applyPreset(shop, preset) })),
            'Shops expect cut lines set up their own way. Generic suits most local print shops. Changing a detail below makes it Custom.',
          )}
          {select(
            'Cut',
            shop.cut,
            [
              ['kiss', 'Kiss cut'],
              ['die', 'Die cut'],
            ],
            (cut) => setShop({ cut }),
            'Kiss cut goes through the label but not the backing, so you get a sheet to peel labels off. Die cut goes through both, so every label comes loose.',
          )}
          <div className="row">
            {select(
              'Sheet',
              shop.sheet,
              [...Object.entries(SHEETS).map(([k, v]): [ShopSettings['sheet'], string] => [k as ShopSettings['sheet'], v.label]), ['custom', 'Custom']],
              (sheet) => setShop({ sheet }),
            )}
            {num('Margin (mm)', shop.margin, (margin) => setShop({ margin }))}
          </div>
          {shop.sheet === 'custom' && (
            <div className="row">
              {num('Width (mm)', shop.sheetW, (sheetW) => setShop({ sheetW }), 20)}
              {num('Height (mm)', shop.sheetH, (sheetH) => setShop({ sheetH }), 20)}
            </div>
          )}
          <div className="row">
            {num('Bleed (mm)', shop.bleed, (bleed) => setShop({ bleed }), 0, 0.1, bleedTip)}
            {num(
              'Safe zone (mm)',
              shop.safe,
              (safe) => setShop({ safe }),
              0,
              0.1,
              "A cut can land a little inside the line too. Text closer to the edge than this could get trimmed. The label isn't made any smaller.",
            )}
          </div>
          <div className="row">
            {select(
              'Spacing',
              shop.spacing,
              [
                ['gap', 'Apart'],
                ['shared', 'Touching', shop.minSpacing > 0],
              ],
              (spacing) => setShop({ spacing }),
              "Apart leaves room for each label's bleed. Touching fits more on a sheet, with one cut between neighbours, but a cut that's slightly off can show a sliver of the next label.",
            )}
            {shop.spacing === 'gap' && num('Gap (mm)', shopGap(shop), (gap) => setShop({ gap }), Math.max(2 * shop.bleed, shop.minSpacing))}
          </div>
          {select(
            'Bleed fill',
            shop.bleedFill,
            [
              ['extend', 'Extend artwork'],
              ['mirror', 'Mirror'],
              ['stretch', 'Stretch'],
            ],
            (bleedFill) => setShop({ bleedFill }),
            "Extend uses more of the cover where the picture has it. Mirror reflects the label's edge outwards. Stretch repeats the edge colours.",
          )}

          <details className="output-details">
            <summary>Cut lines: {cutSummary(labelCut(shop))}</summary>
            {cutLine('kiss', 'Kiss cut')}
            {cutLine('thru', 'Thru-cut')}
            {text('Artwork layer', shop.artworkLayer, (artworkLayer) => setShop({ artworkLayer }))}
          </details>

          <fieldset>
            <legend>Colour</legend>
            <div className="row">
              {select(
                'Colour mode',
                shop.colour,
                [
                  ['rgb', 'RGB'],
                  ['cmyk', 'CMYK'],
                ],
                (colour) => setShop({ colour }),
                'RGB works for most shops: they convert it for their press. Pick CMYK if the shop asks for it.',
              )}
              {shop.colour === 'rgb'
                ? select(
                    'Images',
                    shop.images,
                    [
                      ['jpeg', 'JPEG'],
                      ['lossless', 'Lossless'],
                    ],
                    (images) => setShop({ images }),
                    'JPEG keeps the file small. Lossless is bigger, with the crispest small text.',
                  )
                : select(
                    'Profile',
                    shop.profile,
                    [
                      ['gracol', 'GRACoL 2013 (North America)'],
                      ['fogra39', 'FOGRA39 (Europe)'],
                      ['custom', "The shop's own"],
                    ],
                    (profile) => setShop({ profile }),
                    'Matches the colours to the press. If the shop gave you a profile file, use that.',
                  )}
            </div>
            {shop.colour === 'cmyk' && shop.profile === 'custom' && (
              <Field label="Profile file">
                {(id) => (
                  <>
                    <input
                      id={id}
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
                    {customName && <span className="muted">{customName}</span>}
                  </>
                )}
              </Field>
            )}
          </fieldset>

          <fieldset>
            <legend>Marks</legend>
            {check('cropMarks', 'Crop marks', 'Short lines in the margin that line up with each cut.')}
            {check('slug', 'Slug line', "A line of small print in the margin saying what's on the sheet.")}
            {check('sheetCut', 'Cut round the sheet', 'Cuts the sheet out too, for shops that print on bigger paper.')}
            {check(
              'pullIn',
              'Pull text in from the edge',
              "Moves the spine title, blurb and barcode inside the safe zone. Lettering that's part of a cover picture stays where it is.",
            )}
            {check('warnings', 'Warnings')}
          </fieldset>

          {warnings.length > 0 && (
            <ul className="print-warnings">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {summary}
          {downloadButton('Make print file and proof')}
        </>
      )}

      {mode === 'cricut' && (
        <>
          {num('Gap (mm)', cutter.gap, (gap) => setCutter({ gap }), 2)}
          {summary}
          {pages.length > 0 && (
            <div className="field">
              <span className="field-label">
                <span>Width in Design Space</span>
                <InfoTip about="width in Design Space">Design Space resizes uploads. Set each image to this width before you print. It adds its own bleed.</InfoTip>
              </span>
              <ul className="made-files">
                {cricutWidths(settings, pages).map((w, i) => (
                  <li key={i}>
                    Image {i + 1}: {Number(w.toFixed(1))} mm ({(w / 25.4).toFixed(2)} in)
                  </li>
                ))}
              </ul>
            </div>
          )}
          {downloadButton('Make Cricut images')}
        </>
      )}

      {mode === 'silhouette' && (
        <>
          <div className="row">
            {select(
              'Paper',
              settings.paper,
              Object.entries(PAPER).map(([k, p]): [PaperKey, string] => [k as PaperKey, p.label]),
              (paper) => onChange({ ...settings, paper }),
            )}
            {num('Margin (mm)', cutter.margin, (margin) => setCutter({ margin }), 0, 0.1, 'Room for the registration marks Silhouette Studio prints in the corners.')}
          </div>
          <div className="row">
            {num('Bleed (mm)', cutter.bleed, (bleed) => setCutter({ bleed }), 0, 0.1, bleedTip)}
            {num('Gap (mm)', cutter.gap, (gap) => setCutter({ gap }))}
          </div>
          {summary}
          {downloadButton('Make Silhouette files')}
        </>
      )}
    </div>
  );
}
