// apps/ops-web/test/create-order-form-date-only.test.tsx
// outside-in strict TDD RED: the three date fields in the Lệnh điều xe - Tải
// thùng form (Ngày điều xe, Ngày nhận hàng, Ngày giao hàng) must be date-only
// HTML5 inputs (type='date'), not datetime-local. Dispatchers plan in whole
// days; the time portion is noise inherited from the spreadsheet workflow and
// is already stripped from the dispatch board (see dispatch-view-date-only.
// test.tsx). The action still ships ISO datetime to the api by promoting the
// date to UTC midnight, so the api contract is unchanged.
//
// Lint: assertions use getAttribute('type') instead of casting the result of
// getByLabelText to HTMLInputElement (the cast is redundant per
// typescript-eslint no-unnecessary-type-assertion in 2026; reading the
// rendered HTML attribute is also a stronger contract test).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/features/dispatch/create-order.action', () => ({ createOrder: vi.fn() }));

afterEach(cleanup);

describe('CreateOrderForm date-only fields (VN form)', () => {
  const drivers = [{ id: '00000000-0000-0000-0000-000000000001', label: 'driver1' }];

  it('Ngày điều xe renders as type=date (no time)', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="vi" />);
    const input = screen.getByLabelText(/Ngày điều xe/i);
    expect(input.getAttribute('type')).toBe('date');
  });

  it('Ngày nhận hàng renders as type=date (no time)', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="vi" />);
    const input = screen.getByLabelText(/Ngày nhận hàng/i);
    expect(input.getAttribute('type')).toBe('date');
  });

  it('Ngày giao hàng renders as type=date (no time)', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    render(<CreateOrderForm drivers={drivers} locale="vi" />);
    const input = screen.getByLabelText(/Ngày giao hàng/i);
    expect(input.getAttribute('type')).toBe('date');
  });

  it('none of the date fields uses datetime-local', async () => {
    const { CreateOrderForm } = await import('@/features/dispatch/CreateOrderForm');
    const { container } = render(<CreateOrderForm drivers={drivers} locale="vi" />);
    const dtLocal = container.querySelectorAll('input[type=datetime-local]');
    expect(dtLocal.length).toBe(0);
  });
});
