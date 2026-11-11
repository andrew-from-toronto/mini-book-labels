import { useEffect, useRef, useState } from 'react';
import { describeOrder, decodeOrder } from '../lib/orderCode';
import { downloadModel, type ModelFormat } from '../lib/modelDownload';

/**
 * /model/?code=...: builds an order's model and downloads it, for printing a paid order. Linked from the
 * shop's new-order email; the 3MF starts on its own, with buttons to save it again or as STL.
 */
export function ModelDownloadPage() {
  const [code] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const order = decodeOrder(code);
  const [state, setState] = useState<{ building: ModelFormat | null; saved: string | null; failed: boolean }>({
    building: null,
    saved: null,
    failed: false,
  });
  const started = useRef(false);

  async function save(format: ModelFormat) {
    if (!order) return;
    setState((s) => ({ ...s, building: format, failed: false }));
    try {
      const name = await downloadModel(order.dims, order.options, format);
      setState({ building: null, saved: name, failed: false });
    } catch {
      setState({ building: null, saved: null, failed: true });
    }
  }

  useEffect(() => {
    // Once, even under StrictMode's double effects.
    if (started.current || !order) return;
    started.current = true;
    void save('3mf');
  });

  return (
    <main className="model-page">
      <header className="order-header">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          Mini Book Labels
        </a>
      </header>
      {order ? (
        <>
          <h1 className="order-title">Model</h1>
          <p>{describeOrder(order)}</p>
          <p className="muted">
            <code>{code}</code>
          </p>
          {state.building ? (
            <p>Building...</p>
          ) : state.failed ? (
            <p className="error">Could not build the model in this browser.</p>
          ) : (
            state.saved && <p>Downloaded {state.saved}</p>
          )}
          <div className="row">
            <button type="button" className="primary grow" disabled={state.building !== null} onClick={() => void save('3mf')}>
              Download 3MF
            </button>
            <button type="button" disabled={state.building !== null} onClick={() => void save('stl')}>
              STL
            </button>
          </div>
        </>
      ) : (
        <p className="error">Not a valid order code.</p>
      )}
    </main>
  );
}
