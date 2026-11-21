import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { track } from '../lib/telemetry';

/** How long a finger rests on a card before it lifts for dragging; moving sooner scrolls instead. */
const LONG_PRESS_MS = 350;
/** How far a finger may wander during the long press, and a mouse before a drag starts, in px. */
const TOUCH_SLOP = 10;
const MOUSE_SLOP = 5;
/** Within this many px of the scroll area's top or bottom, the list scrolls while dragging. */
const EDGE = 70;
const MAX_SCROLL_SPEED = 14;

/** How a press on a card ended: released, a swipe that scrolls, the browser's cancel, the window losing focus, or a newer press. */
type End = 'up' | 'swipe' | 'cancel' | 'blur' | 'superseded' | 'unmount';
/** Why a card cannot be dragged right now: it is the open one, or it is the only one. */
export type Blocked = 'open' | 'single';

interface Drag {
  id: string;
  pointerId: number;
  el: HTMLElement;
  touch: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  /** Where the card would land. Kept here as well as in state: a quick release can come before React re-renders. */
  slot: number | null;
  timer: number;
  frame: number;
  scroller: HTMLElement | null;
  startScroll: number;
  /** For the telemetry report when the press ends. */
  pointerType: string;
  downAt: number;
  moves: number;
  maxDist: number;
  /** Times the pointer was found over a card while dragging. */
  hits: number;
  captured: boolean;
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
  const latest = useRef({ ids, onMove });
  latest.current = { ids, onMove };

  /** Called after a pointer listener is set up; tears the drag down whichever way it ends. */
  const stop = useRef<(why: End) => void>(() => {});
  useEffect(() => () => stop.current('unmount'), []);

  // Once a card is lifted, a moving finger drags it instead of scrolling the page. This listener is
  // there from the start rather than added on touch: Safari on iPhone only lets a touchmove listener
  // stop scrolling if it was in place when the finger came down.
  useEffect(() => {
    const touchMove = (ev: TouchEvent) => {
      if (drag.current?.started && ev.cancelable) ev.preventDefault();
    };
    document.addEventListener('touchmove', touchMove, { passive: false });
    return () => document.removeEventListener('touchmove', touchMove);
  }, []);

