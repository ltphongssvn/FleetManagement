// apps/ops-web/test/create-order-form-multi-destination.test.tsx
// RED: CreateOrderForm renders 1 destination row by default, an Add-destination
// control to grow to 4, a Remove control, and caps at MAX_DESTINATIONS rows.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn(), MAX_DESTINATIONS: 4 }));
afterEach(() => { cleanup(); });
describe('CreateOrderForm multi-destination', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];
  function countDeliveryDateInputs(): number {
    return document.querySelectorAll('input[name^=deliveryAt_]').length;
  }
  it('renders exactly one destination row initially', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='en' />);
    expect(countDeliveryDateInputs()).toBe(1);
    expect(document.querySelector('input[name=deliveryAt_1]')).not.toBeNull();
  });
  it('adds destination rows up to the max of 4 then hides the add control', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='en' />);
    const addBtn = screen.getByRole('button', { name: /add destination/i });
    fireEvent.click(addBtn);
    expect(countDeliveryDateInputs()).toBe(2);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(countDeliveryDateInputs()).toBe(4);
    expect(screen.queryByRole('button', { name: /add destination/i })).toBeNull();
  });
  it('removes a destination row when its remove control is clicked', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale='en' />);
    fireEvent.click(screen.getByRole('button', { name: /add destination/i }));
    expect(countDeliveryDateInputs()).toBe(2);
    const removeBtns = screen.getAllByRole('button', { name: /remove destination/i });
    const lastRemove = removeBtns[removeBtns.length - 1];
    if (lastRemove === undefined) throw new Error('no remove button rendered');
    fireEvent.click(lastRemove);
    expect(countDeliveryDateInputs()).toBe(1);
  });
});
