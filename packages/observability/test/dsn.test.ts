// packages/observability/test/dsn.test.ts
import { describe, it, expect } from 'vitest';
import { parseDsn, dsnSchema } from '../src/dsn.ts';

describe('parseDsn', () => {
  it('accepts valid DSN', () => {
    const r = parseDsn('https://abc123@sentry.example.com/42');
    expect(r.valid).toBe(true);
    expect(r.dsn).toBe('https://abc123@sentry.example.com/42');
  });

  it('rejects undefined', () => {
    expect(parseDsn(undefined).valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(parseDsn('').valid).toBe(false);
  });

  it('rejects non-https', () => {
    expect(parseDsn('http://abc@host/1').valid).toBe(false);
  });

  it('rejects missing project id', () => {
    expect(parseDsn('https://abc@host/').valid).toBe(false);
  });

  it('rejects garbage', () => {
    expect(parseDsn('not-a-dsn').valid).toBe(false);
  });

  it('returns error message on failure', () => {
    const r = parseDsn('bad');
    expect(r.error).toBeDefined();
  });
});

describe('dsnSchema', () => {
  it('parses valid DSN', () => {
    expect(dsnSchema.parse('https://abc@host.io/1')).toBe('https://abc@host.io/1');
  });
  it('throws on invalid', () => {
    expect(() => dsnSchema.parse('bad')).toThrow();
  });
});
