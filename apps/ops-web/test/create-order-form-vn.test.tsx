// apps/ops-web/test/create-order-form-vn.test.tsx
// Bilingual VN/EN dispatch order form tests.
// T5 update: the 'Đặt lại'/'Reset' button is a redundant footgun that
// silently nukes mid-creation work. Tests assert its absence in both
// locales while preserving the rest of the form contract.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));
describe('CreateOrderForm VN/EN', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];
  it('renders VN labels when locale=vi', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    expect(screen.getByText(/Lệnh điều xe/i)).toBeDefined();
    expect(screen.getByLabelText(/Khách hàng/i)).toBeDefined();
    expect(screen.getByLabelText(/Tên hàng/i)).toBeDefined();
    expect(screen.getByLabelText(/Số xe/i)).toBeDefined();
    expect(screen.getByLabelText(/^Tài xế$/i)).toBeDefined();
    expect(screen.getByLabelText(/Điểm nhận hàng 1/i)).toBeDefined();
    expect(screen.getByLabelText(/Kho giao hàng/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Tạo lệnh/i })).toBeDefined();
  });
  it('renders EN labels when locale=en', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='en' />);
    expect(screen.getByText(/Transport Order/i)).toBeDefined();
    expect(screen.getByLabelText(/Customer/i)).toBeDefined();
    expect(screen.getByLabelText(/Cargo/i)).toBeDefined();
    expect(screen.getByLabelText(/Vehicle plate/i)).toBeDefined();
    expect(screen.getByLabelText(/Pickup 1/i)).toBeDefined();
    expect(screen.getByLabelText(/Delivery warehouse/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Create order/i })).toBeDefined();
  });
  it('does NOT render the redundant Đặt lại reset button (T5, vi)', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='vi' />);
    expect(screen.queryByRole('button', { name: /^Đặt lại$/ })).toBeNull();
  });
  it('does NOT render the redundant Reset button (T5, en)', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='en' />);
    expect(screen.queryByRole('button', { name: /^Reset$/ })).toBeNull();
  });
});
