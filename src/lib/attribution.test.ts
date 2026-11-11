import { describe, expect, it } from 'vitest';
import { captureSource, cleanSource, describeSource, savedSource, sourceFromSearch } from './attribution';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('campaign attribution', () => {
  it('reads only the utm_* parameters', () => {
    expect(sourceFromSearch('?utm_source=pinterest&utm_campaign=holiday&qty=5&gclid=x')).toEqual({ utm_source: 'pinterest', utm_campaign: 'holiday' });
    expect(sourceFromSearch('?code=abc')).toEqual({});
  });

  it('cleans what the browser sends: known keys, short plain text', () => {
    expect(cleanSource({ utm_source: ' pin<script>terest ', utm_medium: 5, order_code: 'x', utm_term: 'a'.repeat(300) })).toEqual({
      utm_source: 'pinscriptterest',
      utm_term: 'a'.repeat(100),
    });
    expect(cleanSource('nope')).toEqual({});
    expect(cleanSource(null)).toEqual({});
  });

  it('keeps a campaign for 30 days, the latest link winning', () => {
    const store = memory();
    captureSource('?utm_medium=cpc', store, 0); // no source: not saved
    expect(savedSource(store, 0)).toEqual({});
    captureSource('?utm_source=google&utm_medium=cpc', store, 0);
    captureSource('?utm_source=pinterest', store, 1000);
    captureSource('', store, 2000); // a later plain visit keeps it
    expect(savedSource(store, 2000)).toEqual({ utm_source: 'pinterest' });
    expect(savedSource(store, 1000 + 31 * 24 * 3600 * 1000)).toEqual({});
  });

  it('describes a campaign for admin', () => {
    expect(describeSource({ utm_source: 'pinterest', utm_medium: 'cpc', utm_campaign: 'holiday' })).toBe('pinterest / cpc / holiday');
  });
});
