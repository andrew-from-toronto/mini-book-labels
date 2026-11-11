/** What every payment form on the site shares, so they all look the same. */

/** Stripe's fields in the site's colours, following light and dark mode. */
export function stripeAppearance() {
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

/** The Payment heading with its lock, and Stripe's badge beside it. */
export function PaymentHeading() {
  return (
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
  );
}
