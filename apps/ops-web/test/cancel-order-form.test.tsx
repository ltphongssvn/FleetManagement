// apps/ops-web/test/cancel-order-form.test.tsx
// L1 RED for T5: CancelOrderForm.
// Asserts the test-id contract the Playwright L0 acceptance spec depends on.
// Modal pattern: an 'open' button reveals the form; the form contains a
// reason select, a note textarea, and a submit button.
//
// Visibility rule (defense in depth — the API is the authority):
//   - state is 'cancelled' or 'completed' -> open button NOT rendered
//   - any other state -> open button rendered
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CancelOrderForm } from '@/features/dispatch/CancelOrderForm';
afterEach(() => { cleanup(); });
// Stub the server action so the form can be rendered in jsdom without
// pulling in the next/headers + next/cache runtime modules.
vi.mock('@/features/dispatch/cancel-order.action', () => ({
  cancelOrder: vi.fn(() => Promise.resolve({ status: 'cancelled', transportOrderId: 'x', idempotent: false })),
}));
describe('CancelOrderForm', () => {
  it('renders the open button when the order state is draft', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('renders the open button when the order state is assigned', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='assigned' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('renders the open button when the order state is in_transit', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='in_transit' />);
    expect(screen.getByTestId('order-cancel-open')).toBeTruthy();
  });
  it('does NOT render the open button when the order state is already cancelled', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='cancelled' />);
    expect(screen.queryByTestId('order-cancel-open')).toBeNull();
  });
  it('does NOT render the open button when the order state is completed', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='completed' />);
    expect(screen.queryByTestId('order-cancel-open')).toBeNull();
  });
  it('reveals the reason select, note textarea, and submit button when the open button is clicked', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    expect(screen.queryByTestId('order-cancel-reason')).toBeNull();
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    expect(screen.getByTestId('order-cancel-reason')).toBeTruthy();
    expect(screen.getByTestId('order-cancel-note')).toBeTruthy();
    expect(screen.getByTestId('order-cancel-submit')).toBeTruthy();
  });
  it('includes the transportOrderId as a hidden input in the form', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    render(<CancelOrderForm transportOrderId={id} state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    const hidden = document.querySelector('input[name=transportOrderId]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe(id);
  });
  it('reason select offers all six allow-listed reasons', () => {
    render(<CancelOrderForm transportOrderId='11111111-1111-1111-1111-111111111111' state='draft' />);
    fireEvent.click(screen.getByTestId('order-cancel-open'));
    const select = screen.getByTestId('order-cancel-reason');
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value).filter((v) => v !== '');
    expect(values.sort()).toEqual([
      'customer_request',
      'driver_unavailable',
      'duplicate',
      'other',
      'vehicle_breakdown',
      'weather',
    ].sort());
  });
});
