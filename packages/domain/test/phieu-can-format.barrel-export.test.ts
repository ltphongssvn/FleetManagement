// packages/domain/test/phieu-can-format.barrel-export.test.ts
// The phieu-can FORMAT SSOT must be reachable from the @fleet/domain package
// ROOT, because every consumer (worker extraction policy, api manifest service,
// ops-web board) imports from the barrel, never from a deep src path. Without
// this the SSOT exists but is unusable across the boundary, which is exactly how
// a parallel re-declaration gets introduced downstream.
import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

describe('@fleet/domain barrel: phieu-can format SSOT', () => {
  it('re-exports the canonical format vocabulary', () => {
    expect(domain.PHIEU_CAN_FORMATS).toEqual(['truck_and_goods', 'truck_only', 'goods_only']);
  });

  it('re-exports the format schema', () => {
    expect(domain.PhieuCanFormatSchema.parse('truck_only')).toBe('truck_only');
  });

  it('re-exports the goods-derivation refusal vocabulary', () => {
    expect(domain.GOODS_DERIVATION_REFUSALS)
      .toEqual(['incomplete_format', 'inconsistent_weights', 'no_goods_weight']);
  });

  it('re-exports the derivation rule', () => {
    expect(domain.deriveGoodsKg({ format: 'truck_and_goods', grossKg: 30000, tareKg: 10000, goodsKg: null }))
      .toEqual({ ok: true, kg: 20000 });
  });
});
