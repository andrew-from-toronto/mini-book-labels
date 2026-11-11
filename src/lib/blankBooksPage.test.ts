/** The Blank books page states prices in its table and structured data: they must match the pricing. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { costOfBook, formatCad, handlingPrice } from './pricing';
import { dimsAtScale, SCALES } from './scales';

const html = readFileSync('blank-books/index.html', 'utf8');

describe('the Blank books page', () => {
  it('lists every preset size at its current price', () => {
    for (const { ratio } of SCALES) {
      const row = html.match(new RegExp(`<tr data-scale="${ratio}">(.*?)</tr>`))?.[1];
      expect(row, `row for 1:${ratio}`).toBeTruthy();
      expect(row).toContain(formatCad(costOfBook(dimsAtScale(ratio)).unitPrice));
    }
  });

  it('states the current packing charge and price range', () => {
    expect(html.match(/<span data-packing>(.*?)<\/span>/)?.[1]).toBe(formatCad(handlingPrice()));
    const prices = SCALES.map(({ ratio }) => costOfBook(dimsAtScale(ratio)).unitPrice);
    expect(html).toContain(`"lowPrice": "${(Math.min(...prices) / 100).toFixed(2)}"`);
    expect(html).toContain(`"highPrice": "${(Math.max(...prices) / 100).toFixed(2)}"`);
    expect(html).toContain(`From ${formatCad(Math.min(...prices))} CAD each`);
  });
});
