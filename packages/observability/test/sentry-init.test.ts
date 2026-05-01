// packages/observability/test/sentry-init.test.ts
import { describe, it, expect } from 'vitest';
import { buildSentryOptions, parseTracesSampleRate } from '../src/sentry-init.ts';
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
