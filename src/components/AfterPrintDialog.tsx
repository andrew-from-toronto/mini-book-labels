import { useEffect, useRef } from 'react';
import { DEFAULT_FILAMENT } from '../lib/filaments';
import { encodeOrder } from '../lib/orderCode';
import { costOfBook, formatCad } from '../lib/pricing';
import { orderUrl, printable, shopVisible } from '../lib/shop';
import type { Settings } from '../lib/types';

/**
 * Shown once a visit, after the sheet is printed: the blank books to wrap the covers around, at the size
 * just printed, or a coffee.
 */
export function AfterPrintDialog({
  settings,
  sheetCount,
  onCoffee,
  onClose,
}: {
  settings: Settings;
  /** Covers on the printed sheet: the order starts with one blank for each. */
  sheetCount: number;
  onCoffee: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dims = { height: settings.height, width: settings.width, spine: settings.spine };
  const sells = shopVisible() && printable(dims);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="coffee-dialog" onClose={onClose} aria-labelledby="after-print-title">
      <header>
        <h2 id="after-print-title">Covers printed</h2>
        <button type="button" className="close" onClick={() => dialog.current?.close()} aria-label="Close">
          ×
        </button>
      </header>
      <div className="coffee-choose">
        {sells && (
          <>
            <p className="after-print-offer">
              <strong>Need the books?</strong>
              <span className="muted">
                Blanks at this size, {formatCad(costOfBook(dims).unitPrice)} CAD each
              </span>
            </p>
            <a
              className="button primary"
              href={orderUrl(encodeOrder({ dims, options: settings.model, colour: DEFAULT_FILAMENT }), sheetCount)}
              target="_blank"
              rel="noopener"
              onClick={() => dialog.current?.close()}
            >
              Order blank books
            </a>
          </>
        )}
        <button
          type="button"
          className={sells ? '' : 'primary'}
          onClick={() => {
            dialog.current?.close();
            onCoffee();
          }}
        >
          Buy me a coffee
        </button>
      </div>
    </dialog>
  );
}
