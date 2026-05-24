// apps/api/test/parse-cursor.test.ts
// Mutation-killing tests for src/sync/parse-cursor.ts.
// The source has a single BigInt+clamp path (no redundant sentinel guard),
// so every surviving mutant maps to a real, observable behavior difference.
import { describe, it, expect } from 'vitest';
import { parseCursor, clampNonNegative } from '../src/sync/parse-cursor.js';

describe('@fleet/api - parseCursor', () => {
  it('empty string coerces to 0n via the BigInt throw -> catch path (kills catch BlockStatement + return ZERO)', () => {
    // BigInt('') throws; the catch must return 0n. A gutted catch block would return undefined.
    expect(parseCursor('')).toBe(0n);
  });

  it('"0" parses through BigInt to 0n (kills BigInt-call MethodExpression / try-block removal)', () => {
    expect(parseCursor('0')).toBe(0n);
  });

  it('a positive numeric string is parsed and returned verbatim (kills clampNonNegative wholesale-body mutant)', () => {
    expect(parseCursor('5')).toBe(5n);
    expect(parseCursor('42')).toBe(42n);
  });

  it('large positive bigint beyond Number.MAX_SAFE_INTEGER round-trips exactly (kills BigInt-path correctness)', () => {
    expect(parseCursor('9223372036854775807')).toBe(9223372036854775807n);
    expect(parseCursor('999999999999999999999')).toBe(999999999999999999999n);
  });

  it('negative bigint strings clamp to 0n (kills clampNonNegative ConditionalExpression false-mutant + return-n mutant)', () => {
    expect(parseCursor('-1')).toBe(0n);
    expect(parseCursor('-999999999999999999999')).toBe(0n);
  });

  it('non-numeric garbage never throws and coerces to 0n (kills catch removal + BigInt throw path)', () => {
    expect(parseCursor('abc')).toBe(0n);
    expect(parseCursor('12x')).toBe(0n);
    expect(parseCursor('1.5')).toBe(0n);
    expect(parseCursor('[]')).toBe(0n);
  });

  it('whitespace-wrapped numerics are accepted by BigInt (kills try-block / BigInt-arg mutants)', () => {
    expect(parseCursor(' 7 ')).toBe(7n);
    expect(parseCursor(' 0 ')).toBe(0n);
  });

  it('hex literal accepted by BigInt is parsed, not rejected (kills catch over-broad mutant)', () => {
    expect(parseCursor('0xff')).toBe(255n);
  });
});

describe('@fleet/api - clampNonNegative', () => {
  it('returns a positive bigint unchanged (kills ConditionalExpression -> true mutant + ZERO return)', () => {
    expect(clampNonNegative(1n)).toBe(1n);
    expect(clampNonNegative(123456789012345678901234567890n)).toBe(
      123456789012345678901234567890n,
    );
  });

  it('returns 0n unchanged at the boundary (kills ConditionalExpression -> true mutant)', () => {
    // true-mutant would return ZERO here too (0n), but the positive case above
    // already kills it; this pins the boundary value explicitly.
    expect(clampNonNegative(0n)).toBe(0n);
  });

  it('clamps any negative bigint to 0n (kills ConditionalExpression -> false mutant)', () => {
    // false-mutant would return n (a negative) instead of ZERO.
    expect(clampNonNegative(-1n)).toBe(0n);
    expect(clampNonNegative(-987654321098765432109876543210n)).toBe(0n);
  });
});
