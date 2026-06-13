// workers/main-worker/test/extraction-policy-number-format.test.ts
// Exercises parseOneNumber's Vietnamese number-format rules directly. The function was
// extracted into @fleet/domain by the extract-parse-one-number codemod (relocated from
// extraction-policy.ts); this imports it from its canonical home, matching the worker source.
import { describe, it, expect } from 'vitest';
import { parseOneNumber } from '@fleet/domain';

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
