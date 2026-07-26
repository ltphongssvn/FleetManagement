// apps/ops-web/test/order-review-form-parity.test.tsx
// T8 L1 RED-first: OrderReview must mirror the 'Lệnh điều xe - Tải thùng'
// form. Single pickup/delivery fields and generic '#N · stopType' labels are
// replaced by the form's fixed slot labels; 'Bắt đầu dự kiến' (plannedStartAt)
// becomes 'Ngày tạo lệnh' (createdAt).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';
afterEach(() => { cleanup(); });
const row: ListAssignedRow = {
  transportOrderId: '11111111-1111-1111-1111-111111111111',
  externalRef: 'XTT.05-004',
  orderRef: 'XTT.05-004',
  roadRunId: 'rr-1',
  state: 'planned',
  plannedStartAt: '2026-05-30T14:17:00.000Z',
  createdAt: '2026-05-28T02:30:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '62H 05194',
  customerName: 'ĐẠI THÀNH',
  cargoName: 'GẠO',
  driverName: 'NGUYỄN THANH PHONG',
  pickupName: null,
  deliveryName: null,
  canCancel: true,
  cancelBlockedReason: null,
  stops: [
    { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'WH1', arrivedAt: null, departedAt: null },
    { sequence: 2, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'WH2', arrivedAt: null, departedAt: null },
    { sequence: 3, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'WH3', arrivedAt: null, departedAt: null },
    { sequence: 4, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'WH4', arrivedAt: null, departedAt: null },
    { sequence: 5, stopType: 'delivery', plannedAt: '2026-05-30T18:18:00.000Z', warehouseName: 'WH5', arrivedAt: null, departedAt: null },
  ],
};
describe('OrderReview - form parity (T8)', () => {
  it('shows Ngày tạo lệnh (createdAt), not Bắt đầu dự kiến', () => {
    render(<OrderReview order={row} />);
    expect(screen.queryByText('Bắt đầu dự kiến')).toBeNull();
    expect(screen.getByText('Ngày tạo lệnh')).toBeTruthy();
    expect(screen.getByTestId('order-review-created-at').textContent).not.toBe('—');
  });
  it('removes the single Điểm lấy hàng / Điểm giao hàng fields', () => {
    render(<OrderReview order={row} />);
    expect(screen.queryByText('Điểm lấy hàng')).toBeNull();
    expect(screen.queryByText('Điểm giao hàng')).toBeNull();
    expect(screen.queryByTestId('order-review-pickup')).toBeNull();
    expect(screen.queryByTestId('order-review-delivery')).toBeNull();
  });
  it('labels pickup stops Điểm nhận hàng 1..4', () => {
    render(<OrderReview order={row} />);
    expect(screen.getByText('Điểm nhận hàng 1')).toBeTruthy();
    expect(screen.getByText('Điểm nhận hàng 2')).toBeTruthy();
    expect(screen.getByText('Điểm nhận hàng 3')).toBeTruthy();
    expect(screen.getByText('Điểm nhận hàng 4')).toBeTruthy();
  });
  it('labels the delivery stop Kho giao hàng (no numeric suffix when there is exactly one delivery stop) and shows no raw stopType', () => {
    render(<OrderReview order={row} />);
    expect(screen.getByText('Kho giao hàng')).toBeTruthy();
    expect(screen.queryByText('Kho giao hàng 1')).toBeNull();
    const stops = screen.getByTestId('order-review-stops');
    expect(stops.textContent).not.toMatch(/pickup|delivery/i);
  });
});

// --- T9: per-stop warehouse name + completion status + dated column header.
// Each stop shows the warehouse name (not just the slot label) and a status
// derived from arrivedAt/departedAt: 'Đã hoàn thành <time>' when arrived,
// else 'Chưa tới'. The stops list carries a column header for the date. ---
import { describe as describeT9, it as itT9, expect as expectT9, afterEach as afterEachT9 } from 'vitest';
import { render as renderT9, screen as screenT9, cleanup as cleanupT9 } from '@testing-library/react';
import { OrderReview as OrderReviewT9 } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow as ListAssignedRowT9 } from '@/features/dispatch/types';
afterEachT9(() => { cleanupT9(); });
const t9row: ListAssignedRowT9 = {
  transportOrderId: '22222222-2222-2222-2222-222222222222',
  externalRef: 'XTT.05-001',
  orderRef: 'XTT.05-001',
  roadRunId: 'rr-9',
  state: 'in_progress',
  plannedStartAt: '2026-05-30T14:17:00.000Z',
  createdAt: '2026-05-28T02:30:00.000Z',
  startedAt: null,
  completedAt: null,
  plate: '62H 05194',
  customerName: 'ĐẠI THÀNH',
  cargoName: 'GẠO',
  driverName: 'NGUYỄN THANH PHONG',
  pickupName: null,
  deliveryName: null,
  canCancel: true,
  cancelBlockedReason: null,
  stops: [
    { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'Chơn Chính', arrivedAt: '2026-05-30T17:30:00.000Z', departedAt: '2026-05-30T17:45:00.000Z' },
    { sequence: 2, stopType: 'pickup', plannedAt: '2026-05-30T17:18:00.000Z', warehouseName: 'Cần Thơ', arrivedAt: null, departedAt: null },
    { sequence: 3, stopType: 'delivery', plannedAt: '2026-05-30T18:18:00.000Z', warehouseName: 'ĐA NĂNG', arrivedAt: null, departedAt: null },
  ],
};
describeT9('OrderReview - per-stop status + warehouse name (T9)', () => {
  itT9('shows each stop warehouse name', () => {
    renderT9(<OrderReviewT9 order={t9row} />);
    const stops = screenT9.getByTestId('order-review-stops');
    expectT9(stops.textContent).toContain('Chơn Chính');
    expectT9(stops.textContent).toContain('Cần Thơ');
    expectT9(stops.textContent).toContain('ĐA NĂNG');
  });
  itT9('marks an arrived stop done and a not-arrived stop Chưa tới', () => {
    renderT9(<OrderReviewT9 order={t9row} />);
    const items = screenT9.getAllByTestId('order-review-stop');
    const s0 = items[0]?.querySelector('[data-testid=order-review-stop-status]')?.textContent ?? '';
    const s1 = items[1]?.querySelector('[data-testid=order-review-stop-status]')?.textContent ?? '';
    expectT9(s0).toMatch(/Đã hoàn thành/);
    expectT9(s1).toBe('Chưa tới');
  });
  itT9('renders a date column header for the stops list', () => {
    renderT9(<OrderReviewT9 order={t9row} />);
    expectT9(screenT9.getByTestId('order-review-stops-date-header')).toBeTruthy();
  });
});
