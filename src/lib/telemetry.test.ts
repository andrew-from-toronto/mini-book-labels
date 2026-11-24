import { describe, expect, it } from 'vitest';
import { makeBackup, parseBackup } from './backup';
import { EVENTS } from './usage';
import { coverChange } from './usageEvents';
import { isVisitor, pageName, scrub, visitSource } from './telemetry';

describe('usage telemetry', () => {
  it('names where a visit came from', () => {
    const host = 'minibookornaments.com';
    expect(visitSource('?utm_source=pinterest', '', host)).toEqual({ source: 'campaign:pinterest', referrer: '' });
    expect(visitSource('', '', host)).toEqual({ source: 'direct', referrer: '' });
    expect(visitSource('', 'https://minibookornaments.com/mini-book-ornaments/', host)).toEqual({ source: 'internal', referrer: 'mini-book-ornaments' });
    expect(visitSource('', 'https://www.google.com/search?q=x', host)).toEqual({ source: 'site', referrer: 'google.com' });
  });

  it('names pages', () => {
    expect(pageName('/')).toBe('app');
    expect(pageName('/order/')).toBe('order');
    expect(pageName('/mini-book-ornaments/')).toBe('mini-book-ornaments');
  });

  it('keeps book titles out of error messages', () => {
    expect(scrub('The cover for "Dune" did not load.')).toBe('The cover for "…" did not load.');
  });

  it('tells cover changes apart, and counts slider adjustments once', () => {
    const link = { url: 'https://example.com/a.jpg', wrap: false };
    expect(coverChange('b1', undefined, { url: 'data:image/jpeg;base64,xx', wrap: false })).toBe('upload');
    expect(coverChange('b1', undefined, { url: '/api/cover/id/123-L.jpg', wrap: false })).toBe('edition');
    expect(coverChange('b1', undefined, link)).toBe('link');
    expect(coverChange('b1', undefined, { ...link, wrap: true })).toBe('wrap');
    expect(coverChange('b1', link, null)).toBe('reset');
    const spine = { ...link, wrap: true, spine: { left: 0.4, right: 0.6 } };
    expect(coverChange('b2', { ...link, wrap: true }, spine)).toBe('spine');
    expect(coverChange('b2', spine, { ...spine, spine: { left: 0.41, right: 0.6 } })).toBeNull();
  });

  it('keeps every event within Analytics Engine limits', () => {
    for (const shape of Object.values(EVENTS)) {
      expect(9 + shape.text.length).toBeLessThanOrEqual(20);
      expect(shape.num.length).toBeLessThanOrEqual(20);
    }
  });

  it('carries the visitor in backups, and drops one that is not a visitor', () => {
    const visitor = { id: '0f6c2a1e-1111-4222-8333-944455556666', first: '2026-11-01', visits: 4 };
    const state = { books: [], filters: {} as never, settings: {} as never, overrides: {}, customCovers: {}, panes: {}, order: [] };
    expect(parseBackup(makeBackup({ ...state, visitor })).visitor).toEqual(visitor);
    expect(parseBackup(makeBackup({ ...state, visitor: { id: 'Bob Smith' } as never })).visitor).toBeUndefined();
    expect(isVisitor(visitor)).toBe(true);
  });
});
