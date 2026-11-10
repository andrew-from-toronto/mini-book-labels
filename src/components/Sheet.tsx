import { useEffect, useRef } from 'react';
import type { CoverResult } from '../lib/covers';
import { defaultWrapSpine, labelWidth, PAPER } from '../lib/layout';
import { drawLabel } from '../lib/render';
import type { Book, CustomCover, Settings } from '../lib/types';

interface LabelProps {
  book: Book;
  cover: CoverResult | undefined;
  custom: CustomCover | undefined;
  settings: Settings;
  /** Overlay the back / spine / front boundaries. Screen only, never printed. */
  guides: boolean;
}

function Label({ book, cover, custom, settings, guides }: LabelProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { height, width, spine, style } = settings;

  const wrap =
    cover?.source === 'wrap' ? (custom?.spine ?? cover.detectedSpine ?? defaultWrapSpine(settings)) : undefined;
  const wrapLeft = wrap?.left;
  const wrapRight = wrap?.right;

  useEffect(() => {
    if (!ref.current || !cover) return;
    const wrapSpine = wrapLeft !== undefined && wrapRight !== undefined ? { left: wrapLeft, right: wrapRight } : undefined;
    drawLabel(ref.current, book, cover.image, { height, width, spine }, style, wrapSpine);
  }, [book, cover, height, width, spine, style, wrapLeft, wrapRight]);

  const size = { width: `${labelWidth(settings)}mm`, height: `${height}mm` };
  return (
    <div className={guides ? 'label-wrap guided' : 'label-wrap'} style={size}>
      <canvas ref={ref} className="label" title={book.title} style={size} />
      {guides && (
        <div className="guides">
          <span className="guide" style={{ left: `${width}mm` }} />
          <span className="guide" style={{ left: `${width + spine}mm` }} />
          <span className="guide-tag" style={{ left: `${width / 2}mm` }}>
            back
          </span>
          <span className="guide-tag" style={{ left: `${width + spine / 2}mm` }}>
            spine
          </span>
          <span className="guide-tag" style={{ left: `${width + spine + width / 2}mm` }}>
            front
          </span>
        </div>
      )}
    </div>
  );
}

interface Props {
  pages: Book[][];
  settings: Settings;
  cols: number;
  coverOf: (book: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
  zoom: number;
  /** Book whose label shows alignment guides. */
  guideId: string | null;
}

export function Sheet({ pages, settings, cols, coverOf, customCovers, zoom, guideId }: Props) {
  const paper = PAPER[settings.paper];
  return (
    <div className="sheet" style={{ zoom }}>
      <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }`}</style>
      {pages.map((page, i) => (
        <section
          key={i}
          className="page"
          style={{ width: `${paper.w}mm`, height: `${paper.h}mm`, padding: `${settings.margin}mm` }}
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${cols}, ${labelWidth(settings)}mm)`, gap: `${settings.gap}mm` }}
          >
            {page.map((book) => (
              <Label key={book.id} book={book} cover={coverOf(book)} custom={customCovers[book.id]}
                settings={settings}
                guides={book.id === guideId}
              />
            ))}
          </div>
          <div className="ruler" style={{ left: `${settings.margin}mm`, bottom: `${settings.margin}mm` }}>
            <span className="bar" />
            50 mm. If this line measures 50 mm, the labels are the right size.
          </div>
        </section>
      ))}
    </div>
  );
}
