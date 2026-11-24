import { useEffect, useRef } from 'react';
import type { CoverResult } from '../lib/covers';
import { defaultWrapSpine, labelWidth } from '../lib/layout';
import { cancel, schedule, scheduleFinal } from '../lib/drawQueue';
import { drawLabel } from '../lib/render';
import { drawLabelWithBleed, type BleedOptions } from '../lib/bleed';

/** Sheet labels redraw at this while being edited, then at full print resolution once edits pause. */
const PREVIEW_PX_PER_MM = 8;
import type { Book, CustomCover, Settings } from '../lib/types';

interface Props {
  book: Book;
  cover: CoverResult | undefined;
  custom: CustomCover | undefined;
  settings: Settings;
  /** Overlay the back / spine / front boundaries. Screen only, never printed. */
  guides?: boolean;
  /** Render as a fixed-height on-screen thumbnail (px) instead of at print size. */
  thumbHeight?: number;
  /** Print shop and cutter sheets: the label drawn this much larger on every side, its bleed filled. */
  bleed?: BleedOptions;
  /** Keeps spine text, blurb and barcode this far (mm) inside the edges. */
  safe?: number;
  onClick?: () => void;
}

export function Label({ book, cover, custom, settings, guides = false, thumbHeight, bleed, safe, onClick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { height, width, spine, style, back, backOptions } = settings;
  const backKey = JSON.stringify(backOptions ?? {});

  const wrap =
    cover?.source === 'wrap' ? (custom?.spine ?? cover.detectedSpine ?? defaultWrapSpine(settings)) : undefined;
  const wrapLeft = wrap?.left;
  const wrapRight = wrap?.right;
  // Twice the CSS size so thumbnails stay sharp on high-density screens.
  const pxPerMm = thumbHeight ? (thumbHeight * 2) / height : undefined;

  // Serialised so the effect compares values, not object identity.
  const crop = custom?.crop ?? cover?.detectedCrop;
  const cropKey = crop ? JSON.stringify(crop) : '';
  const bleedMm = bleed?.bleed ?? 0;
  const fill = bleed?.fill ?? 'mirror';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !cover) return;
    const draw = (resolution: number | undefined) => () => {
      const options = {
        back,
        backOptions: JSON.parse(backKey),
        wrapSpine: wrapLeft !== undefined && wrapRight !== undefined ? { left: wrapLeft, right: wrapRight } : undefined,
        crop: cropKey ? JSON.parse(cropKey) : undefined,
        pxPerMm: resolution,
        safe,
      };
      if (bleedMm > 0) drawLabelWithBleed(canvas, book, cover.image, { height, width, spine }, style, options, { bleed: bleedMm, fill });
      else drawLabel(canvas, book, cover.image, { height, width, spine }, style, options);
    };
    // Drawn in turn with the other labels (lib/drawQueue.ts), so editing stays smooth with many on show.
    if (thumbHeight) schedule(canvas, draw(pxPerMm));
    else {
      // A quick preview now; print resolution once edits pause, or at once if printed first.
      schedule(canvas, draw(PREVIEW_PX_PER_MM));
      scheduleFinal(canvas, draw(undefined));
    }
    return () => cancel(canvas);
  }, [book, cover, height, width, spine, style, back, backKey, wrapLeft, wrapRight, cropKey, pxPerMm, thumbHeight, bleedMm, fill, safe]);

  if (thumbHeight) {
    const size = { width: `${(thumbHeight * labelWidth(settings)) / height}px`, height: `${thumbHeight}px` };
    return <canvas ref={ref} className="label thumb" style={size} />;
  }

  const b = thumbHeight ? 0 : bleedMm;
  const size = { width: `${labelWidth(settings) + 2 * b}mm`, height: `${height + 2 * b}mm` };
  return (
    <div
      className={`label-wrap${guides ? ' guided' : ''}${onClick ? ' clickable' : ''}`}
      style={size}
      data-book={book.id}
      onClick={onClick}
    >
      <canvas ref={ref} className="label" title={book.title} style={size} />
      {guides && (
        <div className="guides">
          <span className="guide" style={{ left: `${b + width}mm` }} />
          <span className="guide" style={{ left: `${b + width + spine}mm` }} />
          <span className="guide-tag" style={{ left: `${b + width / 2}mm`, top: `${b}mm` }}>
            back
          </span>
          <span className="guide-tag" style={{ left: `${b + width + spine / 2}mm`, top: `${b}mm` }}>
            spine
          </span>
          <span className="guide-tag" style={{ left: `${b + width + spine + width / 2}mm`, top: `${b}mm` }}>
            front
          </span>
        </div>
      )}
    </div>
  );
}
