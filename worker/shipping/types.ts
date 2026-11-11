/**
 * What every shipping vendor provides, so checkout and admin work the same whoever carries the parcel.
 * Each vendor is one file in this folder implementing ShippingProvider, listed in ./index.ts.
 */
import type { Dims } from '../../src/lib/scales';
import type { ShipFrom } from '../shipFrom';

/** Ids are stored on orders and Stripe shipping rates: never rename one in use. */
export type ProviderId = 'chitchats';

export interface Destination {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  /** Two letters where the country has them (provinces, states). */
  state?: string | null;
  postalCode?: string | null;
  /** Two letters. */
  country: string;
}

/** A parcel to send: where, what's in it (for size, weight and customs), and from whom. */
export interface ShipmentRequest {
  to: Destination;
  dims: Dims;
  quantity: number;
  /** Cents, CAD: value of one blank, for customs. */
  unitValue: number;
  shipFrom: ShipFrom;
}

/** One way to send it, from one vendor. */
export interface Rate {
  provider: ProviderId;
  /** The vendor's own service code, to buy the same service later. */
  service: string;
  /** The vendor's name for the service. */
  name: string;
  /** Cents, CAD: everything the label costs, taxes and duties included. */
  amount: number;
  days: { min: number; max: number } | null;
}

/**
 * Where a shipment is, the same for every vendor:
 * unpaid (no label yet), buying, failed (couldn't buy), label (bought, not yet with the carrier),
 * in_transit, delivered, exception (a carrier problem), voided (refunded or cancelled).
 */
export type ShipmentState = 'unpaid' | 'buying' | 'failed' | 'label' | 'in_transit' | 'delivered' | 'exception' | 'voided';

/** A shipment as a vendor reports it. */
export interface Shipment {
  provider: ProviderId;
  id: string;
  state: ShipmentState;
  /** The vendor's own status, for the record. */
  status: string;
  /** The service the label was bought with. */
  service: string | null;
  /** Cents, CAD: what the label cost. */
  cost: number | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  /** A printable label, PDF where the vendor offers it. */
  labelUrl: string | null;
}

export interface ShippingProvider<Env = unknown> {
  id: ProviderId;
  /** As shown in admin. */
  name: string;
  /** Whether its settings are present; vendors without settings are skipped. */
  configured(env: Env): boolean;
  /** live, or test for a sandbox. Throws if the settings are wrong. */
  mode(env: Env): 'live' | 'test';
  /** Rates for a parcel, leaving nothing behind at the vendor. */
  quote(request: ShipmentRequest, env: Env, fetcher?: typeof fetch): Promise<Rate[]>;
  /**
   * Buys a label for the parcel with one of its services. `existing` is a shipment this order already has
   * with this vendor that was never paid for, to reuse rather than create another.
   */
  buy(request: ShipmentRequest, service: string, env: Env, existing?: string | null, fetcher?: typeof fetch): Promise<Shipment>;
  /** The shipment as it is now: its label and tracking. */
  get(id: string, env: Env, fetcher?: typeof fetch): Promise<Shipment>;
  /** Voids the label and asks for the money back. */
  refund(id: string, env: Env, fetcher?: typeof fetch): Promise<Shipment>;
}

/** A vendor said no, or couldn't be reached: the message is safe to show in admin. */
export class ShippingError extends Error {}
