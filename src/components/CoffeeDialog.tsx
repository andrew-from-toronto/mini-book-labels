import { useEffect, useRef, useState } from 'react';
import { loadStripe, type StripeCheckoutLoadActionsSuccess, type StripeCheckoutSession } from '@stripe/stripe-js';
import { PaymentHeading, stripeAppearance } from './stripeUi';

const AMOUNTS = [300, 500, 1000];

type Actions = StripeCheckoutLoadActionsSuccess;

/**
 * "Buy me a coffee": pick an amount, then pay in the dialog with the same Stripe form as orders.
 * `thanks` opens straight to the thank-you, for a buyer back from a bank's own check.
 */
export function CoffeeDialog({ thanks = false, onClose }: { thanks?: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const contactHost = useRef<HTMLDivElement>(null);
  const paymentHost = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [amount, setAmount] = useState(500);
  const [other, setOther] = useState('');
  const [step, setStep] = useState<'choose' | 'paying' | 'thanks'>(thanks ? 'thanks' : 'choose');
  const [session, setSession] = useState<StripeCheckoutSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const cents = other ? Math.round(Number(other) * 100) : amount;
  const valid = Number.isInteger(cents) && cents >= 100 && cents <= 20_000;

  useEffect(() => {
    if (step !== 'paying') return;
    let cancelled = false;
    const destroy: (() => void)[] = [];
    (async () => {
      const res = await fetch('/api/checkout/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: cents }),
      });
      const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; publishableKey?: string; error?: string };
      if (!res.ok || !data.clientSecret || !data.publishableKey) throw new Error(data.error ?? 'Payments are not available right now.');
      const stripe = await loadStripe(data.publishableKey);
      if (!stripe || cancelled) return;
      const checkout = stripe.initCheckoutElementsSdk({ clientSecret: data.clientSecret, elementsOptions: { appearance: stripeAppearance() } });
      checkout.on('change', (s) => !cancelled && setSession(s));
      const contact = checkout.createContactDetailsElement();
      contact.mount(contactHost.current!);
      destroy.push(() => contact.destroy());
      const payment = checkout.createPaymentElement();
      payment.mount(paymentHost.current!);
      destroy.push(() => payment.destroy());
      const loaded = await checkout.loadActions();
      if (cancelled) return;
      if (loaded.type !== 'success') throw new Error(loaded.error.message);
      actionsRef.current = loaded.actions;
      setSession(loaded.actions.getSession());
    })().catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setStep('choose');
    });
    return () => {
      cancelled = true;
      destroy.forEach((d) => d());
      actionsRef.current = null;
    };
    // The amount is fixed once paying starts.
  }, [step]);

  async function pay() {
    const actions = actionsRef.current;
    if (!actions) return;
    setBusy(true);
    setError('');
    try {
      // Stays on the page unless a bank needs its own check; then it comes back to ?coffee=thanks.
      const result = await actions.confirm({ redirect: 'if_required' });
      if (result.type === 'error') setError(result.error.message);
      else setStep('thanks');
    } catch (e) {
      console.error('coffee payment failed', e);
      setError('Payment could not start. Try again.');
    }
    setBusy(false);
  }

  return (
    <dialog ref={dialog} className="coffee-dialog" onClose={onClose} aria-labelledby="coffee-title">
      <header>
        <h2 id="coffee-title">Buy me a coffee</h2>
        <button type="button" className="close" onClick={() => dialog.current?.close()} aria-label="Close">
          ×
        </button>
      </header>
      {step === 'choose' && (
        <div className="coffee-choose">
          <fieldset className="coffee-amounts">
            <legend>Amount (CAD)</legend>
            {AMOUNTS.map((a) => (
              <label key={a} className="swatch">
                <input
                  type="radio"
                  name="coffee"
                  checked={!other && amount === a}
                  onChange={() => {
                    setAmount(a);
                    setOther('');
                  }}
                />
                ${a / 100}
              </label>
            ))}
          </fieldset>
          <label>
            Other amount
            <input type="number" min={1} max={200} step={1} inputMode="decimal" placeholder="$" value={other} onChange={(e) => setOther(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="primary"
            disabled={!valid}
            onClick={() => {
              setError('');
              setSession(null);
              setStep('paying');
            }}
          >
            {valid ? `Continue · $${(cents / 100).toFixed(2)} CAD` : 'Continue'}
          </button>
        </div>
      )}
      {step === 'paying' && (
        <div className="coffee-choose payment-step">
          {!session && <div className="field-placeholder short" aria-hidden="true" />}
          <div ref={contactHost} />
          <PaymentHeading />
          {!session && <div className="field-placeholder" aria-hidden="true" />}
          <div ref={paymentHost} />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="button" disabled={busy} onClick={() => setStep('choose')}>
              Back
            </button>
            <button type="button" className="primary grow" disabled={!session?.canConfirm || busy} onClick={() => void pay()}>
              {busy ? 'Paying...' : `Pay ${session?.total.total.amount ?? ''}`}
            </button>
          </div>
        </div>
      )}
      {step === 'thanks' && (
        <div className="coffee-thanks">
          <p>Thank you!</p>
          <button type="button" className="primary" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
