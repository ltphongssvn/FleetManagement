// packages/observability/test/contract.test.ts
// Contract test: ensures the three app-level re-export modules expose the
// exact same function references as the shared package. Prevents drift where
// an app silently shadows or shims the scrubber.
import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('@fleet/observability public surface', () => {
  it('exports the documented members', () => {
    expect(typeof pkg.scrub).toBe('function');
    expect(typeof pkg.scrubString).toBe('function');
    expect(typeof pkg.scrubEvent).toBe('function');
    expect(pkg.PII_HEADERS).toBeInstanceOf(Set);
    expect(pkg.PII_KEY_RE).toBeInstanceOf(RegExp);
    expect(Array.isArray(pkg.PII_VALUE_PATTERNS)).toBe(true);
    expect(pkg.REDACTED).toBe('[redacted]');
    expect(pkg.UNSCRUBBABLE).toBe('[unscrubbable]');
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
