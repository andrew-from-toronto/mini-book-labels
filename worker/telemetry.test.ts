import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanReport, handleTelemetry } from './telemetry';

describe('telemetry reports', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps short flat values and drops the rest', () => {
    const report = cleanReport({
      event: 'drag',
      build: 'main-abc.js',
      data: { outcome: 'moved', ms: 812.3456, started: true, nested: { a: 1 }, 'bad key': 1, long: 'x'.repeat(500), nan: NaN },
    });
    expect(report).toEqual({
      event: 'drag',
      build: 'main-abc.js',
      data: { outcome: 'moved', ms: 812.35, started: true, long: 'x'.repeat(200) },
    });
  });

  it('refuses anything that is not a report', () => {
    expect(cleanReport(null)).toBeNull();
    expect(cleanReport({ event: 'DROP TABLE' })).toBeNull();
    expect(cleanReport({ event: 'x'.repeat(60) })).toBeNull();
  });

  it('logs one JSON line with the browser added, and nothing for bad requests', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const post = (body: string) =>
      handleTelemetry(new Request('https://x/api/t', { method: 'POST', body, headers: { 'user-agent': 'Chrome/142 Mac' } }));
    expect((await post(JSON.stringify({ event: 'drag', data: { outcome: 'blur' } }))).status).toBe(204);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ telemetry: 'drag', outcome: 'blur', ua: 'Chrome/142 Mac' });
    expect((await post('not json')).status).toBe(400);
    expect((await post('x'.repeat(5000))).status).toBe(413);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
