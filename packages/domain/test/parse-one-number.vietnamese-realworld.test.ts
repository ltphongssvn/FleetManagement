// packages/domain/test/parse-one-number.vietnamese-realworld.test.ts
// Real-world Phiếu Cân net-weight strings a correct VLM read can produce.
// VN: '.'=thousands ','=decimal; SI/locale group separator is a (narrow) space,
// commonly emitted by OCR/VLM; unit token varies (kg/kgs/Kg.).
import { describe, it, expect } from 'vitest';
import { parseOneNumber } from '../src/number-format/parse-one-number.js';

describe('parseOneNumber — whitespace thousands grouping', () => {
  it('ASCII space as thousands separator', () => {
    expect(parseOneNumber('20 730')).toBe(20730);
  });
  it('space-grouped with kg suffix', () => {
    expect(parseOneNumber('20 730 kg')).toBe(20730);
  });
  it('non-breaking space U+00A0 separator', () => {
    expect(parseOneNumber('20\u00A0730')).toBe(20730);
  });
  it('narrow no-break space U+202F separator', () => {
    expect(parseOneNumber('20\u202F730')).toBe(20730);
  });
  it('multi-group spaces', () => {
    expect(parseOneNumber('1 234 567')).toBe(1234567);
  });
  it('space groups with comma-decimal tail', () => {
    expect(parseOneNumber('1 234,56')).toBe(1234.56);
  });
});

describe('parseOneNumber — unit-token tolerance', () => {
  it('plural kgs suffix', () => {
    expect(parseOneNumber('20730 kgs')).toBe(20730);
  });
  it('abbreviated "Kg." with trailing dot', () => {
    expect(parseOneNumber('20.730 Kg.')).toBe(20730);
  });
});

describe('parseOneNumber — malformed whitespace groups reject (no silent join)', () => {
  it('rejects single-digit pseudo-groups (likely a misread)', () => {
    expect(parseOneNumber('2 0 7 3 0')).toBeNull();
  });
  it('rejects a wrong-width middle group', () => {
    expect(parseOneNumber('1 23 456')).toBeNull();
  });
});
