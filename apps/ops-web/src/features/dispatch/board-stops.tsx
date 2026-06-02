// apps/ops-web/src/features/dispatch/board-stops.tsx
// Shared per-stop board helpers (T10). The Lệnh điều xe board and the
// DispatchView home board both render fixed per-stop status columns
// (Điểm nhận hàng 1..4, Kho giao hàng 1) derived from each stop's
// arrived/departed timestamps (2026 DSD/timeline UX: confirm-then-record).
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
            <span data-testid={'board-stop-status-' + primaryRef + '-pickup-' + String(n)}>{s ? stopStatusOf(s) : '—'}</span>
          </td>
        );
      })}
      {DELIVERY_SLOTS.map((n) => {
        const s = stopForSlot(stops, 'delivery', n);
        return (
          <td key={'dc-' + String(n)} className='px-3 py-2 text-xs'>
            <span data-testid={'board-stop-status-' + primaryRef + '-delivery-' + String(n)}>{s ? stopStatusOf(s) : '—'}</span>
          </td>
        );
      })}
    </>
  );
}
export const STOP_SLOT_COL_COUNT = PICKUP_SLOTS.length + DELIVERY_SLOTS.length;
