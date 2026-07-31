// packages/i18n/test/messages.test.ts
// RED: the Vietnamese/English message SSOT for every surface.
//
// ROOT CAUSE THIS CLOSES. apps/ops-web/src/lib/i18n.ts was written as the
// dictionary but nothing enforced it, so it decayed to ONE consumer
// (CreateOrderForm.tsx). Everything else hardcodes:
//   NaturalLanguageCreateForm.tsx:149 inlines vi ? Dang tao... : Creating...
//     and vi ? Tao lenh : Create order -- byte-identical duplicates of the
//     orderForm.submitting and orderForm.submit entries, with a hand-rolled
//     locale branch standing in for t().
//   DispatchView.tsx:395,469 hardcode Tao lenh dieu xe, which is not in the
//     dictionary at all and has no English counterpart, so it cannot
//     localise.
//   SUPPORTED_LOCALES and DEFAULT_LOCALE have zero consumers repo-wide
//     (knip), which is how the vi/en vocabulary drifted into three
//     hand-written copies with nothing failing to compile.
//
// It also cannot serve the native apps: it lives under apps/ops-web/src, so
// dispatcher-app and driver-app cannot import it across the app boundary.
// The voice-dispatch review screen needs these exact labels, and hardcoding
// them there would make dispatcher-app the FOURTH copy of Tao lenh.
//
// packages/i18n is not a new invention: pnpm-workspace.yaml lists @i18n
// among the Frozen Stack packages, prescribed and never created. This is
// completing specified architecture, modelled on @fleet/design-tokens --
// the other SSOT consumed by both web and React Native.
//
// The dictionary values are IMMUTABLE PRODUCTION CONTRACTS. Vietnamese
// strings are what dispatchers read on a live pilot; a reworded label is a
// production change, not a refactor. They are asserted byte-identical to
// what ops-web ships today.
import { describe, it, expect } from 'vitest';
import {
  LOCALES,
  LocaleSchema,
  DEFAULT_LOCALE,
  parseLocale,
  t,
  VI,
  EN,
} from '../src/index.js';
describe('locale vocabulary (schema-first SSOT)', () => {
  it('defines the canonical values exactly once, frozen', () => {
    expect(LOCALES).toEqual(['vi', 'en']);
    expect(Object.isFrozen(LOCALES)).toBe(true);
  });
  it('derives the schema from the same array', () => {
    expect(LocaleSchema.parse('vi')).toBe('vi');
    expect(LocaleSchema.parse('en')).toBe('en');
  });
  it('rejects an unknown locale and the empty string', () => {
    expect(LocaleSchema.safeParse('fr').success).toBe(false);
    expect(LocaleSchema.safeParse('').success).toBe(false);
  });
  it('defaults to Vietnamese, the primary user base', () => {
    expect(DEFAULT_LOCALE).toBe('vi');
  });
});
describe('parseLocale (trust boundary: the fleet_locale cookie)', () => {
  it('accepts each supported locale', () => {
    expect(parseLocale('vi')).toBe('vi');
    expect(parseLocale('en')).toBe('en');
  });
  it('falls back to the default for unknown, undefined and null', () => {
    expect(parseLocale('fr')).toBe('vi');
    expect(parseLocale(undefined)).toBe('vi');
    expect(parseLocale(null)).toBe('vi');
  });
  it('validates via the schema rather than hand-rolled equality', () => {
    expect(parseLocale(' vi')).toBe('vi');
    expect(parseLocale('VI')).toBe('vi');
  });
});
describe('dictionary parity', () => {
  it('EN covers every VI key, with no extras', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(VI).sort());
  });
  it('has no empty values in either dictionary', () => {
    const empties = Object.entries({ ...VI, ...EN })
      .filter(([, v]) => v.trim().length === 0)
      .map(([k]) => k);
    expect(empties).toEqual([]);
  });
});
describe('t (immutable production contracts)', () => {
  it('returns the Vietnamese order-form labels byte-identically', () => {
    expect(t('vi', 'orderForm.title')).toBe('Lệnh điều xe - Tải thùng');
    expect(t('vi', 'orderForm.customer')).toBe('Khách hàng');
    expect(t('vi', 'orderForm.cargo')).toBe('Tên hàng');
    expect(t('vi', 'orderForm.vehiclePlate')).toBe('Số xe');
    expect(t('vi', 'orderForm.driverName')).toBe('Tài xế');
    expect(t('vi', 'orderForm.pickupWarehouse')).toBe('Kho nhận hàng');
    expect(t('vi', 'orderForm.deliveryWarehouse')).toBe('Kho giao hàng');
    expect(t('vi', 'orderForm.submit')).toBe('Tạo lệnh');
    expect(t('vi', 'orderForm.submitting')).toBe('Đang tạo…');
  });
  it('returns the English counterparts', () => {
    expect(t('en', 'orderForm.title')).toBe('Transport Order - Box Truck');
    expect(t('en', 'orderForm.submit')).toBe('Create order');
    expect(t('en', 'orderForm.submitting')).toBe('Creating…');
  });
  it('carries the board heading ops-web hardcodes today', () => {
    expect(t('vi', 'board.createOrder')).toBe('Tạo lệnh điều xe');
    expect(t('en', 'board.createOrder')).toBe('Create transport order');
  });
});
