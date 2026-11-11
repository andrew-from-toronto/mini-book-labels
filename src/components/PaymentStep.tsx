import { useEffect, useRef, useState } from 'react';
import {
  loadStripe,
  type StripeAddressElementChangeEvent,
  type StripeCheckoutLoadActionsSuccess,
  type StripeCheckoutSession,
} from '@stripe/stripe-js';

interface Props {
  /** Order code: the blank's size, options and colour. */
  code: string;
  quantity: number;
  onBack: () => void;
}

type Actions = StripeCheckoutLoadActionsSuccess;

/** Stripe's fields in the site's colours, following light and dark mode. */
function appearance() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    theme: dark ? ('night' as const) : ('stripe' as const),
    variables: {
      colorPrimary: dark ? '#e0a27c' : '#8a4b2a',
      colorBackground: dark ? '#262421' : '#fffdf9',
      colorText: dark ? '#ece7df' : '#23201c',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      borderRadius: '6px',
    },
  };
}

const days = (option: StripeCheckoutSession['shippingOptions'][number]) => {
  const e = option.deliveryEstimate;
  if (!e?.minimum || !e.maximum) return '';
  return e.minimum.value === e.maximum.value ? `${e.maximum.value} days` : `${e.minimum.value}-${e.maximum.value} days`;
};

/** Shipping and payment, on our page with Stripe Elements. Shipping prices come live from Chit Chats. */
export function PaymentStep({ code, quantity, onBack }: Props) {
  const shippingHost = useRef<HTMLDivElement>(null);
  const paymentHost = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<Actions | null>(null);
  const [session, setSession] = useState<StripeCheckoutSession | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'quoting' | 'paying' | 'failed'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const destroy: (() => void)[] = [];
    let quoteTimer: ReturnType<typeof setTimeout> | undefined;

    /** Asks our server to quote this address and put the options on the session. */
    const quote = async (value: StripeAddressElementChangeEvent['value']) => {
      const actions = actionsRef.current;
      if (!actions) return;
      setPhase('quoting');
      setMessage('');
      const result = await actions.runServerUpdate(async () => {
        const res = await fetch('/api/checkout/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: actions.getSession().id, shipping: value }),
        });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Shipping failed');
      });
      if (cancelled) return;
      if (result.type === 'error') setMessage(result.error.message);
      setPhase('ready');
    };

    (async () => {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, quantity }),
      });
      const data = (await res.json().catch(() => ({}))) as { clientSecret?: string; publishableKey?: string; error?: string };
      if (!res.ok || !data.clientSecret || !data.publishableKey) throw new Error(data.error ?? 'Checkout is not available.');
      const stripe = await loadStripe(data.publishableKey);
      if (!stripe || cancelled) return;

      const checkout = stripe.initCheckoutElementsSdk({
        clientSecret: data.clientSecret,
        elementsOptions: { appearance: appearance() },
      });
      checkout.on('change', (s) => !cancelled && setSession(s));

      const shipping = checkout.createShippingAddressElement();
      shipping.mount(shippingHost.current!);
      destroy.push(() => shipping.destroy());
      // Quote once the address is complete, after typing settles.
      shipping.on('change', (event) => {
        clearTimeout(quoteTimer);
        if (event.complete) quoteTimer = setTimeout(() => void quote(event.value), 400);
      });

      const payment = checkout.createPaymentElement();
      payment.mount(paymentHost.current!);
      destroy.push(() => payment.destroy());

      const loaded = await checkout.loadActions();
      if (cancelled) return;
      if (loaded.type !== 'success') throw new Error(loaded.error.message);
      actionsRef.current = loaded.actions;
      setSession(loaded.actions.getSession());
      setPhase('ready');
    })().catch((e) => {
      if (cancelled) return;
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    });

    return () => {
      cancelled = true;
      clearTimeout(quoteTimer);
      destroy.forEach((d) => d());
    };
  }, [code, quantity]);

  async function pay() {
    const actions = actionsRef.current;
    if (!actions) return;
    setPhase('paying');
    setMessage('');
    // On success Stripe goes to the thanks page; a returned result means it didn't go through.
    const result = await actions.confirm();
    if (result.type === 'error') setMessage(result.error.message);
    setPhase('ready');
  }

  const options = session?.shippingOptions ?? [];
  const chosen = session?.shipping?.shippingOption.id;

  return (
    <div className="payment-step">
      <h3>Shipping</h3>
      <div ref={shippingHost} />
      {phase === 'quoting' && <p className="muted">Getting shipping prices...</p>}
      {options.length > 0 && (
        <fieldset className="shipping-options">
          <legend>Delivery</legend>
          {options.map((o) => (
            <label key={o.id} className="shipping-option">
              <input
                type="radio"
                name="shipping"
                checked={chosen === o.id}
                onChange={() => void actionsRef.current?.updateShippingOption(o.id)}
              />
              <span>{o.displayName}</span>
              <span className="muted">{days(o)}</span>
              <strong>{o.amount}</strong>
            </label>
          ))}
        </fieldset>
      )}

      <h3>Payment</h3>
      <div ref={paymentHost} />

      {session && (
        <dl className="pay-total">
          <dt>Blanks and packing</dt>
          <dd>{session.total.subtotal.amount}</dd>
          <dt>Shipping</dt>
          <dd>{session.shipping ? session.total.shippingRate.amount : '—'}</dd>
          <dt>Total</dt>
          <dd>
            <strong>{session.total.total.amount}</strong>
          </dd>
        </dl>
      )}
      {message && <p className="error">{message}</p>}
      <div className="row">
        <button type="button" onClick={onBack} disabled={phase === 'paying'}>
          Back
        </button>
        <button
          type="button"
          className="primary grow"
          disabled={!session?.canConfirm || phase !== 'ready'}
          onClick={() => void pay()}
        >
          {phase === 'paying' ? 'Paying...' : session ? `Pay ${session.total.total.amount}` : 'Pay'}
        </button>
      </div>
    </div>
  );
}
