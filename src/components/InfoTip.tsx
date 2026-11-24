import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * An (i) button with a short explanation: shown while a mouse hovers it, toggled by a tap, click or
 * Enter, closed by Escape, a tap elsewhere or scrolling. Placed beside a field's label, never inside it,
 * so the field's accessible name stays just its label.
 */
export function InfoTip({ about, children }: { about: string; children: ReactNode }) {
  // Open while hovered (mouse) or pinned by a click, tap or Enter.
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const close = () => {
    setHover(false);
    setPinned(false);
  };
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // Fixed to the viewport, kept on screen: the controls column is narrow and scrolls.
  useLayoutEffect(() => {
    if (!open || !button.current || !bubble.current) return;
    const b = button.current.getBoundingClientRect();
    const width = bubble.current.offsetWidth;
    const height = bubble.current.offsetHeight;
    const left = Math.min(Math.max(8, b.left + b.width / 2 - 24), window.innerWidth - width - 8);
    const below = b.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, b.top - height - 6) : below;
    setAt({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node) && !bubble.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span
      className="info-tip"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
    >
      <button
        ref={button}
        type="button"
        className="info-button"
        aria-label={`About ${about}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" />
          <path d="M8 7.2v4.3M8 4.6v.1" />
        </svg>
      </button>
      {open && (
        <span
          ref={bubble}
          id={id}
          role="tooltip"
          className="info-bubble"
          style={at ? { left: at.left, top: at.top } : { visibility: 'hidden', left: 0, top: 0 }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** A labelled field with an optional (i) beside its label. `children` gets the id to give its control. */
export function Field({ label, tip, children }: { label: string; tip?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {tip && <InfoTip about={label.replace(/ \(.*\)$/, '').toLowerCase()}>{tip}</InfoTip>}
      </span>
      {children(id)}
    </div>
  );
}

/** A checkbox with an optional (i) after its label. */
export function Check({ label, checked, onChange, tip }: { label: string; checked: boolean; onChange: (on: boolean) => void; tip?: ReactNode }) {
  return (
    <span className="check-row">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {tip && <InfoTip about={label.toLowerCase()}>{tip}</InfoTip>}
    </span>
  );
}
