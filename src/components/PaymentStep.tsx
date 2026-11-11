import { useEffect, useRef, useState } from 'react';
import {
  loadStripe,
  type StripeAddressElementChangeEvent,
  type StripeCheckoutLoadActionsSuccess,
  type StripeCheckoutSession,
} from '@stripe/stripe-js';
import { SHIPPING_COUNTRIES } from '../../worker/shipping';

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
  const contactHost = useRef<HTMLDivElement>(null);
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

      // The buyer's email, for Stripe's receipt and ours; Stripe needs it before payment.
      const contact = checkout.createContactDetailsElement();
      contact.mount(contactHost.current!);
      destroy.push(() => contact.destroy());

      // A standalone address form, not the session's own: only our server may set shipping on the session
      // (so its price always comes from a real quote), and Stripe refuses to confirm while the session's
      // shipping form is on the page. The server writes this address to the session when it quotes.
      const shipping = stripe
        .elements({ appearance: appearance() })
        .create('address', { mode: 'shipping', allowedCountries: [...SHIPPING_COUNTRIES] });
      shipping.mount(shippingHost.current!);
      destroy.push(() => shipping.destroy());
      // Quote once the address is complete and has changed, after typing settles.
      let quoted = '';
      shipping.on('change', (event) => {
        clearTimeout(quoteTimer);
        const key = JSON.stringify(event.value);
        if (event.complete && key !== quoted) {
          quoteTimer = setTimeout(() => {
            quoted = key;
            void quote(event.value);
          }, 400);
        }
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
    try {
      const result = await actions.confirm();
      if (result.type === 'error') setMessage(result.error.message);
    } catch (e) {
      // Stripe throws for mistakes in the integration rather than returning them; never leave the button stuck.
      console.error('confirm failed', e);
      setMessage('Payment could not start. Try again, or contact us if it keeps happening.');
    }
    setPhase('ready');
  }

  const options = session?.shippingOptions ?? [];
  const chosen = session?.shipping?.shippingOption.id;

  return (
    <div className="payment-step">
      <h3>Shipping</h3>
      {phase === 'loading' && <div className="field-placeholder short" aria-hidden="true" />}
      <div ref={contactHost} />
      {phase === 'loading' && <div className="field-placeholder tall" aria-hidden="true" />}
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

      <div className="pay-heading">
        <h3>
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
            <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <rect x="2.5" y="7" width="11" height="8" rx="1.5" fill="currentColor" />
          </svg>
          Payment
        </h3>
        <a className="stripe-badge" href="https://stripe.com" target="_blank" rel="noopener">
          <img src="/powered-by-stripe.svg" alt="Powered by Stripe" width={106} height={24} />
        </a>
      </div>
      {phase === 'loading' && <div className="field-placeholder" aria-hidden="true" />}
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
