// apps/ops-web/test/sentry-scrub.test.ts
import { describe, it, expect } from 'vitest';
import { scrub, scrubString, scrubEvent } from '@fleet/observability';

describe('@fleet/ops-web - PII scrubber', () => {
  it('redacts password (case-insensitive)', () => {
    expect(scrub({ Password: 'x' })).toEqual({ Password: '[redacted]' });
  });

  it('redacts email + JWT in strings', () => {
    expect(scrubString('user a@b.com Bearer eyJhbGciOi.eyJzdWIiOi.X')).toBe(
      'user [redacted] [redacted]',
    );
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
    it('redacts authorization header', () => {
      const e = { request: { headers: { Authorization: 'Bearer eyJ.aa.bb', 'X-Trace': 'ok' } } };
      const r = scrubEvent(e as never);
      const h = (r as { request: { headers: Record<string, string> } }).request.headers;
      expect(h['Authorization']).toBe('[redacted]');
      expect(h['X-Trace']).toBe('ok');
    });

    it('redacts string[] header values', () => {
      const e = { request: { headers: { Cookie: ['a=1', 'b=2'] } } };
      const r = scrubEvent(e as never) as unknown;
      expect(
        (r as { request: { headers: Record<string, string[]> } }).request.headers['Cookie'],
      ).toEqual(['[redacted]']);
    });

    it('scrubs request.data, extra, contexts', () => {
      const e = {
        request: { data: { password: 'p' } },
        extra: { token: 't' },
        contexts: { user: { email: 'a@b.com' } },
      };
      const r = scrubEvent(e as never) as unknown as {
        request: { data: { password: string } };
        extra: { token: string };
        contexts: { user: { email: string } };
      };
      expect(r.request.data.password).toBe('[redacted]');
      expect(r.extra.token).toBe('[redacted]');
      expect(r.contexts.user.email).toBe('[redacted]');
    });

    it('scrubs message and exception values', () => {
      const e = {
        message: 'failed for a@b.com',
        exception: { values: [{ value: 'Bearer eyJ.x.y leaked' }] },
      };
      const r = scrubEvent(e as never) as {
        message: string;
        exception: { values: { value: string }[] };
      };
      expect(r.message).toBe('failed for [redacted]');
      expect(r.exception.values[0]?.value).toBe('[redacted] leaked');
    });

    it('handles event without request/extra/contexts', () => {
      expect(() => scrubEvent({} as never)).not.toThrow();
    });
  });
});
