// packages/sync-protocol/test/stop-type-vocabulary.test.ts
// RED-first contract for the STOP TYPE vocabulary and its role classification.
//
// ROOT CAUSE THIS CLOSES. STOP_TYPES declared ['pickup','delivery'] while the
// production database holds FOUR values -- pickup, delivery, dropoff, return
// (verified by SELECT DISTINCT stop_type FROM stop). The contract has never
// matched reality, and three consequences followed:
//
//   1. computeWeightDiffKg matches stopType === 'delivery' by direct equality
//      and its comment asserts that is exhaustive. For every order whose
//      delivery leg is typed 'dropoff' it returns null -- indistinguishable
//      from the legitimate "weight not extracted yet" null. The Chenh lech
//      column has been silently blank for those orders.
//   2. Three call sites independently alias t === 'delivery' || t === 'dropoff'.
//      Aliasing per call site is the duplication the SSOT rule forbids, and a
//      fourth consumer (accounting THANH TIEN) was about to add a fifth copy.
//   3. Two read paths CAST rather than parse -- sr.stopType is asserted as
//      DispatchStopView stopType -- forcing a DB string into a union that
//      excludes it. The cast silences the compiler exactly where a parse was
//      required, so the mismatch surfaces as wrong data instead of a
//      validation error.
//
// WHY WIDEN RATHER THAN MIGRATE. 2026 expand-contract guidance is explicit:
// widen in place, never narrow directly. Rewriting live 'dropoff'/'return' rows
// to two values would destroy a real distinction -- a RETURNED load is not a
// DELIVERED load -- and returns would silently become billable. The vocabulary
// therefore documents reality, and MEANING is derived on top of it.
//
// TWO CONCEPTS, DELIBERATELY SEPARATE. STOP_TYPES is the persisted vocabulary.
// STOP_ROLES is the semantic classification consumers actually branch on. One
// definition of each; a total, exhaustive classifier between them. Adding a
// fifth persisted value makes the switch non-exhaustive and fails the build,
// so a new stop type can never silently fall through to a wrong role -- the
// same compile-time guarantee deriveGoodsKg documents for phieu can layouts.
import { describe, it, expect } from 'vitest';
import {
  STOP_TYPES,
  StopTypeSchema,
  STOP_ROLES,
  StopRoleSchema,
  classifyStopRole,
  type StopType,
  type StopRole,
} from '../src/dispatch-stop-view-contract.js';

describe('STOP_TYPES is the persisted vocabulary, matching production', () => {
  it('is frozen -- a consumer cannot extend the vocabulary at runtime', () => {
    expect(Object.isFrozen(STOP_TYPES)).toBe(true);
  });

  it('contains every value observed in the production stop table', () => {
    expect([...STOP_TYPES].sort()).toEqual(['delivery', 'dropoff', 'pickup', 'return']);
  });

  it('has no duplicates', () => {
    expect(new Set(STOP_TYPES).size).toBe(STOP_TYPES.length);
  });
});

describe('StopTypeSchema parses at the persistence boundary', () => {
  it('accepts every declared value', () => {
    for (const t of STOP_TYPES) {
      expect(StopTypeSchema.parse(t)).toBe(t);
    }
  });

  it('REJECTS a value outside the vocabulary -- the DTO gap this closes', () => {
    expect(StopTypeSchema.safeParse('delivrey').success).toBe(false);
    expect(StopTypeSchema.safeParse('').success).toBe(false);
  });

  it('rejects case variants -- stop_type is stored lowercase', () => {
    expect(StopTypeSchema.safeParse('Delivery').success).toBe(false);
    expect(StopTypeSchema.safeParse('PICKUP').success).toBe(false);
  });

  it('rejects non-strings, which a raw DB row can be', () => {
    expect(StopTypeSchema.safeParse(null).success).toBe(false);
    expect(StopTypeSchema.safeParse(42).success).toBe(false);
  });
});

describe('STOP_ROLES is the semantic classification', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(STOP_ROLES)).toBe(true);
  });

  it('keeps return SEPARATE from delivery -- a returned load is not delivered', () => {
    expect([...STOP_ROLES].sort()).toEqual(['delivery', 'pickup', 'return']);
  });

  it('parses each role', () => {
    for (const r of STOP_ROLES) {
      expect(StopRoleSchema.parse(r)).toBe(r);
    }
  });
});

describe('classifyStopRole is total over the vocabulary', () => {
  it('classifies pickup as pickup', () => {
    expect(classifyStopRole('pickup')).toBe('pickup');
  });

  it('classifies delivery as delivery', () => {
    expect(classifyStopRole('delivery')).toBe('delivery');
  });

  it('folds the dropoff ALIAS onto delivery -- the same leg, two spellings', () => {
    expect(classifyStopRole('dropoff')).toBe('delivery');
  });

  it('keeps return as its OWN role, never delivery', () => {
    expect(classifyStopRole('return')).toBe('return');
    expect(classifyStopRole('return')).not.toBe('delivery');
  });

  it('returns a declared role for every declared type -- totality', () => {
    for (const t of STOP_TYPES) {
      expect(STOP_ROLES).toContain(classifyStopRole(t));
    }
  });
});

describe('type surface', () => {
  it('StopType is inhabited by the persisted literals', () => {
    const t: StopType = 'dropoff';
    expect(STOP_TYPES).toContain(t);
  });

  it('StopRole is inhabited by the semantic literals', () => {
    const r: StopRole = 'return';
    expect(STOP_ROLES).toContain(r);
  });
});
