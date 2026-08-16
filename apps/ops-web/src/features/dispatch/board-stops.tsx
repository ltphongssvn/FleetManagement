// apps/ops-web/src/features/dispatch/board-stops.tsx
// Shared per-stop board helpers (T10). The Lệnh điều xe board and the
// DispatchView home board both render fixed per-stop status columns
// (Điểm nhận hàng 1..4, Kho giao hàng) derived from each stop's
// arrived/departed timestamps (2026 DSD/timeline UX: confirm-then-record).
//
// Per-stop proof photo (Phiếu Cân): a stop whose DispatchBoardStop.proof is
// non-null (StopProof from @fleet/sync-protocol — Zod-first single source of
// truth, producer = api /dispatch/board) renders a clickable 'Phiếu Cân'
// hyperlink to the presigned photo URL instead of the arrival-status text.
// Outside-in TDD: apps/ops-web/test/board-stops-phieu-can.test.tsx.
//
// Warehouse name (Feature 1, 2026): each stop cell renders its warehouse NAME
// stacked ABOVE the link/status, so the dispatcher reads warehouse-over-kg per
// column (e.g. "Đức Tài" over "Phiếu Cân" over "7.920 kg"). warehouseName is the
// canonical DispatchBoardStop field (server LEFT JOIN warehouse). null name =>
// no node (no em-dash leak). Outside-in TDD: board-stops-warehouse-name.test.tsx.
import type { JSX } from 'react';
import type { DispatchBoardStop } from './types';
// ONE proof renderer, shared with OrderReview (stop-proof-view.tsx).
//
// Merge resolution (develop -> this branch): develop enhanced the INLINE proof
// block that this branch had already extracted into StopProofView. Per 2026
// refactor-vs-feature conflict practice the feature change is applied to the
// refactored structure, so REASON_VI and the ExtractionFailureReason binding
// now live in stop-proof-view.tsx (the SSOT renderer) and must NOT be
// reintroduced here -- a second copy in this file is the exact drift that made
// a completed order read 'Chưa tới' on review while the board showed its kg.
import { StopProofView } from './stop-proof-view';

export const PICKUP_SLOTS = [1, 2, 3, 4] as const;
export const DELIVERY_SLOTS = [1] as const;

const STATUS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function stopStatusOf(s: DispatchBoardStop): string {
  const done = s.departedAt ?? s.arrivedAt;
  if (done === null) return 'Chưa tới';
  const d = new Date(done);
  if (Number.isNaN(d.getTime())) return 'Chưa tới';
  return 'Đã hoàn thành ' + STATUS_FORMATTER.format(d);
}

export function stopForSlot(
  stops: readonly DispatchBoardStop[] | undefined,
  stopType: 'pickup' | 'delivery',
  slotIndex: number,
): DispatchBoardStop | undefined {
  const ofType = (stops ?? [])
    .filter((s) => {
      const t = s.stopType.toLowerCase();
      return stopType === 'pickup' ? t === 'pickup' : t === 'delivery' || t === 'dropoff';
    })
    .sort((a, b) => a.sequence - b.sequence);
  return ofType[slotIndex - 1];
}

export function StopSlotHeaders(): JSX.Element {
  return (
    <>
      {PICKUP_SLOTS.map((n) => (
        <th key={'ph-' + String(n)} className='px-3 py-2'>{'Điểm nhận hàng ' + String(n)}</th>
      ))}
      {DELIVERY_SLOTS.map((n) => (
        // 2026: render the bare label because there is exactly one delivery
        // slot per road run today (DELIVERY_SLOTS = [1] above). The trailing
        // slot number carries no information when N == 1. If a future product
        // change adds multiple delivery slots, the DELIVERY_SLOTS constant
        // must be expanded AND this label must become 'Kho giao hàng N' so
        // the dispatcher can still distinguish them.
        <th key={'dh-' + String(n)} className='px-3 py-2'>{'Kho giao hàng'}</th>
      ))}
    </>
  );
}

// The arrival/proof portion of a stop cell: the 'Phiếu Cân' proof link when a
// committed proof photo exists, otherwise the arrival-status text. This is the
// content rendered UNDER the warehouse name.
function StopCellInner({
  stop,
  testId,
  onEnterNetWeight,
}: {
  stop: DispatchBoardStop;
  testId: string;
  onEnterNetWeight?: ((manifestId: string) => void) | undefined;
}): JSX.Element {
  if (stop.proof !== null) {
    // Delegates to the SSOT proof renderer shared with the review view, so
    // the board and the dispatcher review can never again show the same
    // stop two different ways. Only the testid vocabulary differs.
    return (
      <StopProofView
        proof={stop.proof}
        testIds={{
          root: testId,
          netWeight: testId.replace('board-stop-status-', 'board-stop-netweight-'),
          needsEntry: testId.replace('board-stop-status-', 'board-stop-netweight-needsentry-'),
          reason: testId.replace('board-stop-status-', 'board-stop-reason-'),
          pending: testId.replace('board-stop-status-', 'board-stop-netweight-pending-'),
        }}
        onEnterNetWeight={onEnterNetWeight}
      />
    );
  }
  return <span data-testid={testId}>{stopStatusOf(stop)}</span>;
}

// One stop cell: the warehouse NAME (when present) stacked ABOVE the arrival/
// proof content. Empty slot (no stop) => em-dash only. The name testid derives
// from the slot status testid (board-stop-status- -> board-stop-warehouse-),
// matching the netweight/reason testid convention.
function StopCellContent({
  stop,
  testId,
  onEnterNetWeight,
}: {
  stop: DispatchBoardStop | undefined;
  testId: string;
  onEnterNetWeight?: ((manifestId: string) => void) | undefined;
}): JSX.Element {
  if (stop === undefined) {
    return <span data-testid={testId}>{'—'}</span>;
  }
  const warehouseName = stop.warehouseName;
  return (
    <span className='inline-flex flex-col items-start gap-0.5'>
      {warehouseName !== null && warehouseName !== '' ? (
        <span
          data-testid={testId.replace('board-stop-status-', 'board-stop-warehouse-')}
          className='font-medium text-gray-900'
        >
          {warehouseName}
        </span>
      ) : null}
      <StopCellInner stop={stop} testId={testId} onEnterNetWeight={onEnterNetWeight} />
    </span>
  );
}

export function StopSlotCells({
  primaryRef,
  stops,
  onEnterNetWeight,
}: {
  primaryRef: string;
  stops: readonly DispatchBoardStop[] | undefined;
  onEnterNetWeight?: ((manifestId: string) => void) | undefined;
}): JSX.Element {
  return (
    <>
      {PICKUP_SLOTS.map((n) => {
        const s = stopForSlot(stops, 'pickup', n);
        return (
          <td key={'pc-' + String(n)} className='px-3 py-2 text-xs'>
            <StopCellContent stop={s} testId={'board-stop-status-' + primaryRef + '-pickup-' + String(n)} onEnterNetWeight={onEnterNetWeight} />
          </td>
        );
      })}
      {DELIVERY_SLOTS.map((n) => {
        const s = stopForSlot(stops, 'delivery', n);
        return (
          <td key={'dc-' + String(n)} className='px-3 py-2 text-xs'>
            <StopCellContent stop={s} testId={'board-stop-status-' + primaryRef + '-delivery-' + String(n)} onEnterNetWeight={onEnterNetWeight} />
          </td>
        );
      })}
    </>
  );
}

export const STOP_SLOT_COL_COUNT = PICKUP_SLOTS.length + DELIVERY_SLOTS.length;
