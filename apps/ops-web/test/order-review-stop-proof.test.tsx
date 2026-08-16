// apps/ops-web/test/order-review-stop-proof.test.tsx
// RED (outside-in): the EXACT reported defect. A transport order that is already
// Da hoan tat, whose stops have uploaded Phieu Can photos, opened by clicking its
// ma lenh, still showed Chua toi in the Trang thai column -- because OrderReview
// derived status from arrivedAt/departedAt alone and ignored the committed proof,
// while the dispatch board rendered the same stop as a Phieu Can link plus its kg.
//
// Pinned here: when a stop carries proof, the review view shows the captured
// weight (and a link to the photo) and NEVER the Chua toi fallback. Stops with no
// proof keep the timestamp-derived behaviour unchanged, so this is additive.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OrderReview } from '@/features/dispatch/OrderReview';
import type { ListAssignedRow } from '@/features/dispatch/types';

afterEach(() => { cleanup(); });

// A completed order exactly as reported: photos uploaded at the stops, road run
// moved to Da hoan tat, but arrival timestamps never written by the driver app.
// That last detail is what made the old code fall through to Chua toi.
const completedRow: ListAssignedRow = {
  transportOrderId: '33333333-3333-3333-3333-333333333333',
  externalRef: 'XTT.07-021',
  orderRef: 'XTT.07-021',
  roadRunId: 'rr-49',
  state: 'completed',
  plannedStartAt: '2026-07-20T01:00:00.000Z',
  createdAt: '2026-07-19T02:30:00.000Z',
  startedAt: '2026-07-20T01:15:00.000Z',
  completedAt: '2026-07-20T09:30:00.000Z',
  plate: '62H 05194',
  customerName: 'DAI THANH',
  cargoName: 'GAO',
  driverName: 'NGUYEN THANH PHONG',
  pickupName: null,
  deliveryName: null,
  canCancel: false,
  cancelBlockedReason: 'photos_received',
  stops: [
    {
      sequence: 1,
      stopType: 'pickup',
      plannedAt: '2026-07-20T02:00:00.000Z',
      warehouseName: 'Chon Chinh',
      arrivedAt: null,
      departedAt: null,
      proof: {
        manifestId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        photoUrl: 'https://s3.test.local/pickup.jpg?sig=a',
        capturedAt: '2026-07-20T02:10:00.000Z',
        extractedNetWeightKg: 20730,
        extractionStatus: 'extracted',
        extractionReason: null,
      },
    },
    {
      sequence: 2,
      stopType: 'delivery',
      plannedAt: '2026-07-20T08:00:00.000Z',
      warehouseName: 'DA NANG',
      arrivedAt: null,
      departedAt: null,
      proof: {
        manifestId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
        photoUrl: 'https://s3.test.local/delivery.jpg?sig=b',
        capturedAt: '2026-07-20T09:10:00.000Z',
        extractedNetWeightKg: 20680,
        extractionStatus: 'extracted',
        extractionReason: null,
      },
    },
    {
      sequence: 3,
      stopType: 'delivery',
      plannedAt: '2026-07-20T10:00:00.000Z',
      warehouseName: 'CAN THO',
      arrivedAt: null,
      departedAt: null,
      proof: null,
    },
  ],
};

function statusTextAt(index: number): string {
  const items = screen.getAllByTestId('order-review-stop');
  return items[index]?.querySelector('[data-testid=order-review-stop-status]')?.textContent ?? '';
}

describe('OrderReview - completed order with uploaded stop photos', () => {
  it('never shows Chua toi for a stop that has an uploaded Phieu Can', () => {
    render(<OrderReview order={completedRow} />);
    expect(statusTextAt(0)).not.toContain('Chua toi');
    expect(statusTextAt(0)).not.toContain('Ch\u01b0a t\u1edbi');
    expect(statusTextAt(1)).not.toContain('Ch\u01b0a t\u1edbi');
  });

  it('shows the kilograms captured in the uploaded photo, vi-VN grouped', () => {
    render(<OrderReview order={completedRow} />);
    // 20730 -> 20.730 kg under vi-VN grouping, matching the board exactly.
    expect(statusTextAt(0)).toContain('20.730 kg');
    expect(statusTextAt(1)).toContain('20.680 kg');
  });

  it('links each proof to its photo so the dispatcher can open the Phieu Can', () => {
    render(<OrderReview order={completedRow} />);
    const items = screen.getAllByTestId('order-review-stop');
    const link = items[0]?.querySelector('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://s3.test.local/pickup.jpg?sig=a');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('leaves the timestamp-derived status untouched for a stop with no proof', () => {
    render(<OrderReview order={completedRow} />);
    expect(statusTextAt(2)).toBe('Ch\u01b0a t\u1edbi');
  });
});
