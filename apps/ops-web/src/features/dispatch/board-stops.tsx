// apps/ops-web/src/features/dispatch/board-stops.tsx
// Shared per-stop board helpers (T10). The Lệnh điều xe board and the
// DispatchView home board both render fixed per-stop status columns
// (Điểm nhận hàng 1..4, Kho giao hàng 1) derived from each stop's
// arrived/departed timestamps (2026 DSD/timeline UX: confirm-then-record).
//
// Per-stop proof photo (Phiếu Cân): a stop whose DispatchBoardStop.proof is
// non-null (StopProof from @fleet/sync-protocol — Zod-first single source of
// truth, producer = api /dispatch/board) renders a clickable 'Phiếu Cân'
// hyperlink to the presigned photo URL instead of the arrival-status text.
// Outside-in TDD: apps/ops-web/test/board-stops-phieu-can.test.tsx.
import type { JSX } from 'react';
import type { DispatchBoardStop } from './types';

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
        <th key={'dh-' + String(n)} className='px-3 py-2'>{'Kho giao hàng ' + String(n)}</th>
      ))}
    </>
  );
}

// Renders one stop cell: the 'Phiếu Cân' proof link when a committed proof
// photo exists, otherwise the arrival-status text; em-dash for empty slots.
// The <a opener deliberately shares its line with the first attribute — a
// bare '<a' alone on a shallow-indented line gets stripped by some shells
// during heredoc writes (context/file-editing-pattern.md, rule 5).
function StopCellContent({
  stop,
  testId,
}: {
  stop: DispatchBoardStop | undefined;
  testId: string;
}): JSX.Element {
  if (stop === undefined) {
    return <span data-testid={testId}>{'—'}</span>;
  }
  if (stop.proof !== null) {
    // Phieu-can net weight (kg): present only after the extraction worker
    // persisted a validated value; vi-VN grouping (20.730 kg = 20,730 kg).
    const kg = stop.proof.extractedNetWeightKg ?? null;
    // External presigned S3 GET URL: new tab + noopener/noreferrer safety.
    // Stacked layout: the Phiếu Cân link on top, the extracted net weight on its
    // own line directly UNDER it (flex-col), so each stop column reads link-over-kg.
    return (
      <span data-testid={testId} className='inline-flex flex-col items-start gap-0.5'>
        <a href={stop.proof.photoUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-blue-600 underline hover:text-blue-800'
        >
          {'Phiếu Cân'}
        </a>
        {kg !== null ? (
          <span
            data-testid={testId.replace('board-stop-status-', 'board-stop-netweight-')}
            className='text-gray-700 tabular-nums'
          >
            {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(kg) + ' kg'}
          </span>
        ) : null}
      </span>
    );
  }
  return <span data-testid={testId}>{stopStatusOf(stop)}</span>;
}

export function StopSlotCells({
  primaryRef,
  stops,
}: {
  primaryRef: string;
  stops: readonly DispatchBoardStop[] | undefined;
}): JSX.Element {
  return (
    <>
      {PICKUP_SLOTS.map((n) => {
        const s = stopForSlot(stops, 'pickup', n);
        return (
          <td key={'pc-' + String(n)} className='px-3 py-2 text-xs'>
            <StopCellContent stop={s} testId={'board-stop-status-' + primaryRef + '-pickup-' + String(n)} />
          </td>
        );
      })}
      {DELIVERY_SLOTS.map((n) => {
        const s = stopForSlot(stops, 'delivery', n);
        return (
          <td key={'dc-' + String(n)} className='px-3 py-2 text-xs'>
            <StopCellContent stop={s} testId={'board-stop-status-' + primaryRef + '-delivery-' + String(n)} />
          </td>
        );
      })}
    </>
  );
}

export const STOP_SLOT_COL_COUNT = PICKUP_SLOTS.length + DELIVERY_SLOTS.length;
