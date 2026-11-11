import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const MIN = 0.1;
const MAX = 10;

/**
 * Ctrl + wheel (or trackpad pinch) and two-finger touch pinch zoom for a scrollable element, keeping the
 * point under the cursor or fingers in place, plus mouse drag panning (touch pans by native scrolling).
 * `frame` jumps straight to a zoom level and centres a target.
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
      // Several zoom events can arrive before React renders (a pinch fires many); compound them.
      ratio: (anchor.current?.ratio ?? 1) * (clamped / current.current),
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
      // Touch and pen scroll natively; capturing them here would fight the browser's own panning.
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
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

    // Two-finger pinch. The viewport's touch-action stops the browser zooming the whole page instead.
    let pinch: { distance: number; zoom: number } | null = null;
    const fingers = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { distance: fingers(e).distance, zoom: current.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const f = fingers(e);
      if (pinch.distance > 0) zoomTo(pinch.zoom * (f.distance / pinch.distance), f.x, f.y);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
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