  function follow(d: Drag) {
    const dy = d.y - d.startY + scrollTop(d.scroller) - d.startScroll;
    d.el.style.transform = `translate(${d.x - d.startX}px, ${dy}px)`;
    // The dragged card ignores the pointer while lifted, so this finds the card under it.
    const under = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>('[data-drag-id]');
    const index = under ? latest.current.ids.indexOf(under.dataset.dragId!) : -1;
    if (index < 0) return; // in a gap between cards: keep the last slot
    d.hits++;
    const rect = under!.getBoundingClientRect();
    const next = d.x > rect.left + rect.width / 2 ? index + 1 : index;
    const from = latest.current.ids.indexOf(d.id);
    // Either side of the card itself is where it already is.
    d.slot = next === from || next === from + 1 ? null : next;
    setSlot(d.slot);
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
    // Straight away, not on the re-render that adds .dragging, so the first move already sees past it.
    d.el.style.pointerEvents = 'none';
    // Keeps the pointer's events coming to this page wherever it goes, even out of the window.
    try {
      d.el.setPointerCapture(d.pointerId);
      d.captured = true;
    } catch {
      /* the pointer is already gone; its pointerup or pointercancel ends the drag */
    }
    window.getSelection()?.removeAllRanges();
    setDragId(d.id);
    navigator.vibrate?.(10);
    d.frame = requestAnimationFrame(() => autoScroll(d));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string, blocked?: Blocked) {
    if (!e.isPrimary || e.button !== 0) return;
    // A drag that never heard its release (a lost pointerup) must not block every drag after it.
    stop.current('superseded');
    // Controls inside the card keep their own clicks.
    if (e.target instanceof Element && e.target.closest('input, button, select, textarea, a, label')) return;
    if (blocked) {
      reportBlocked(e, blocked);
      return;
    }
    const d: Drag = {
      id,
      pointerId: e.pointerId,
      el: e.currentTarget,
      touch: e.pointerType !== 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      started: false,
      slot: null,
      timer: 0,
      frame: 0,
      scroller: null,
      startScroll: 0,
      pointerType: e.pointerType,
      downAt: performance.now(),
      moves: 0,
      maxDist: 0,
      hits: 0,
      captured: false,
    };
    drag.current = d;
    if (d.touch) d.timer = window.setTimeout(() => lift(d), LONG_PRESS_MS);

    const mine = (ev: PointerEvent) => ev.pointerId === d.pointerId;
    const move = (ev: PointerEvent) => {
      if (!mine(ev)) return;
      d.x = ev.clientX;
      d.y = ev.clientY;
      d.moves++;
      d.maxDist = Math.max(d.maxDist, Math.hypot(d.x - d.startX, d.y - d.startY));
      if (d.started) {
        follow(d);
        return;
      }
      const moved = Math.hypot(d.x - d.startX, d.y - d.startY);
      if (d.touch && moved > TOUCH_SLOP) end('swipe'); // a swipe: let it scroll
      else if (!d.touch && moved > MOUSE_SLOP) lift(d);
    };
    const up = (ev: PointerEvent) => {
      if (!mine(ev)) return;
      // Where the release happened counts, even if no move was reported there.
      d.x = ev.clientX;
      d.y = ev.clientY;
      if (d.started) follow(d);
      end('up');
    };
    const cancel = (ev: PointerEvent) => mine(ev) && end('cancel');
    // The window losing focus (alt-tab, a release outside it that never arrives) ends the drag.
    const blur = () => end('blur');
    // A long press would otherwise open the image menu on some phones; a mouse drag, the browser's own
    // drag of whatever is under it, which ends pointer events.
    const prevent = (ev: Event) => ev.preventDefault();
    const preventOnce = (ev: Event) => d.started && ev.preventDefault();

    function end(how: End) {
      const drop = how === 'up';
      clearTimeout(d.timer);
      cancelAnimationFrame(d.frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('contextmenu', prevent);
      window.removeEventListener('dragstart', prevent);
      window.removeEventListener('selectstart', preventOnce);
      d.el.style.transform = '';
      d.el.style.pointerEvents = '';
      if (d.el.hasPointerCapture?.(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
      if (drag.current === d) drag.current = null;
      stop.current = () => {};
      report(d, how);
      if (!d.started) return;
      const { ids, onMove } = latest.current;
      if (drop && d.slot !== null) {
        const from = ids.indexOf(d.id);
        if (from >= 0) onMove(d.id, d.slot > from ? d.slot - 1 : d.slot);
      }
      setDragId(null);
      setSlot(null);
      if (!drop) return;
      // The release would also click the card, opening it; swallow that one click. Some browsers send
      // no click after a drag, so the swallow stands down after a moment rather than eating a later one.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('contextmenu', prevent);
    window.addEventListener('dragstart', prevent);
    window.addEventListener('selectstart', preventOnce);
    stop.current = end;
  }

  /** One anonymous summary per press that was, or might have been, an attempt to drag. */
  function report(d: Drag, how: End) {
    const ms = Math.round(performance.now() - d.downAt);
    // A plain click or tap, or a finger scrolling the list: nothing to learn from those.
    if (how === 'swipe' || (!d.started && how === 'up' && d.maxDist < MOUSE_SLOP && ms < 400)) return;
    const { ids } = latest.current;
    const outcome = !d.started ? `not-lifted-${how}` : how === 'up' ? (d.slot === null ? 'dropped-in-place' : 'moved') : how;
    track('drag', {
      outcome,
      pointer: d.pointerType,
      ms,
      moves: d.moves,
      dist: Math.round(d.maxDist),
      hits: d.hits,
      slot: d.slot,
      from: ids.indexOf(d.id),
      books: ids.length,
      captured: d.captured,
      scroller: d.scroller ? d.scroller.className.split(' ')[0] || d.scroller.tagName.toLowerCase() : 'page',
    });
  }

  /** A press that moves on a card that cannot be dragged: someone trying to drag the open card, say. */
  function reportBlocked(e: ReactPointerEvent<HTMLElement>, blocked: Blocked) {
    const { pointerId, clientX: x0, clientY: y0, pointerType } = e;
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 20) return;
      done();
      track('drag', { outcome: `blocked-${blocked}`, pointer: pointerType, books: latest.current.ids.length });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }

  return { dragId, slot, onPointerDown };
}
