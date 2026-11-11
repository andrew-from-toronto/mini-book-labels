/**
 * Where blanks ship. Rates come live from Chit Chats (worker/chitchats.ts) once the buyer's address is
 * known. EU countries wait for a duties-paid option: the EU charges duty on every parcel from July 2026
 * and some EU posts refuse parcels where the buyer pays on delivery.
 */
export const SHIPPING_COUNTRIES = ['CA', 'US', 'GB', 'AU', 'NZ'] as const;
