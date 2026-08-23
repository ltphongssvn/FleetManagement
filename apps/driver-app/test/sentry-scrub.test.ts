// apps/driver-app/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import { scrub, scrubString } from '@fleet/observability';

describe('@fleet/driver-app - PII scrubber', () => {
  it('redacts password (case-insensitive)', () => {
    expect(scrub({ Password: 'x' })).toEqual({ Password: '[redacted]' });
  });

  it('redacts pushToken + apiKey', () => {
    expect(scrub({ expoPushToken: 'X', apiKey: 'Y' })).toEqual({
      expoPushToken: '[redacted]',
      apiKey: '[redacted]',
    });
  });

  it('redacts JWT in error string', () => {
    expect(scrubString('Bearer eyJ.aaa.bbb fail')).toBe('[redacted] fail');
  });

  it('caps depth (circular)', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => scrub(a)).not.toThrow();
  });

  it('scrubs nested arrays', () => {
    expect(scrub([{ password: 'p' }])).toEqual([{ password: '[redacted]' }]);
  });

  it('preserves non-PII', () => {
    expect(scrub({ actionId: 'A' })).toEqual({ actionId: 'A' });
  });

  it('redacts gps coords', () => {
    expect(scrub({ latitude: 37.7 })).toEqual({ latitude: '[redacted]' });
  });

  it('handles deeply nested objects', () => {
    const deep = { a: { b: { c: { d: { e: { token: 'x' } } } } } };
    const result = scrub(deep) as { a: { b: { c: { d: { e: { token: string } } } } } };
    expect(result.a.b.c.d.e.token).toBe('[redacted]');
  });

  it('handles Date objects (preserved as object, no PII keys)', () => {
    const d = new Date('2026-04-30T00:00:00Z');
    const r = scrub({ when: d }) as { when: unknown };
    expect(r.when).toEqual({});
  });

  it('handles mixed arrays (primitives + objects + nulls)', () => {
    expect(scrub([1, null, { token: 'x' }, 'plain string'])).toEqual([
      1,
      null,
      { token: '[redacted]' },
      'plain string',
    ]);
  });

  it('redacts strings inside nested arrays', () => {
    expect(scrub({ logs: ['Bearer eyJ.aa.bb', 'ok'] })).toEqual({ logs: ['[redacted]', 'ok'] });
  });

  it('handles empty object and empty array', () => {
    expect(scrub({})).toEqual({});
    expect(scrub([])).toEqual([]);
  });
});
