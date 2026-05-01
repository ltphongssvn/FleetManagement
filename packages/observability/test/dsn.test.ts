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

describe('parseDsn anchor + error message tests (mutation hardening)', () => {
  it('rejects DSN with leading garbage (^ anchor)', () => {
    expect(parseDsn('XXhttps://abc@host.io/1').valid).toBe(false);
  });
  it('rejects DSN with trailing garbage ($ anchor)', () => {
    expect(parseDsn('https://abc@host.io/1XX').valid).toBe(false);
  });
  it('error for empty string is "DSN is undefined or empty"', () => {
    expect(parseDsn('').error).toBe('DSN is undefined or empty');
  });
  it('error for undefined is "DSN is undefined or empty"', () => {
    expect(parseDsn(undefined).error).toBe('DSN is undefined or empty');
  });
  it('error for malformed contains "DSN must"', () => {
    const e = parseDsn('not-a-dsn').error ?? '';
    expect(e).toMatch(/DSN must/);
  });
  it('error for empty-min message contains "must not be empty"', () => {
    // dsnSchema.parse('') triggers .min(1, "DSN must not be empty")
    try {
      dsnSchema.parse('');
    } catch (err) {
      const issues = (err as { issues: { message: string }[] }).issues;
      expect(issues[0]?.message).toBe('DSN must not be empty');
    }
  });
});

