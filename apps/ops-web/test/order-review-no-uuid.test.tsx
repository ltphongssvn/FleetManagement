// apps/ops-web/test/order-review-no-uuid.test.tsx
// outside-in strict TDD RED (L0): the order-detail review must not expose the
// internal transportOrderId UUID. Business invariant: user-facing UI shows the
// human reference (Mã tham chiếu, e.g. XTT.05-001), never the raw UUID. The
// dispatcher has no use for the internal id; surfacing it is noise + leakage.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';
afterEach(() => { cleanup(); });
const ORDER_UUID = '6cf70728-1344-461a-b8ec-7c408edac32e';
const row: ListAssignedRow = {
  transportOrderId: ORDER_UUID,
  externalRef: 'XTT.05-001',
  orderRef: 'XTT.05-001',
  roadRunId: 'rr-1',
  state: 'planned',
  plannedStartAt: '2026-05-01T07:00:00.000Z',
  createdAt: '2026-05-01T07:00:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '62H-05800',
  customerName: 'ĐA NẴNG',
  cargoName: 'TRẤU',
  driverName: 'NGUYỄN THÀNH ĐỨC',
  pickupName: 'A',
  deliveryName: 'B',
  stops: [],
};
describe('OrderReview hides the internal UUID', () => {
  it('does NOT render the transportOrderId UUID anywhere', () => {
    render(<OrderReview order={row} />);
    expect(screen.queryByText(ORDER_UUID)).toBeNull();
    expect(screen.queryByTestId('order-review-id')).toBeNull();
  });
  it('still renders the human reference (Mã tham chiếu)', () => {
    render(<OrderReview order={row} />);
    expect(screen.getByTestId('order-review-external-ref').textContent).toContain('XTT.05-001');
  });
});
