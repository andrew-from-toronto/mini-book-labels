import { useEffect, useRef } from 'react';
import type { CoverResult } from '../lib/covers';
import { labelWidth, PAPER } from '../lib/layout';
import { drawLabel } from '../lib/render';
import type { Book, Settings } from '../lib/types';

interface LabelProps {
  book: Book;
  cover: CoverResult | undefined;
  settings: Settings;
}

function Label({ book, cover, settings }: LabelProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { height, width, spine, style } = settings;

  useEffect(() => {
    if (ref.current && cover) drawLabel(ref.current, book, cover.image, { height, width, spine }, style);
  }, [book, cover, height, width, spine, style]);

  return (
    <canvas
      ref={ref}
      className="label"
      title={book.title}
      style={{ width: `${labelWidth(settings)}mm`, height: `${height}mm` }}
    />
  );
}

interface Props {
  pages: Book[][];
  settings: Settings;
  cols: number;
  coverOf: (book: Book) => CoverResult | undefined;
}

export function Sheet({ pages, settings, cols, coverOf }: Props) {
  const paper = PAPER[settings.paper];
  return (
    <div className="sheet">
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
              <Label key={book.id} book={book} cover={coverOf(book)} settings={settings} />
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
