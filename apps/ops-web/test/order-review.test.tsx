// apps/ops-web/test/order-review.test.tsx
// RED: OrderReview renders the order's key fields (id, externalRef, plate,
// customer, planned start, stops). Asserts on data-testid hooks the
// Playwright acceptance spec depends on.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';
afterEach(() => { cleanup(); });
const row: ListAssignedRow = {
  transportOrderId: '11111111-1111-1111-1111-111111111111',
  externalRef: 'TO-9001',
  orderRef: 'TO-9001',
  roadRunId: 'rr-1',
  state: 'planned',
  plannedStartAt: '2026-05-01T07:00:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '51A-12345',
  customerName: 'Acme Logistics',
  cargoName: 'GẠO',
  driverName: 'Nguyễn Văn A',
  pickupName: 'North Pickup Dock',
  deliveryName: 'South Delivery Bay',
  stops: [
    { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z' },
    { sequence: 2, stopType: 'dropoff', plannedAt: null },
  ],
};
describe('OrderReview', () => {
  it('renders the order id, external ref, plate and customer', () => {
    render(<OrderReview order={row} />);
    expect(screen.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeTruthy();
    expect(screen.getByTestId('order-review-id').textContent).toContain(row.transportOrderId);
    expect(screen.getByTestId('order-review-external-ref').textContent).toContain('TO-9001');
    expect(screen.getByTestId('order-review-plate').textContent).toContain('51A-12345');
    expect(screen.getByTestId('order-review-customer').textContent).toContain('Acme Logistics');
    expect(screen.getByTestId('order-review-cargo').textContent).toContain('GẠO');
    expect(screen.getByTestId('order-review-driver').textContent).toContain('Nguyễn Văn A');
  });
  it('renders the stops list with one row per stop', () => {
    render(<OrderReview order={row} />);
    const stops = screen.getByTestId('order-review-stops');
    expect(stops).toBeTruthy();
    expect(stops.querySelectorAll('[data-testid=order-review-stop]').length).toBe(2);
  });
  it('renders dashes when optional fields are null', () => {
    const minimal: ListAssignedRow = { ...row, externalRef: null, orderRef: null, plate: null, customerName: null, cargoName: null, driverName: null, pickupName: null, deliveryName: null };
    render(<OrderReview order={minimal} />);
    expect(screen.getByTestId('order-review-external-ref').textContent).toContain('—');
    expect(screen.getByTestId('order-review-plate').textContent).toContain('—');
    expect(screen.getByTestId('order-review-customer').textContent).toContain('—');
    expect(screen.getByTestId('order-review-cargo').textContent).toContain('—');
    expect(screen.getByTestId('order-review-driver').textContent).toContain('—');
  });
  it('renders a dash for plannedStartAt when null (formatDateTime null-branch)', () => {
    const noStart: ListAssignedRow = { ...row, plannedStartAt: null };
    render(<OrderReview order={noStart} />);
    expect(screen.getByTestId('order-review-planned-start').textContent).toBe('—');
  });
  it('renders a dash for plannedStartAt when the ISO is invalid (formatDateTime NaN-branch)', () => {
    const badStart: ListAssignedRow = { ...row, plannedStartAt: 'not-a-real-date' };
    render(<OrderReview order={badStart} />);
    expect(screen.getByTestId('order-review-planned-start').textContent).toBe('—');
  });
});
