// workers/main-worker/test/extraction-policy-number-format.test.ts
// RED: drives promoting parseOneNumber to an export so its Vietnamese number-format
// rules can be unit-tested directly (not only transitively via parseNetWeightKg).
// Fails until the parse-one-number codemod exports it from extraction-policy.ts.
import { describe, it, expect } from 'vitest';
import { parseOneNumber } from '../src/extraction/extraction-policy.js';

describe('parseOneNumber number-format rules (direct)', () => {
  it('dot plus exactly 3 digits is a thousands separator', () => {
    expect(parseOneNumber('20.730')).toBe(20730);
  });
  it('dot plus 1-2 digits is a decimal point', () => {
    expect(parseOneNumber('7.25')).toBe(7.25);
  });
  it('comma plus 1-2 digits is a decimal comma', () => {
    expect(parseOneNumber('9.850,5')).toBe(9850.5);
  });
  it('strips a kg suffix before parsing', () => {
    expect(parseOneNumber('20.730 kg')).toBe(20730);
  });
  it('returns null for unparseable input', () => {
    expect(parseOneNumber('abc')).toBe(null);
  });
});
