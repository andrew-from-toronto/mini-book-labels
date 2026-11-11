import { describe, expect, it } from 'vitest';
import {
  bookBreakdown,
  bookVolumeCm3,
  costOfBook,
  COST_INPUTS,
  formatCad,
  handlingBreakdown,
  handlingPrice,
  priceOrder,
} from './pricing';
import { dimsAtScale } from './scales';

describe('bookVolumeCm3', () => {
  it('matches the real model at each preset within 5% (or 0.01 cm³: the hook on the tiniest)', () => {
    // Measured from the printable mesh (with a hook) at each scale.
    const measured: [number, number][] = [[24, 0.08], [12, 0.58], [10, 0.99], [7, 2.89], [6, 4.54], [5, 7.89], [4, 15.5]];
    for (const [ratio, cm3] of measured) {
      const off = Math.abs(bookVolumeCm3(dimsAtScale(ratio)) - cm3);
      expect(off < 0.01 || off / cm3 < 0.05).toBe(true);
    }
  });
});

describe('costOfBook', () => {
  const inputs = { ...COST_INPUTS };

  it('adds up filament, printer time and hands-on time, then the failure allowance and markup', () => {
    const c = costOfBook(dimsAtScale(7), inputs);
    const volume = bookVolumeCm3(dimsAtScale(7));
    expect(c.grams).toBeCloseTo(volume * 1.24, 6);
    expect(c.filament).toBeCloseTo((c.grams / 1000) * 20, 6);
    expect(c.printMinutes).toBeCloseTo(1 + volume * 1, 6);
    expect(c.printer).toBeCloseTo((c.printMinutes / 60) * 0.5, 6);
    expect(c.labour).toBeCloseTo((2 / 60) * 25, 6);
    expect(c.cost).toBeCloseTo((c.filament + c.printer + c.labour) * 1.1, 6);
    // Rounded up to the next 25 cents, never down.
    expect(c.unitPrice % 25).toBe(0);
    expect(c.unitPrice).toBeGreaterThanOrEqual(c.cost * 1.5 * 100);
    expect(c.unitPrice - c.cost * 1.5 * 100).toBeLessThan(25);
  });

  it('costs more for bigger books', () => {
    const prices = [24, 12, 7, 4].map((r) => costOfBook(dimsAtScale(r), inputs).unitPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('follows the inputs: free labour and no markup leave only materials and printer time', () => {
    const c = costOfBook(dimsAtScale(7), { ...inputs, labourPerHour: 0, markup: 0, failureAllowance: 0 });
    expect(c.unitPrice).toBe(Math.ceil((c.filament + c.printer) * 100 / 25) * 25);
  });
});

describe('priceOrder', () => {
  it('charges per book plus one packing and handling charge', () => {
    const order = priceOrder(dimsAtScale(7), 5);
    expect(order.books).toBe(order.unitPrice * 5);
    expect(order.handling).toBe(handlingPrice());
    expect(order.subtotal).toBe(order.books + order.handling);
  });

  it('accepts 1 to 50 whole books only', () => {
    for (const bad of [0, -1, 2.5, 51, Number.NaN]) expect(() => priceOrder(dimsAtScale(7), bad)).toThrow(RangeError);
  });

  it('formats cents as dollars', () => expect(formatCad(1825)).toBe('$18.25'));
});

describe('price breakdowns', () => {
  const total = (lines: { cents: number }[]) => lines.reduce((sum, l) => sum + l.cents, 0);

  it('add up exactly to what is charged, at every size', () => {
    for (const ratio of [24, 12, 10, 7, 6, 5, 4]) {
      const dims = dimsAtScale(ratio);
      expect(total(bookBreakdown(dims))).toBe(costOfBook(dims).unitPrice);
    }
    expect(total(handlingBreakdown())).toBe(handlingPrice());
  });

  it('name the margin plainly and never show it negative', () => {
    const lines = bookBreakdown(dimsAtScale(7));
    expect(lines.at(-1)!.label).toBe('Margin that keeps the site running');
    expect(lines.every((l) => l.cents >= 0)).toBe(true);
    expect(handlingBreakdown().every((l) => l.cents >= 0)).toBe(true);
  });
});
