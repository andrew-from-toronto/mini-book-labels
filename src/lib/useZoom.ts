import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const MIN = 0.1;
const MAX = 10;

/**
 * Ctrl + wheel (or trackpad pinch) zoom for a scrollable element, keeping the point under the cursor
 * in place, plus click-and-drag panning. `frame` jumps straight to a zoom level and centres a target.
 */
export function useZoom(ref: RefObject<HTMLElement | null>) {
  const [zoom, setZoom] = useState(1);
  const current = useRef(1);
  const anchor = useRef<{ x: number; y: number; ratio: number } | null>(null);

  function zoomTo(next: number, clientX?: number, clientY?: number) {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.min(MAX, Math.max(MIN, next));
    const rect = el.getBoundingClientRect();
    anchor.current = {
      x: (clientX ?? rect.left + rect.width / 2) - rect.left,
      y: (clientY ?? rect.top + rect.height / 2) - rect.top,
      ratio: clamped / current.current,
    };
    current.current = clamped;
    setZoom(clamped);
  }

  /** Zooms `content` (the element carrying the CSS zoom) and centres `target`, or scrolls to the start without one. */
  function frame(next: number, content: HTMLElement, target?: Element | null) {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.min(MAX, Math.max(MIN, next));
    // Applied to the DOM now, ahead of React's render, so the target can be measured at the new zoom.
    content.style.zoom = String(clamped);
    anchor.current = null;
    current.current = clamped;
    setZoom(clamped);
    if (!target) {
      el.scrollTo(0, 0);
      return;
    }
    const view = el.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    el.scrollLeft += box.left + box.width / 2 - (view.left + view.width / 2);
    el.scrollTop += box.top + box.height / 2 - (view.top + view.height / 2);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Needs a non-passive listener, or the browser zooms the whole page instead.
      e.preventDefault();
      zoomTo(current.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    };

    let drag: { x: number; y: number; left: number; top: number; panning: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, panning: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.panning) {
        // Capture only once it is clearly a drag: capturing on press would steal clicks from the labels.
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
        drag.panning = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('panning');
      }
      el.scrollLeft = drag.left - (e.clientX - drag.x);
      el.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const onUp = () => {
      drag = null;
      el.classList.remove('panning');
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = (el.scrollLeft + a.x) * a.ratio - a.x;
    el.scrollTop = (el.scrollTop + a.y) * a.ratio - a.y;
    anchor.current = null;
  }, [zoom, ref]);

  return { zoom, zoomBy: (factor: number) => zoomTo(current.current * factor), frame };
}
