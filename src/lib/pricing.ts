/**
 * Cost-plus pricing for printed blank books: what a book costs to make (plastic, printer time, hands-on
 * time, an allowance for failed prints) plus a markup, and a once-per-order charge for packing. Shared
 * by the app, which shows the price, and the Worker, which charges it, so the two always agree.
 *
 * Prices are in Canadian cents. Inputs marked PLACEHOLDER are estimates to replace with measured numbers.
 */
import type { Dims } from './scales';

export interface CostInputs {
  /** Filament price, $ per kg. */
  filamentPerKg: number;
  /** g per cm³: PLA is about 1.24. */
  filamentDensity: number;
  /** Share of a solid book's plastic actually printed (1 for solid; less with sparse infill). */
  infillShare: number;
  /** Printer minutes per book, batched on a full plate: a fixed part plus a part per cm³ of plastic. */
  printMinutesPerBook: number;
  printMinutesPerCm3: number;
  /** Power and wear, $ per printer hour. */
  printerPerHour: number;
  /** Your time: $ per hour, minutes per book (removing, checking) and minutes per order (packing). */
  labourPerHour: number;
  handlingMinutesPerBook: number;
  packingMinutesPerOrder: number;
  /** Mailer and padding, $ per order. */
  packagingPerOrder: number;
  /** Extra charged per book for prints that fail, as a share: 0.1 is 10%. */
  failureAllowance: number;
  /** Profit on top of cost, as a share: 0.5 is 50%. */
  markup: number;
}

export const COST_INPUTS: CostInputs = {
  filamentPerKg: 20, // 2 kg for about $40.
  filamentDensity: 1.24,
  infillShare: 1, // PLACEHOLDER: these are small enough to print solid.
  // Measured: two 1:7 books (2.9 cm³ each) in about 8 minutes, so about 4 minutes a book. Time a full
  // plate of another size to check how it scales.
  printMinutesPerBook: 1,
  printMinutesPerCm3: 1,
  printerPerHour: 0.5, // PLACEHOLDER: power and wear.
  labourPerHour: 25, // PLACEHOLDER
  handlingMinutesPerBook: 2, // PLACEHOLDER
  packingMinutesPerOrder: 10, // PLACEHOLDER
  packagingPerOrder: 1.5, // PLACEHOLDER: a small padded mailer.
  failureAllowance: 0.1, // PLACEHOLDER
  markup: 0.5, // PLACEHOLDER
};

/**
 * Plastic in a book, in cm³. The model fills about 97% of its outer box (covers, spine and page block;
 * the overhang and page lines take the rest), measured against the real mesh at every preset size.
 */
export const bookVolumeCm3 = ({ height, width, spine }: Dims) => (0.97 * height * width * spine) / 1000;

export interface BookCost {
  grams: number;
  printMinutes: number;
  filament: number;
  printer: number;
  labour: number;
  /** Before the failure allowance and markup. */
  subtotal: number;
  cost: number;
  /** Price per book in cents, rounded up to the next 25 cents. */
  unitPrice: number;
}

/** Rounds dollars up to the next 25 cents, as cents. */
const quarterCents = (dollars: number) => Math.ceil((dollars * 100 - 1e-6) / 25) * 25;

export function costOfBook(dims: Dims, inputs: CostInputs = COST_INPUTS): BookCost {
  const volume = bookVolumeCm3(dims) * inputs.infillShare;
  const grams = volume * inputs.filamentDensity;
  const printMinutes = inputs.printMinutesPerBook + volume * inputs.printMinutesPerCm3;
  const filament = (grams / 1000) * inputs.filamentPerKg;
  const printer = (printMinutes / 60) * inputs.printerPerHour;
  const labour = (inputs.handlingMinutesPerBook / 60) * inputs.labourPerHour;
  const subtotal = filament + printer + labour;
  const cost = subtotal * (1 + inputs.failureAllowance);
  return { grams, printMinutes, filament, printer, labour, subtotal, cost, unitPrice: quarterCents(cost * (1 + inputs.markup)) };
}

/** Packing and handling, once per order, in cents: packing time and materials, with the markup. */
export function handlingPrice(inputs: CostInputs = COST_INPUTS): number {
  const cost = (inputs.packingMinutesPerOrder / 60) * inputs.labourPerHour + inputs.packagingPerOrder;
  return quarterCents(cost * (1 + inputs.markup));
}

export interface OrderPrice {
  unitPrice: number;
  quantity: number;
  books: number;
  handling: number;
  /** Before shipping, which is chosen at checkout. No sales tax is charged (small supplier, under $30,000 a year). */
  subtotal: number;
}

export const MAX_QUANTITY = 50;

export function priceOrder(dims: Dims, quantity: number, inputs: CostInputs = COST_INPUTS): OrderPrice {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new RangeError(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
  }
  const { unitPrice } = costOfBook(dims, inputs);
  const handling = handlingPrice(inputs);
  return { unitPrice, quantity, books: unitPrice * quantity, handling, subtotal: unitPrice * quantity + handling };
}

export const formatCad = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One line of a price, shown to the buyer so they can see what they pay for. */
export interface PriceLine {
  label: string;
  cents: number;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

/**
 * What a book's price is made of, in cents: materials and equipment (plastic and printer time), labour,
 * and the margin. The allowance for failed prints is shared between the first two, since a reprint costs
 * both. The margin is what is left, including the rounding to 25 cents, so the lines always add up
 * exactly to the price charged.
 */
export function bookBreakdown(dims: Dims, inputs: CostInputs = COST_INPUTS): PriceLine[] {
  const c = costOfBook(dims, inputs);
  const withFailures = 1 + inputs.failureAllowance;
  const costs: PriceLine[] = [
    { label: 'Equipment', cents: toCents((c.filament + c.printer) * withFailures) },
    { label: 'Labour', cents: toCents(c.labour * withFailures) },
  ];
  const spent = costs.reduce((sum, line) => sum + line.cents, 0);
  return [...costs, { label: 'Margin', cents: c.unitPrice - spent }];
}

/** What packing and handling is made of, in cents, adding up exactly to handlingPrice(). */
export function handlingBreakdown(inputs: CostInputs = COST_INPUTS): PriceLine[] {
  const costs: PriceLine[] = [
    { label: 'Materials', cents: toCents(inputs.packagingPerOrder) },
    { label: 'Labour', cents: toCents((inputs.packingMinutesPerOrder / 60) * inputs.labourPerHour) },
  ];
  const spent = costs.reduce((sum, line) => sum + line.cents, 0);
  return [...costs, { label: 'Margin', cents: handlingPrice(inputs) - spent }];
}
