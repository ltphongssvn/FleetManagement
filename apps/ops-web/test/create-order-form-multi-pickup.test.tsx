// apps/ops-web/test/create-order-form-multi-pickup.test.tsx
// CreateOrderForm: section 4 starts at 4 pickup-warehouse slots, section 5
// starts at 1 delivery-warehouse slot. Each side has an uncapped 'add more'
// button. One shared pickup date, one shared delivery date. Unassigned slots
// show a 'None' placeholder.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));
afterEach(() => {
  cleanup();
});
describe('CreateOrderForm dynamic pickup + delivery warehouses', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];
  const countPickup = (): number =>
    document.querySelectorAll('input[name^=pickupWarehouse_]').length;
  const countDelivery = (): number =>
    document.querySelectorAll('input[name^=deliveryWarehouse_]').length;
  it('starts with 4 pickup slots and 1 delivery slot', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(countPickup()).toBe(4);
    expect(countDelivery()).toBe(1);
  });
  it('adds a 5th+ pickup warehouse with no hard cap', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    const addBtn = screen.getByRole('button', { name: /add more loading warehouse/i });
    fireEvent.click(addBtn);
    expect(countPickup()).toBe(5);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(countPickup()).toBe(7);
  });
  it('adds a 2nd+ delivery warehouse with no hard cap', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    const addBtn = screen.getByRole('button', { name: /add more unloading warehouse/i });
    fireEvent.click(addBtn);
    expect(countDelivery()).toBe(2);
    fireEvent.click(addBtn);
    expect(countDelivery()).toBe(3);
  });
  it('has one shared pickup date and one shared delivery date', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(document.querySelector('input[name=pickupAt]')).not.toBeNull();
    expect(document.querySelector('input[name=deliveryAt]')).not.toBeNull();
    expect(document.querySelectorAll('input[name^=pickupAt_]').length).toBe(0);
    expect(document.querySelectorAll('input[name^=deliveryAt_]').length).toBe(0);
  });
  it('shows a None placeholder on warehouse slots', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="en" />);
    expect(screen.getAllByPlaceholderText(/none/i).length).toBeGreaterThanOrEqual(5);
  });
});
