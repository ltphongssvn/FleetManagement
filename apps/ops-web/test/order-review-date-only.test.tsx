// apps/ops-web/test/order-review-date-only.test.tsx
// outside-in strict TDD RED (L0): user-facing dates display date-only, format
// 'MMM D, YYYY' (e.g. May 30, 2026) for consistency across the app. Underlying
// datetime values are unchanged; only the rendered string drops the time.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';
afterEach(() => { cleanup(); });
const row: ListAssignedRow = {
  transportOrderId: '11111111-1111-1111-1111-111111111111',
  externalRef: 'XTT.05-001',
  orderRef: 'XTT.05-001',
  roadRunId: 'rr-1',
  state: 'planned',
  plannedStartAt: '2026-05-31T11:20:00.000Z',
  createdAt: '2026-05-30T07:12:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '62H-05800',
  customerName: 'ĐA NẴNG',
  cargoName: 'TRẤU',
  driverName: 'NGUYỄN THÀNH ĐỨC',
  pickupName: 'A',
  deliveryName: 'B',
  stops: [
    { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-31T11:20:00.000Z', warehouseName: 'Kho A', arrivedAt: null, departedAt: null, hasManifest: false },
  ],
};
describe('OrderReview date-only display', () => {
  it('renders Ngày tạo lệnh as date only (no time component)', () => {
    render(<OrderReview order={row} />);
    const txt = screen.getByTestId('order-review-created-at').textContent;
    expect(txt).toContain('May 30, 2026');
    expect(txt).not.toMatch(/\\d{1,2}:\\d{2}/);
  });
  it('renders stop Ngày dự kiến as date only (no time component)', () => {
    render(<OrderReview order={row} />);
    const stop = screen.getAllByTestId('order-review-stop')[0];
    if (stop === undefined) throw new Error('expected a stop row');
    const txt = stop.textContent;
    expect(txt).not.toMatch(/\\d{1,2}:\\d{2}/);
  });
});
