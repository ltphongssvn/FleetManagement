// apps/ops-web/test/i18n.test.ts
// RED: i18n module returns translated strings by locale + fallback.
import { describe, it, expect } from 'vitest';
describe('i18n', () => {
  it('returns Vietnamese strings for vi locale', async () => {
    const { t } = await import('@/lib/i18n');
    expect(t('vi', 'orderForm.title')).toBe('Lệnh điều xe - Tải thùng');
    expect(t('vi', 'orderForm.customer')).toBe('Khách hàng');
    expect(t('vi', 'orderForm.cargo')).toBe('Tên hàng');
    expect(t('vi', 'orderForm.vehiclePlate')).toBe('Số xe');
    expect(t('vi', 'orderForm.driverName')).toBe('Tài xế');
    expect(t('vi', 'orderForm.pickupWarehouse')).toBe('Kho nhận hàng');
    expect(t('vi', 'orderForm.deliveryWarehouse')).toBe('Kho giao hàng');
    expect(t('vi', 'orderForm.submit')).toBe('Tạo lệnh');
  });
  it('returns English strings for en locale', async () => {
    const { t } = await import('@/lib/i18n');
    expect(t('en', 'orderForm.title')).toBe('Transport Order - Box Truck');
    expect(t('en', 'orderForm.customer')).toBe('Customer');
    expect(t('en', 'orderForm.cargo')).toBe('Cargo');
    expect(t('en', 'orderForm.vehiclePlate')).toBe('Vehicle plate');
    expect(t('en', 'orderForm.driverName')).toBe('Driver');
    expect(t('en', 'orderForm.pickupWarehouse')).toBe('Pickup warehouse');
    expect(t('en', 'orderForm.deliveryWarehouse')).toBe('Delivery warehouse');
    expect(t('en', 'orderForm.submit')).toBe('Create order');
  });
  it('falls back to key when missing', async () => {
    const { t } = await import('@/lib/i18n');
    expect(t('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
  it('parses locale cookie value', async () => {
    const { parseLocale } = await import('@/lib/i18n');
    expect(parseLocale('vi')).toBe('vi');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('fr')).toBe('vi');
    expect(parseLocale(undefined)).toBe('vi');
  });
});
