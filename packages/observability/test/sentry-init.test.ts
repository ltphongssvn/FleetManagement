// packages/observability/test/sentry-init.test.ts
import { describe, it, expect } from 'vitest';
import { buildSentryOptions, parseTracesSampleRate, createBeforeSend, readDepthLimitFromEnv } from '../src/sentry-init.ts';
import { scrubEvent } from '../src/sentry-scrub.ts';

describe('parseTracesSampleRate', () => {
  it('returns 0.1 default for undefined', () => {
    expect(parseTracesSampleRate(undefined)).toBe(0.1);
  });
  it('returns 0.1 default for NaN', () => {
    expect(parseTracesSampleRate('not-a-number')).toBe(0.1);
  });
  it('returns 0.1 default for negative', () => {
    expect(parseTracesSampleRate('-0.5')).toBe(0.1);
  });
  it('returns 0.1 default for > 1', () => {
    expect(parseTracesSampleRate('1.5')).toBe(0.1);
  });
  it('returns 0.1 default for Infinity', () => {
    expect(parseTracesSampleRate('Infinity')).toBe(0.1);
  });
  it('accepts valid 0', () => {
    expect(parseTracesSampleRate('0')).toBe(0);
  });
  it('accepts valid 1', () => {
    expect(parseTracesSampleRate('1')).toBe(1);
  });
  it('accepts valid mid-range', () => {
    expect(parseTracesSampleRate('0.25')).toBe(0.25);
  });
});

describe('buildSentryOptions', () => {
  it('returns null options when DSN is undefined', () => {
    const r = buildSentryOptions({ dsn: undefined });
    expect(r.options).toBeNull();
    expect(r.skipReason).toBeDefined();
  });

  it('returns null options when DSN is empty', () => {
    const r = buildSentryOptions({ dsn: '' });
    expect(r.options).toBeNull();
  });

  it('returns null options when DSN is malformed', () => {
    const r = buildSentryOptions({ dsn: 'not-a-dsn' });
    expect(r.options).toBeNull();
    expect(r.skipReason).toBeDefined();
  });

  it('returns full options for valid DSN', () => {
    const r = buildSentryOptions({
      dsn: 'https://abc@host.io/1',
      environment: 'production',
      tracesSampleRate: '0.5',
      release: 'v1.2.3',
    });
    expect(r.options).not.toBeNull();
    expect(r.options?.dsn).toBe('https://abc@host.io/1');
    expect(r.options?.environment).toBe('production');
    expect(r.options?.tracesSampleRate).toBe(0.5);
    expect(r.options?.release).toBe('v1.2.3');
    expect(r.options?.sendDefaultPii).toBe(false);
    expect(r.options?.beforeSend).toBe(scrubEvent);
  });

  it('defaults environment to development when omitted', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.environment).toBe('development');
  });

  it('defaults tracesSampleRate to 0.1 when omitted', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.tracesSampleRate).toBe(0.1);
  });

  it('omits release when not provided', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
    expect(r.options?.release).toBeUndefined();
  });
});

describe('buildSentryOptions release defaulting', () => {
  it('uses provided release verbatim', () => {
    const r = buildSentryOptions({ dsn: 'https://abc@host.io/1', release: 'v9.9.9' });
    expect(r.options?.release).toBe('v9.9.9');
  });

  it('does not fall back to npm_package_version (env-derived release is brittle)', () => {
    const orig = process.env['npm_package_version'];
    process.env['npm_package_version'] = 'should-be-ignored';
    try {
      const r = buildSentryOptions({ dsn: 'https://abc@host.io/1' });
      expect(r.options?.release).toBeUndefined();
    } finally {
      if (orig === undefined) delete process.env['npm_package_version'];
      else process.env['npm_package_version'] = orig;
    }
  });
});

describe('createBeforeSend factory', () => {
  it('returns scrubEvent function by default', () => {
    const beforeSend = createBeforeSend();
    expect(typeof beforeSend).toBe('function');
    const out = beforeSend({ message: 'Bearer abc.def-ghi' });
    expect(out.message).toBe('[redacted]');
  });

  it('accepts auditLog option to track redaction counts', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({
      auditLog: (count: number) => counts.push(count),
    });
    beforeSend({ message: 'Bearer abc.def-ghi and jane@example.com', request: { data: { password: 'p' } } });
    expect(counts).toHaveLength(1);
    expect(counts[0]).toBeGreaterThanOrEqual(2);
  });

  it('does not call auditLog when no redactions occur', () => {
    const counts: number[] = [];
    const beforeSend = createBeforeSend({ auditLog: (c: number) => counts.push(c) });
    beforeSend({ message: 'plain text' });
    expect(counts).toEqual([0]);
  });
});

describe('createBeforeSend with audit metadata', () => {
  it('adds __redaction metadata to event.extra when annotateEvent is true', () => {
    const beforeSend = createBeforeSend({ annotateEvent: true });
    const out = beforeSend({ message: 'Bearer abc.def-ghi', request: { data: { password: 'p' } } });
    const meta = out.extra?.['__redaction'] as { count: number } | undefined;
    expect(meta).toBeDefined();
    expect(meta?.count).toBeGreaterThanOrEqual(2);
  });

  it('does not add __redaction metadata when annotateEvent is false (default)', () => {
    const beforeSend = createBeforeSend();
    const out = beforeSend({ message: 'Bearer abc.def-ghi' });
    expect(out.extra?.['__redaction']).toBeUndefined();
  });
});

describe('readDepthLimitFromEnv', () => {
  it('returns env value when valid number', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '4' })).toBe(4);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env unset', () => {
    expect(readDepthLimitFromEnv({})).toBe(6);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env is non-numeric', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: 'abc' })).toBe(6);
  });

  it('returns DEFAULT_DEPTH_LIMIT when env value out of range', () => {
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '999' })).toBe(6);
    expect(readDepthLimitFromEnv({ FLEET_SCRUB_DEPTH: '-1' })).toBe(6);
  });
});

