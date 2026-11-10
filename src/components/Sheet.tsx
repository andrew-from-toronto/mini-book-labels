import type { CSSProperties } from 'react';
import type { CoverResult } from '../lib/covers';
import { labelWidth, PAPER } from '../lib/layout';
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

export function Sheet(props: Props) {
  const { pages, settings, cols, coverOf, customCovers, zoom, activeId, guidesHidden, onToggleGuides } = props;
  const paper = PAPER[settings.paper];
  return (
    <div className="sheet" style={
        { zoom, '--guide-opacity': settings.guideOpacity, '--guide-width': `${settings.guideWidth}mm` } as CSSProperties
      }>
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
              <Label
                key={book.id}
                book={book}
                cover={coverOf(book)}
                custom={customCovers[book.id]}
                settings={settings}
                guides={book.id === activeId && !guidesHidden}
                onClick={book.id === activeId ? onToggleGuides : undefined}
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
