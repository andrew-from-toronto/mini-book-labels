import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const MIN = 0.5;
const MAX = 10;

/**
 * Ctrl + wheel (or trackpad pinch) zoom for a scrollable element, keeping the point under the cursor
 * in place, plus click-and-drag panning.
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Needs a non-passive listener, or the browser zooms the whole page instead.
      e.preventDefault();
      zoomTo(current.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    };

    let drag: { x: number; y: number; left: number; top: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button, a, input')) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      el.classList.add('panning');
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
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

  return { zoom, zoomBy: (factor: number) => zoomTo(current.current * factor), reset: () => zoomTo(1) };
}
