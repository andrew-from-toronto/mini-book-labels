import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How long a finger rests on a card before it lifts for dragging; moving sooner scrolls instead. */
const LONG_PRESS_MS = 350;
/** How far a finger may wander during the long press, and a mouse before a drag starts, in px. */
const TOUCH_SLOP = 10;
const MOUSE_SLOP = 5;
/** Within this many px of the scroll area's top or bottom, the list scrolls while dragging. */
const EDGE = 70;
const MAX_SCROLL_SPEED = 14;

interface Drag {
  id: string;
  el: HTMLElement;
  touch: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  timer: number;
  frame: number;
  scroller: HTMLElement | null;
  startScroll: number;
}

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const scrollTop = (s: HTMLElement | null) => (s ? s.scrollTop : window.scrollY);

/**
 * Reorders cards in a list by dragging, with a mouse or a finger. Pointer events rather than HTML drag
 * and drop, which phones barely support. A finger long-presses first, so a swipe still scrolls.
 *
 * Cards are the list's `[data-drag-id]` children. `slot` is where the dragged card would land, as an
 * index between cards (0 is before the first, `ids.length` after the last), or null for nowhere new.
 */
export function useDragOrder(ids: string[], onMove: (id: string, to: number) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ ids, onMove, slot });
  latest.current = { ids, onMove, slot };

  /** Called after a pointer listener is set up; tears the drag down whichever way it ends. */
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  function follow(d: Drag) {
    const dy = d.y - d.startY + scrollTop(d.scroller) - d.startScroll;
    d.el.style.transform = `translate(${d.x - d.startX}px, ${dy}px)`;
    // The dragged card ignores the pointer while lifted, so this finds the card under it.
    const under = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('[data-drag-id]');
    const index = under ? latest.current.ids.indexOf(under.dataset.dragId!) : -1;
    if (index < 0) return; // in a gap between cards: keep the last slot
    const rect = under!.getBoundingClientRect();
    const next = d.x > rect.left + rect.width / 2 ? index + 1 : index;
    const from = latest.current.ids.indexOf(d.id);
    // Either side of the card itself is where it already is.
    setSlot(next === from || next === from + 1 ? null : next);
  }

  function autoScroll(d: Drag) {
    const top = d.scroller ? d.scroller.getBoundingClientRect().top : 0;
    const bottom = d.scroller ? d.scroller.getBoundingClientRect().bottom : window.innerHeight;
    const speed =
      d.y < top + EDGE
        ? -MAX_SCROLL_SPEED * (1 - Math.max(0, d.y - top) / EDGE)
        : d.y > bottom - EDGE
          ? MAX_SCROLL_SPEED * (1 - Math.max(0, bottom - d.y) / EDGE)
          : 0;
    if (speed) {
      if (d.scroller) d.scroller.scrollTop += speed;
      else window.scrollBy(0, speed);
      follow(d);
    }
    d.frame = requestAnimationFrame(() => autoScroll(d));
  }

  function lift(d: Drag) {
    d.started = true;
    d.scroller = scrollParent(d.el);
    d.startScroll = scrollTop(d.scroller);
    setDragId(d.id);
    navigator.vibrate?.(10);
    d.frame = requestAnimationFrame(() => autoScroll(d));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || drag.current) return;
    // Controls inside the card keep their own clicks.
    if (e.target instanceof Element && e.target.closest('input, button, select, textarea, a, label')) return;
    const d: Drag = {
      id,
      el: e.currentTarget,
      touch: e.pointerType !== 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      started: false,
      timer: 0,
      frame: 0,
      scroller: null,
      startScroll: 0,
    };
    drag.current = d;
    if (d.touch) d.timer = window.setTimeout(() => lift(d), LONG_PRESS_MS);

    const move = (ev: PointerEvent) => {
      d.x = ev.clientX;
      d.y = ev.clientY;
      if (d.started) {
        follow(d);
        return;
      }
      const moved = Math.hypot(d.x - d.startX, d.y - d.startY);
      if (d.touch && moved > TOUCH_SLOP) end(false); // a swipe: let it scroll
      else if (!d.touch && moved > MOUSE_SLOP) lift(d);
    };
    // Once lifted, a moving finger drags the card instead of scrolling the page.
    const touchMove = (ev: TouchEvent) => {
      if (d.started) ev.preventDefault();
    };
    // A long press would otherwise open the image menu on some phones.
    const menu = (ev: Event) => ev.preventDefault();
    const up = () => end(true);
    const cancel = () => end(false);

    function end(drop: boolean) {
      clearTimeout(d.timer);
      cancelAnimationFrame(d.frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('contextmenu', menu);
      d.el.style.transform = '';
      drag.current = null;
      stop.current = () => {};
      if (!d.started) return;
      const { ids, onMove, slot } = latest.current;
      if (drop && slot !== null) {
        const from = ids.indexOf(d.id);
        onMove(d.id, slot > from ? slot - 1 : slot);
      }
      setDragId(null);
      setSlot(null);
      // The release would also click the card, opening it; swallow that one click.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('contextmenu', menu);
    stop.current = () => end(false);
  }

  return { dragId, slot, onPointerDown };
}
