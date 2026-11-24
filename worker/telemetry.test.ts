import { afterEach, describe, expect, it, vi } from 'vitest';
import { columnOf } from '../src/lib/usage';
import { browserOf, cleanReport, deviceOf, handleTelemetry, usageRow, writeUsage } from './telemetry';

const VISITOR = '0f6c2a1e-1111-4222-8333-944455556666';

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

  it('logs drag reports as one JSON line with the browser added, and nothing for bad requests', async () => {
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

describe('usage events', () => {
  afterEach(() => vi.restoreAllMocks());

  it('puts each field in its column, with device, browser and visitor worked out', () => {
    const row = usageRow(
      'output',
      'abc-123',
      { visitor: VISITOR, session: 'aaaa-bbbb-cccc', page: 'app', returning: true, coarse: true, vw: 820, vh: 1180, mode: 'shop', ok: true, labels: 28, sheets: 2 },
      'Mozilla/5.0 (iPad) AppleWebKit/605 Version/27 Safari/605',
      'CA',
    );
    expect(row.indexes).toEqual([VISITOR]);
    expect(row.blobs!.slice(0, 9)).toEqual(['output', VISITOR, 'aaaa-bbbb-cccc', 'app', 'abc-123', 'tablet', 'Safari', 'CA', 'returning']);
    const blob = (field: string) => row.blobs![Number(columnOf('output', field)!.slice(4)) - 1];
    const double = (field: string) => row.doubles![Number(columnOf('output', field)!.slice(6)) - 1];
    expect(blob('mode')).toBe('shop');
    expect(blob('ok')).toBe('yes');
    expect(double('labels')).toBe(28);
    expect(double('sheets')).toBe(2);
    expect(row.blobs!.length).toBeLessThanOrEqual(20);
  });

  it('drops an id that is not a random id', () => {
    const row = usageRow('visit', '', { visitor: 'alice@example.com' }, '', null);
    expect(row.blobs![1]).toBe('');
    expect(row.indexes).toEqual(['none']);
  });

  it('writes usage events to Analytics Engine without logging them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeDataPoint = vi.fn();
    const res = await handleTelemetry(
      new Request('https://x/api/t', { method: 'POST', body: JSON.stringify({ event: 'library', data: { how: 'goodreads', books: 84, visitor: VISITOR } }) }),
      { USAGE: { writeDataPoint } },
    );
    expect(res.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint.mock.calls[0][0].blobs[0]).toBe('library');
    expect(log).not.toHaveBeenCalled();
  });

  it('logs and does not count a report that is not a usage event', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeDataPoint = vi.fn();
    await handleTelemetry(new Request('https://x/api/t', { method: 'POST', body: JSON.stringify({ event: 'pipeline-check' }) }), {
      USAGE: { writeDataPoint },
    });
    expect(writeDataPoint).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('writes its own events, such as a paid order', () => {
    const writeDataPoint = vi.fn();
    writeUsage({ USAGE: { writeDataPoint } }, 'order', { step: 'paid', visitor: VISITOR, quantity: 3, amount: 4500 });
    expect(writeDataPoint.mock.calls[0][0].blobs.slice(0, 4)).toEqual(['order', VISITOR, '', 'worker']);
  });

  it('tells devices and browsers apart', () => {
    expect(deviceOf({ coarse: false, vw: 400, vh: 800 })).toBe('desktop');
    expect(deviceOf({ coarse: true, vw: 390, vh: 844 })).toBe('phone');
    expect(deviceOf({ coarse: true, vw: 1366, vh: 1024 })).toBe('tablet');
    expect(browserOf('Mozilla/5.0 (Macintosh) AppleWebKit/537 Chrome/156 Safari/537')).toBe('Chrome');
    expect(browserOf('Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/27.2 Safari/605')).toBe('Safari');
    expect(browserOf('Mozilla/5.0 Chrome/156 Safari/537 Edg/156')).toBe('Edge');
    expect(browserOf('Mozilla/5.0 Firefox/150')).toBe('Firefox');
  });
});
