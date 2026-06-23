// packages/sync-protocol/test/weight-diff-compute.test.ts
// Mutation-killing unit tests for the SSOT pickup-vs-delivery net-weight
// difference. computeWeightDiffKg + its schema-first WeightDiffStop input live
// in @fleet/sync-protocol so the dispatch board AND the Excel export share ONE
// computation and can never diverge. Semantics (Feature 3): sum(pickup weights)
// minus delivery weight; null UNLESS every contributing weight is known.
import { describe, it, expect } from 'vitest';
import {
  WeightDiffStopSchema,
  computeWeightDiffKg,
  type WeightDiffStop,
} from '../src/index.js';

const pickup = (kg: number | null): WeightDiffStop => ({ stopType: 'pickup', extractedNetWeightKg: kg });
const delivery = (kg: number | null): WeightDiffStop => ({ stopType: 'delivery', extractedNetWeightKg: kg });

describe('WeightDiffStopSchema', () => {
  it('accepts a pickup stop with a numeric weight', () => {
    expect(WeightDiffStopSchema.parse({ stopType: 'pickup', extractedNetWeightKg: 100 })).toEqual({ stopType: 'pickup', extractedNetWeightKg: 100 });
  });
  it('accepts a null weight (true blank)', () => {
    expect(WeightDiffStopSchema.parse({ stopType: 'delivery', extractedNetWeightKg: null }).extractedNetWeightKg).toBeNull();
  });
  it('rejects an unknown stopType (kills enum widening)', () => {
    expect(() => WeightDiffStopSchema.parse({ stopType: 'sideways', extractedNetWeightKg: 1 })).toThrow();
  });
});

describe('computeWeightDiffKg', () => {
  it('returns sum(pickups) - delivery when ALL weights are known', () => {
    // 7920 + 35080 + 48780 - 99920 === -8140-style reconciliation; use the
    // dispatch integration fixture: pickups 1000+1860, delivery 10000 => -7140.
    expect(computeWeightDiffKg([pickup(1000), pickup(1860), delivery(10000)])).toBe(-7140);
  });
  it('returns null when a pickup weight is missing', () => {
    expect(computeWeightDiffKg([pickup(1000), pickup(null), delivery(10000)])).toBeNull();
  });
  it('returns null when the delivery weight is missing', () => {
    expect(computeWeightDiffKg([pickup(1000), delivery(null)])).toBeNull();
  });
  it('returns null when there is no pickup', () => {
    expect(computeWeightDiffKg([delivery(10000)])).toBeNull();
  });
  it('returns null when there is no delivery', () => {
    expect(computeWeightDiffKg([pickup(1000), pickup(2000)])).toBeNull();
  });
});
