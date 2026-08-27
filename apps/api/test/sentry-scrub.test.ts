// apps/api/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import { scrub, scrubString, scrubEvent, type ScrubbableEvent } from '@fleet/observability';

describe('@fleet/api - PII scrubber', () => {
  it('redacts password key (case-insensitive)', () => {
    expect(scrub({ Password: 'hunter2' })).toEqual({ Password: '[redacted]' }); // pragma: allowlist secret
    expect(scrub({ user_password: 'x' })).toEqual({ user_password: '[redacted]' });
  });

  it('redacts email value embedded in string', () => {
    expect(scrubString('login failed for bob@example.com')).toBe('login failed for [redacted]');
  });

  it('redacts JWT in error message', () => {
    expect(scrubString('Bearer eyJhbGciOi.eyJzdWIiOi.AbCdEf')).toBe('[redacted]');
  });

  it('redacts phone numbers', () => {
    expect(scrubString('call +1-555-123-4567 ASAP')).toBe('call [redacted] ASAP');
  });

  it('caps recursion depth (no stack overflow on circular refs)', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => scrub(a)).not.toThrow();
  });

  it('scrubs arrays of objects', () => {
    expect(scrub([{ token: 'a' }, { token: 'b' }])).toEqual([
      { token: '[redacted]' },
      { token: '[redacted]' },
    ]);
  });

  it('preserves non-PII keys', () => {
    expect(scrub({ orderId: 'TO-1', count: 3 })).toEqual({ orderId: 'TO-1', count: 3 });
  });

  it('returns primitives unchanged', () => {
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
  });

  it('redacts gps coordinates', () => {
    expect(scrub({ gpsLat: 37.7, gpsLng: -122.4 })).toEqual({
      gpsLat: '[redacted]',
      gpsLng: '[redacted]',
    });
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

  describe('scrubEvent', () => {
    it('redacts authorization header (string)', () => {
      const e = { request: { headers: { Authorization: 'Bearer eyJ.aa.bb', 'X-Trace': 'ok' } } };
      const r = scrubEvent(e) as { request: { headers: Record<string, string> } };
      expect(r.request.headers['Authorization']).toBe('[redacted]');
      expect(r.request.headers['X-Trace']).toBe('ok');
    });

    it('redacts string[] header values', () => {
      const e = { request: { headers: { Cookie: ['a=1', 'b=2'] } } };
      const r = scrubEvent(e) as { request: { headers: Record<string, string[]> } };
      expect(r.request.headers['Cookie']).toEqual(['[redacted]']);
    });

    it('scrubs request.data, extra, contexts', () => {
      const e = {
        request: { data: { password: 'p' } },
        extra: { token: 't' },
        contexts: { user: { email: 'a@b.com' } },
      };
      const r = scrubEvent(e) as {
        request: { data: { password: string } };
        extra: { token: string };
        contexts: { user: { email: string } };
      };
      expect(r.request.data.password).toBe('[redacted]');
      expect(r.extra.token).toBe('[redacted]');
      expect(r.contexts.user.email).toBe('[redacted]');
    });

    it('scrubs message and exception values', () => {
      const input: ScrubbableEvent = {
        message: 'failed for foo@example.com',
        exception: { values: [{ value: 'Bearer eyJ.x.y leaked' }] },
      };
      const r = scrubEvent(input);
      expect(r.message).toBe('failed for [redacted]');
      const vals = r.exception?.values ?? [];
      expect(vals[0]?.value).toBe('[redacted] leaked');
    });

    it('handles event without request/extra/contexts', () => {
      expect(() => scrubEvent({})).not.toThrow();
    });
  });
});
