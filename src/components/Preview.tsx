import { useEffect, useRef, useState } from 'react';
import type { CoverResult } from '../lib/covers';
import { labelWidth, PAPER } from '../lib/layout';
import type { Book, CustomCover, Settings } from '../lib/types';
import { useZoom } from '../lib/useZoom';
import { Sheet } from './Sheet';

const CSS_PX_PER_MM = 96 / 25.4;
/** Matches the viewport's padding, both sides. */
const PADDING = 32;

interface Props {
  pages: Book[][];
  settings: Settings;
  cols: number;
  coverOf: (book: Book) => CoverResult | undefined;
  customCovers: Record<string, CustomCover>;
  /** The book being worked on: the preview zooms to its label. */
  activeId: string | null;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  /** Changes whenever labels move on the sheet, so the framing is redone. */
  layoutKey: string;
}

export function Preview(props: Props) {
  const { pages, settings, activeId, expanded, onExpanded, layoutKey } = props;
  const viewport = useRef<HTMLDivElement>(null);
  const { zoom, zoomBy, frame } = useZoom(viewport);
  const framed = useRef({ activeId: null as string | null, expanded: false });
  // Keyed by book, so moving to another book shows its guides again.
  const [guidesHiddenFor, setGuidesHiddenFor] = useState<string | null>(null);
  const guidesHidden = activeId !== null && guidesHiddenFor === activeId;

  /** Zooms to the active book's label, or shows the whole page (actual size when expanded). */
  function reframe() {
    const el = viewport.current;
    const sheet = el?.querySelector<HTMLElement>('.sheet');
    if (!el || !sheet) return;
    const w = el.clientWidth - PADDING;
    const h = el.clientHeight - PADDING;
    const label = activeId ? sheet.querySelector(`[data-book="${CSS.escape(activeId)}"]`) : null;
    if (label) {
      const fitWidth = (w * 0.9) / (labelWidth(settings) * CSS_PX_PER_MM);
      const fitHeight = (h * 0.7) / (settings.height * CSS_PX_PER_MM);
      frame(Math.min(fitWidth, fitHeight), sheet, label);
    } else {
      const paper = PAPER[settings.paper];
      frame(expanded ? 1 : Math.min(w / (paper.w * CSS_PX_PER_MM), h / (paper.h * CSS_PX_PER_MM)), sheet);
    }
  }
  const latestReframe = useRef(reframe);
  useEffect(() => {
    latestReframe.current = reframe;
  });

  useEffect(() => {
    const sameFocus = framed.current.activeId === activeId && framed.current.expanded === expanded;
    framed.current = { activeId, expanded };
    // While expanded the zoom is the user's, so only moving to another book reframes.
    if (expanded && sameFocus) return;
    latestReframe.current();
  }, [activeId, expanded, layoutKey]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let last = { w: 0, h: 0 };
    const observer = new ResizeObserver(() => {
      const size = { w: el.clientWidth, h: el.clientHeight };
      // A phone's address bar showing or hiding changes only the height a little; reframing then
      // would throw away the user's pinch zoom. Becoming visible (from a hidden tab) always reframes.
      const minor = last.w > 0 && size.w === last.w && Math.abs(size.h - last.h) < 120;
      last = size;
      if (!framed.current.expanded && !minor && size.w > 0) latestReframe.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <aside className="preview">
      <div className="preview-bar">
        <strong>Print preview</strong>
        {activeId && <span className="muted">Click the label to {guidesHidden ? 'show' : 'hide'} guides</span>}
        {pages.length > 0 && (
          // Always shown on narrow screens, where the preview has its own tab; only when expanded otherwise.
          <span className={expanded ? 'zoom-controls shown' : 'zoom-controls'}>
            <button onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
              -
            </button>
            <button onClick={reframe} title="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">
              +
            </button>
            <span className="muted hint-mouse">Ctrl + scroll to zoom, drag to pan</span>
            <span className="muted hint-touch">Pinch to zoom, drag to pan</span>
          </span>
        )}
        <button className="expand" onClick={() => onExpanded(!expanded)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="viewport" ref={viewport}>
        {pages.length > 0 ? (
          <Sheet
            pages={pages}
            settings={settings}
            cols={props.cols}
            coverOf={props.coverOf}
            customCovers={props.customCovers}
            zoom={zoom}
            activeId={activeId}
            guidesHidden={guidesHidden}
            onToggleGuides={() => setGuidesHiddenFor(guidesHidden ? null : activeId)}
          />
        ) : (
          <p className="empty muted">Your printable sheet will appear here.</p>
        )}
      </div>
    </aside>
  );
}
