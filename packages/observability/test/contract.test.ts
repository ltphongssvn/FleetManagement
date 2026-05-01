// packages/observability/test/contract.test.ts
// Contract test: public surface + PII-leak invariants.
import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.ts';

describe('@fleet/observability public surface', () => {
  it('exports the documented members', () => {
    expect(typeof pkg.scrub).toBe('function');
    expect(typeof pkg.scrubString).toBe('function');
    expect(typeof pkg.scrubEvent).toBe('function');
    expect(typeof pkg.createScrubber).toBe('function');
    expect(typeof pkg.parseDsn).toBe('function');
    expect(pkg.PII_HEADERS).toBeInstanceOf(Set);
    expect(pkg.PII_KEY_RE).toBeInstanceOf(RegExp);
    expect(Array.isArray(pkg.PII_VALUE_PATTERNS)).toBe(true);
    expect(pkg.REDACTED).toBe('[redacted]');
    expect(pkg.UNSCRUBBABLE).toBe('[unscrubbable]');
    expect(pkg.DEFAULT_DEPTH_LIMIT).toBe(6);
  });

  it('REDACTED and UNSCRUBBABLE are distinct sentinels', () => {
    expect(pkg.REDACTED).not.toBe(pkg.UNSCRUBBABLE);
  });

  it('PII_HEADERS values are all lowercase (case-insensitive comparison invariant)', () => {
    for (const h of pkg.PII_HEADERS) {
      expect(h).toBe(h.toLowerCase());
    }
  });
});

describe('@fleet/observability PII-leak invariants', () => {
  it('every PII_HEADERS entry is redacted by scrubEvent', () => {
    for (const headerName of pkg.PII_HEADERS) {
      const input: pkg.ScrubbableEvent = { request: { headers: { [headerName]: 'leaked-value' } } };
      const out = pkg.scrubEvent(input);
      const req = out.request;
      if (!req?.headers) throw new Error('headers missing');
      const headers = req.headers as Record<string, string>;
      expect(headers[headerName], `header ${headerName} must be redacted`).toBe(pkg.REDACTED);
    }
  });

  it('every PII_KEY_RE-matching key is redacted by scrub', () => {
    const piiKeys = ['password', 'authToken', 'api_secret', 'cookie', 'pushToken', 'gps', 'latitude', 'longitude', 'phone', 'email', 'ssn', 'driver_name'];
    for (const key of piiKeys) {
      const out = pkg.scrub({ [key]: 'leaked-value' }) as Record<string, unknown>;
      expect(out[key], `key ${key} must be redacted`).toBe(pkg.REDACTED);
    }
  });

  it('every PII_VALUE_PATTERNS regex redacts via scrubString', () => {
    const samples = ['Bearer abc.def-ghi', 'eyJhbGc.eyJzdWI.SflKxw', 'jane@example.com', '+1 (415) 555-0123'];
    for (const sample of samples) {
      expect(pkg.scrubString(sample), `pattern in "${sample}" must be redacted`).not.toBe(sample);
    }
  });
});
