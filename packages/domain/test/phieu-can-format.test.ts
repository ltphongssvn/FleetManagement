// packages/domain/test/phieu-can-format.test.ts
// RED-first contract test for the phieu-can (Vietnamese weighing ticket) FORMAT
// SSOT introduced by T33. Mirrors the canonical enum test template
// (packages/domain/test/manifest-rejection-reason.test.ts): canonical-values /
// accepts-each / rejects-unknown+empty / type-narrows, PLUS the goods-kg
// derivation rule table.
//
// Business rule (2026): the recognizer accepts ONLY the three standard phieu-can
// formats, and must resolve the GOODS weight as the single kg the Lenh dieu xe
// board displays:
//   truck_and_goods -> ticket prints gross (xe + hang) AND tare (xe);
//                      goods = gross - tare.
//   truck_only      -> ticket prints the truck weight only; no goods weight is
//                      derivable, so a dispatcher must enter it by hand.
//   goods_only      -> ticket prints the goods weight directly.
// Anything outside this set (several tickets in one photo, or a layout that is
// not one of the three) is NOT a format: it resolves to a terminal
// cannot-recognize outcome upstream and never reaches this derivation.
import { describe, expect, it } from 'vitest';
import {
  PHIEU_CAN_FORMATS,
  PhieuCanFormatSchema,
  deriveGoodsKg,
  type PhieuCanFormat,
} from '../src/manifest/phieu-can-format.js';

describe('PHIEU_CAN_FORMATS', () => {
  it('is the canonical three-value standard-format vocabulary, in ticket order', () => {
    expect(PHIEU_CAN_FORMATS).toEqual(['truck_and_goods', 'truck_only', 'goods_only']);
  });

  it('accepts each canonical value', () => {
    for (const v of PHIEU_CAN_FORMATS) {
      expect(PhieuCanFormatSchema.parse(v)).toBe(v);
    }
  });

  it('rejects an unknown value', () => {
    expect(PhieuCanFormatSchema.safeParse('gross_only').success).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(PhieuCanFormatSchema.safeParse('').success).toBe(false);
  });

  it('narrows to the PhieuCanFormat type', () => {
    const parsed: PhieuCanFormat = PhieuCanFormatSchema.parse('goods_only');
    expect(parsed).toBe('goods_only');
  });
});

describe('deriveGoodsKg', () => {
  it('derives goods as gross minus tare for truck_and_goods', () => {
    expect(deriveGoodsKg({ format: 'truck_and_goods', grossKg: 28450, tareKg: 8720, goodsKg: null }))
      .toEqual({ ok: true, kg: 19730 });
  });

  it('refuses truck_and_goods when tare exceeds gross', () => {
    expect(deriveGoodsKg({ format: 'truck_and_goods', grossKg: 8000, tareKg: 9000, goodsKg: null }))
      .toEqual({ ok: false, reason: 'inconsistent_weights' });
  });

  it('refuses truck_and_goods when either component is missing', () => {
    expect(deriveGoodsKg({ format: 'truck_and_goods', grossKg: 28450, tareKg: null, goodsKg: null }))
      .toEqual({ ok: false, reason: 'incomplete_format' });
  });

  it('yields no goods weight for truck_only so a dispatcher must enter it', () => {
    expect(deriveGoodsKg({ format: 'truck_only', grossKg: null, tareKg: 8720, goodsKg: null }))
      .toEqual({ ok: false, reason: 'no_goods_weight' });
  });

  it('reads goods directly for goods_only', () => {
    expect(deriveGoodsKg({ format: 'goods_only', grossKg: null, tareKg: null, goodsKg: 19730 }))
      .toEqual({ ok: true, kg: 19730 });
  });

  it('refuses goods_only when the goods weight is absent', () => {
    expect(deriveGoodsKg({ format: 'goods_only', grossKg: null, tareKg: null, goodsKg: null }))
      .toEqual({ ok: false, reason: 'incomplete_format' });
  });
});
