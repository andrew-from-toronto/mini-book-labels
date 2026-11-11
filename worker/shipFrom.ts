/**
 * Where blanks are made and shipped from, for customs line items (US and international parcels need the
 * manufacturer's address). Read from environment variables so the address never lives in the source:
 * .dev.vars locally, Worker secrets in production (wrangler secret put SHIP_FROM_STREET, ...).
 */
export interface ShipFromEnv {
  SHIP_FROM_NAME?: string;
  SHIP_FROM_STREET?: string;
  SHIP_FROM_STREET_2?: string;
  SHIP_FROM_CITY?: string;
  SHIP_FROM_PROVINCE?: string;
  SHIP_FROM_POSTAL_CODE?: string;
  SHIP_FROM_COUNTRY?: string;
  /** Some carriers need a phone number on the label (ShipStation does). */
  SHIP_FROM_PHONE?: string;
}

export interface ShipFrom {
  name: string;
  street: string;
  street2: string | null;
  city: string;
  province: string;
  postalCode: string;
  /** Two letters, e.g. CA. */
  country: string;
  phone: string | null;
}

const REQUIRED = [
  'SHIP_FROM_NAME',
  'SHIP_FROM_STREET',
  'SHIP_FROM_CITY',
  'SHIP_FROM_PROVINCE',
  'SHIP_FROM_POSTAL_CODE',
  'SHIP_FROM_COUNTRY',
] as const;

/** The ship-from address, or the names of the variables still missing. */
export function readShipFrom(env: ShipFromEnv): { address: ShipFrom } | { missing: string[] } {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length) return { missing };
  const value = (key: keyof ShipFromEnv) => env[key]!.trim();
  return {
    address: {
      name: value('SHIP_FROM_NAME'),
      street: value('SHIP_FROM_STREET'),
      street2: env.SHIP_FROM_STREET_2?.trim() || null,
      city: value('SHIP_FROM_CITY'),
      province: value('SHIP_FROM_PROVINCE').toUpperCase(),
      postalCode: value('SHIP_FROM_POSTAL_CODE').toUpperCase(),
      country: value('SHIP_FROM_COUNTRY').toUpperCase(),
      phone: env.SHIP_FROM_PHONE?.trim() || null,
    },
  };
}
