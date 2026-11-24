import type { CSSProperties } from 'react';
import type { CoverResult } from '../lib/covers';
import { labelWidth, sheetLayout, usedBlock } from '../lib/layout';
import { cutterSettings, outputMode, shopSettings } from '../lib/output';
import { cropMarks, slugText } from '../lib/pdf/shopPdf';
import { scaleText } from '../lib/printFiles';
import type { Book, CustomCover, Settings } from '../lib/types';
import { Label } from './Label';

interface Props {
  pages: Book[][];
  settings: Settings;
  cols: number;
  coverOf: (book: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
  zoom: number;
  /** The book being worked on. Its label shows alignment guides, and clicking it toggles them. */
  activeId: string | null;
  guidesHidden: boolean;
  onToggleGuides: () => void;
}

const mm = (v: number) => `${v}mm`;

export function Sheet(props: Props) {
  const { pages, settings, cols, coverOf, customCovers, zoom, activeId, guidesHidden, onToggleGuides } = props;
  const mode = outputMode(settings);
  const layout = sheetLayout(settings);
  const { page } = layout;
  const shop = mode === 'shop' ? shopSettings(settings) : null;
  const fill = shop ? shop.bleedFill : mode === 'silhouette' ? 'mirror' : 'stretch';
  const safe = shop?.pullIn ? shop.safe : undefined;
  const label = (book: Book) => (
    <Label
      key={book.id}
      book={book}
      cover={coverOf(book)}
      custom={customCovers[book.id]}
      settings={settings}
      guides={book.id === activeId && !guidesHidden}
      onClick={book.id === activeId ? onToggleGuides : undefined}
      bleed={layout.bleed > 0 ? { bleed: layout.bleed, fill } : undefined}
      safe={safe}
    />
  );
  return (
    <div
      className={`sheet sheet-${mode}`}
      style={{ zoom, '--guide-opacity': settings.guideOpacity, '--guide-width': `${settings.guideWidth}mm` } as CSSProperties}
    >
      <style>{`@page { size: ${page.w}mm ${page.h}mm; margin: 0; }`}</style>
      {pages.map((books, i) =>
        mode === 'home' ? (
          <section key={i} className="page" style={{ width: mm(page.w), height: mm(page.h), padding: mm(settings.margin) }}>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${labelWidth(settings)}mm)`, gap: mm(settings.gap) }}>
              {books.map(label)}
            </div>
            <div className="ruler" style={{ left: mm(settings.margin), bottom: mm(settings.margin) }}>
              <span className="bar" />
              50 mm. If this line measures 50 mm, the labels are the right size.
            </div>
          </section>
        ) : (
          <section key={i} className="page" style={{ width: mm(page.w), height: mm(page.h) }}>
            {mode === 'cricut' && (() => {
              const area = usedBlock(layout, books.length);
              return <div className="print-area" style={{ left: mm(area.x), top: mm(area.y), width: mm(area.w), height: mm(area.h) }} />;
            })()}
            {books.map((book, j) => {
              const slot = layout.slots[j];
              const b = layout.bleed;
              const box = {
                left: mm(slot.x - slot.bleed.left),
                top: mm(slot.y - slot.bleed.top),
                width: mm(layout.trimW + slot.bleed.left + slot.bleed.right),
                height: mm(layout.trimH + slot.bleed.top + slot.bleed.bottom),
              };
              return (
                <div key={book.id} className="slot" style={box}>
                  <div className="slot-art" style={{ left: mm(slot.bleed.left - b), top: mm(slot.bleed.top - b) }}>
                    {label(book)}
                  </div>
                  <div className="cut-line" style={{ left: mm(slot.bleed.left), top: mm(slot.bleed.top), width: mm(layout.trimW), height: mm(layout.trimH) }} />
                  {shop && shop.safe > 0 && (
                    <div
                      className="safe-line"
                      style={{ left: mm(slot.bleed.left + shop.safe), top: mm(slot.bleed.top + shop.safe), width: mm(layout.trimW - 2 * shop.safe), height: mm(layout.trimH - 2 * shop.safe) }}
                    />
                  )}
                </div>
              );
            })}
            {shop && (shop.cropMarks || shop.slug) && (
              <svg className="sheet-marks" viewBox={`0 0 ${page.w} ${page.h}`} style={{ width: mm(page.w), height: mm(page.h) }}>
                {shop.cropMarks &&
                  cropMarks(layout, books.length).map(([x1, y1, x2, y2], k) => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} />)}
                {shop.slug && layout.margin >= 4 && (
                  <text x={page.w / 2} y={page.h - 2.5} textAnchor="middle">
                    {slugText(layout, shop, {
                      sheet: i,
                      sheets: pages.length,
                      labels: books.length,
                      scale: scaleText(settings),
                      colour: shop.colour === 'cmyk' ? `CMYK, ${profileName(shop.profile)}` : 'RGB, sRGB',
                    })}
                  </text>
                )}
              </svg>
            )}
            {mode === 'silhouette' && <RegistrationMarks page={page} inset={Math.min(10, cutterSettings(settings).margin / 2)} />}
          </section>
        ),
      )}
    </div>
  );
}

const profileName = (key: string) => (key === 'gracol' ? 'GRACoL2013_CRPC6' : key === 'fogra39' ? 'FOGRA39L_coated' : 'shop profile');

/** Where Silhouette Studio puts its marks by default: a square top left, corners top right and bottom left. */
function RegistrationMarks({ page, inset }: { page: { w: number; h: number }; inset: number }) {
  const len = 20;
  const { w, h } = page;
  return (
    <svg className="reg-marks" viewBox={`0 0 ${w} ${h}`} style={{ width: mm(w), height: mm(h) }} aria-hidden="true">
      <rect x={inset} y={inset} width={5} height={5} />
      <path d={`M${w - inset - len} ${inset} H${w - inset} V${inset + len}`} />
      <path d={`M${inset} ${h - inset - len} V${h - inset} H${inset + len}`} />
    </svg>
  );
}
