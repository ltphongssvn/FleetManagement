// apps/ops-web/test/order-review-date-only.test.tsx
// outside-in strict TDD RED (t65 Vietnamese-date-format arc): every date on the
// Chi tiết đơn vận chuyển view renders in pure Vietnamese, dd/MM/yyyy.
//
// This spec previously asserted the en-US MMM D, YYYY form (May 30, 2026),
// which is the defect the screenshots show on Ngày tạo lệnh and on each stop's
// Ngày dự kiến. The date-only intent is preserved; the locale expectation moves
// to the product language and the stop column now gets a POSITIVE assertion
// rather than only a negative one, so a blank cell can no longer pass.
//
// It also repairs the same latent regex defect the board spec had: the original
// no-clock guard was /\\d{1,2}:\\d{2}/, matching a literal backslash and d, so it
// could never fire. The single-backslash form below actually tests it.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { isVnDateString } from '@fleet/sync-protocol';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';
afterEach(() => { cleanup(); });
function makeRow(overrides: Partial<ListAssignedRow> = {}): ListAssignedRow {
  return {
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
    canCancel: true,
    cancelBlockedReason: null,
    stops: [
      { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-31T11:20:00.000Z', warehouseName: 'Kho A', arrivedAt: null, departedAt: null },
    ],
    ...overrides,
  };
}
function createdAtText(): string {
  return screen.getByTestId('order-review-created-at').textContent ?? '';
}
function firstStopText(): string {
  const stop = screen.getAllByTestId('order-review-stop')[0];
  if (stop === undefined) throw new Error('expected a stop row');
  return stop.textContent ?? '';
}
describe('OrderReview renders pure Vietnamese dates', () => {
  it('renders Ngày tạo lệnh as dd/MM/yyyy', () => {
    render(<OrderReview order={makeRow()} />);
    expect(createdAtText()).toBe('30/05/2026');
  });
  it('never renders an English month abbreviation in Ngày tạo lệnh', () => {
    render(<OrderReview order={makeRow()} />);
    expect(createdAtText()).not.toContain('May');
  });
  it('Ngày tạo lệnh satisfies the shared Vietnamese date contract', () => {
    render(<OrderReview order={makeRow()} />);
    expect(isVnDateString(createdAtText())).toBe(true);
  });
  it('stays date-only: Ngày tạo lệnh carries no clock', () => {
    render(<OrderReview order={makeRow()} />);
    expect(createdAtText()).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it('renders each stop Ngày dự kiến as dd/MM/yyyy', () => {
    render(<OrderReview order={makeRow()} />);
    expect(firstStopText()).toContain('31/05/2026');
  });
  it('stop rows carry no clock and no English month', () => {
    render(<OrderReview order={makeRow()} />);
    const txt = firstStopText();
    expect(txt).not.toMatch(/\d{1,2}:\d{2}/);
    expect(txt).not.toContain('May');
  });
  it('uses the Asia/Ho_Chi_Minh calendar day for an evening creation instant', () => {
    // 17:30Z on 30/05 is already 00:30 on 31/05 in Vietnam.
    render(<OrderReview order={makeRow({ createdAt: '2026-05-30T17:30:00.000Z' })} />);
    expect(createdAtText()).toBe('31/05/2026');
  });
  it('renders the em-dash fallback when there is no creation instant', () => {
    render(<OrderReview order={makeRow({ createdAt: null })} />);
    expect(createdAtText()).toBe('\u2014');
  });
});
