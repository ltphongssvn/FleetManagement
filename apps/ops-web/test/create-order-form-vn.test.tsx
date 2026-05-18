// apps/ops-web/test/create-order-form-vn.test.tsx
// RED: CreateOrderForm renders all VN fields with bilingual labels.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn(), MAX_DESTINATIONS: 4 }));
describe('CreateOrderForm VN/EN', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];
  it('renders VN labels when locale=vi', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="vi" />);
    expect(screen.getByText(/Lệnh điều xe/i)).toBeDefined();
    expect(screen.getByLabelText(/Khách hàng/i)).toBeDefined();
    expect(screen.getByLabelText(/Tên hàng/i)).toBeDefined();
    expect(screen.getByLabelText(/Số xe/i)).toBeDefined();
    expect(screen.getByLabelText(/^Tài xế$/i)).toBeDefined();
    expect(screen.getByLabelText(/Kho nhận hàng/i)).toBeDefined();
    expect(screen.getByLabelText(/Kho dự phòng/i)).toBeDefined();
    expect(screen.getByLabelText(/Kho giao hàng/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Tạo lệnh/i })).toBeDefined();
  });
  it('renders EN labels when locale=en', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(screen.getByText(/Transport Order/i)).toBeDefined();
    expect(screen.getByLabelText(/Customer/i)).toBeDefined();
    expect(screen.getByLabelText(/Cargo/i)).toBeDefined();
    expect(screen.getByLabelText(/Vehicle plate/i)).toBeDefined();
    expect(screen.getByLabelText(/Pickup warehouse/i)).toBeDefined();
    expect(screen.getByLabelText(/Backup warehouse/i)).toBeDefined();
    expect(screen.getByLabelText(/Delivery warehouse/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Create order/i })).toBeDefined();
  });
});
