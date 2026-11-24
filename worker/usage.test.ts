import { describe, expect, it, vi } from 'vitest';
import { columnOf } from '../src/lib/usage';
import { BREAKDOWNS, DATASET, runQuery, usageQueries, usageReport } from './usage';

describe('usage queries', () => {
  it('read each breakdown from its event column, for the period asked', () => {
    const q = usageQueries(30);
    expect(q.library).toBe(
      `SELECT ${columnOf('library', 'how')} AS value, SUM(_sample_interval) AS n FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob1 = 'library' GROUP BY value ORDER BY n DESC LIMIT 12`,
    );
    expect(q['total.labels']).toContain(`_sample_interval * ${columnOf('output', 'labels')}`);
    expect(q['total.labels']).toContain(`${columnOf('output', 'ok')} = 'yes'`);
    for (const b of BREAKDOWNS) expect(q[b.id]).toContain(`blob1 = '${b.event}'`);
  });

  it('asks the SQL API with the token and turns numbers back into numbers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ value: 'shop', n: '12' }] })));
    const rows = await runQuery({ ANALYTICS_API_TOKEN: 't', CF_ACCOUNT_ID: 'acct' }, 'SELECT 1', fetcher as unknown as typeof fetch);
    expect(rows).toEqual([{ value: 'shop', n: 12 }]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql');
    expect(init.headers).toEqual({ Authorization: 'Bearer t' });
    expect(init.body).toBe('SELECT 1 FORMAT JSON');
  });

  it('reports a failed query by itself, not the whole page', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => (calls++ === 0 ? new Response('bad query', { status: 422 }) : new Response(JSON.stringify({ data: [] }))));
    const report = await usageReport({ ANALYTICS_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' }, 7, fetcher as unknown as typeof fetch);
    const results = Object.values(report.results);
    expect(results.filter((r) => !Array.isArray(r))).toHaveLength(1);
    expect(results.filter((r) => Array.isArray(r)).length).toBeGreaterThan(10);
  });
});
