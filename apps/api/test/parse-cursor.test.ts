// apps/api/test/parse-cursor.test.ts
// Property-based tests for parseCursor — pure cursor coercion logic.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCursor } from '../src/sync/parse-cursor.js';

describe('@fleet/api - parseCursor', () => {
  it.each([
    ['empty string', '', 0n],
    ['zero string', '0', 0n],
    ['positive integer', '42', 42n],
    ['large bigint', '9223372036854775807', 9223372036854775807n],
    ['negative coerced to 0', '-1', 0n],
    ['invalid non-numeric', 'abc', 0n],
    ['decimal', '3.14', 0n],
    ['hex literal accepted by BigInt', '0xff', 255n],
    ['leading whitespace accepted by BigInt', ' 5', 5n],
    ['empty array string', '[]', 0n],
  ])('classifies %s -> %s', (_label, input, expected) => {
    expect(parseCursor(input)).toBe(expected);
  });

  it('property: any non-negative integer string round-trips to its bigint', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), (n) => {
        expect(parseCursor(n.toString())).toBe(n);
      }),
    );
  });

  it('property: any negative bigint string coerces to 0n', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: -1n }), (n) => {
        expect(parseCursor(n.toString())).toBe(0n);
      }),
    );
  });

  it('property: arbitrary garbage strings never throw and return non-negative bigint', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseCursor(s);
        expect(typeof r).toBe('bigint');
        expect(r >= 0n).toBe(true);
      }),
    );
  });
});

describe('parseCursor numeric ordering', () => {
  it('treats cursors as bigint, not strings (no lex ordering bug)', () => {
    expect(parseCursor('9') < parseCursor('10')).toBe(true);
    expect(parseCursor('99') < parseCursor('100')).toBe(true);
    expect(parseCursor('999') < parseCursor('1000')).toBe(true);
  });
});
