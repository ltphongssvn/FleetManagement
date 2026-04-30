// apps/ops-web/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import { scrub, scrubString } from '@/lib/sentry-scrub';

describe('@fleet/ops-web - PII scrubber', () => {
  it('redacts password (case-insensitive)', () => {
    expect(scrub({ Password: 'x' })).toEqual({ Password: '[redacted]' });
  });

  it('redacts email + JWT in strings', () => {
    expect(scrubString('user a@b.com Bearer eyJhbGciOi.eyJzdWIiOi.X'))
      .toBe('user [redacted] [redacted]');
  });

  it('caps depth on circular refs', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => scrub(a)).not.toThrow();
  });

  it('scrubs nested arrays', () => {
    expect(scrub([{ token: 'a' }])).toEqual([{ token: '[redacted]' }]);
  });

  it('preserves non-PII keys', () => {
    expect(scrub({ runId: 'X' })).toEqual({ runId: 'X' });
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
    expect(scrub([1, null, { token: 'x' }, 'plain string'])).toEqual([1, null, { token: '[redacted]' }, 'plain string']);
  });

  it('redacts strings inside nested arrays', () => {
    expect(scrub({ logs: ['Bearer eyJ.aa.bb', 'ok'] })).toEqual({ logs: ['[redacted]', 'ok'] });
  });

  it('handles empty object and empty array', () => {
    expect(scrub({})).toEqual({});
    expect(scrub([])).toEqual([]);
  });
});
