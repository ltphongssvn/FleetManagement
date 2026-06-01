// apps/ops-web/src/features/dispatch/OrderReview.tsx
// Dispatcher review view: shows one transport order's key fields and stops.
// Pure presentational component — the page (server component) fetches the
// row via the BFF route and passes it in. Vietnamese labels match the rest
// of the dispatch UI; data-testid hooks are the contract consumed by the
// Playwright acceptance spec.
//
// T8: review mirrors the 'Lệnh điều xe - Tải thùng' form — fixed slot labels
// (Điểm nhận hàng 1..4, Kho giao hàng 1..) and 'Ngày tạo lệnh' (createdAt).
// T9: each stop also shows its warehouse name and a completion status derived
// from arrivedAt/departedAt (2026 DSD/timeline UX: confirm-then-record, show
// the actual time when done). The stops list has labelled columns.
import type { JSX } from 'react';
import type { ListAssignedRow, ListAssignedRowStop } from './types';
function dash(value: string | null): string {
  return value !== null && value !== '' ? value : '—';
}
function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}
// T8: per-type slot labels mirroring the create form's fixed slots.
function slotLabelsFor(stops: readonly ListAssignedRowStop[]): readonly string[] {
  let pickupN = 0;
  let deliveryN = 0;
  return stops.map((s) => {
    if (s.stopType === 'pickup') {
      pickupN += 1;
      return 'Điểm nhận hàng ' + String(pickupN);
    }
    deliveryN += 1;
    return 'Kho giao hàng ' + String(deliveryN);
  });
}
// T9: completion status from the immutable arrival/departure timestamps.
// 'Đã hoàn thành <time>' once the truck has been (departed preferred, else
// arrived); otherwise 'Chưa tới'. Never overwrites — purely derived.
function stopStatusOf(s: ListAssignedRowStop): string {
  const done = s.departedAt ?? s.arrivedAt;
  if (done === null) return 'Chưa tới';
  return 'Đã hoàn thành ' + formatDateTime(done);
}
export interface OrderReviewProps {
  readonly order: ListAssignedRow;
}
export function OrderReview({ order }: OrderReviewProps): JSX.Element {
  const slotLabels = slotLabelsFor(order.stops);
  return (
    <section className='mx-auto w-full max-w-3xl rounded-2xl bg-white/95 p-6 shadow-sm'>
      <h1 className='text-2xl font-bold tracking-tight text-slate-900'>Chi tiết đơn vận chuyển</h1>
      <dl className='mt-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2'>
        <div>
          <dt className='font-medium text-slate-500'>Mã tham chiếu</dt>
          <dd data-testid='order-review-external-ref' className='mt-1 text-slate-900'>{dash(order.externalRef)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Biển số xe</dt>
          <dd data-testid='order-review-plate' className='mt-1 text-slate-900'>{dash(order.plate)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Tài xế</dt>
          <dd data-testid='order-review-driver' className='mt-1 text-slate-900'>{dash(order.driverName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Khách hàng</dt>
          <dd data-testid='order-review-customer' className='mt-1 text-slate-900'>{dash(order.customerName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Tên hàng</dt>
          <dd data-testid='order-review-cargo' className='mt-1 text-slate-900'>{dash(order.cargoName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Ngày tạo lệnh</dt>
          <dd data-testid='order-review-created-at' className='mt-1 text-slate-900'>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Trạng thái</dt>
          <dd data-testid='order-review-state' className='mt-1 text-slate-900'>{order.state}</dd>
        </div>
      </dl>
      <div className='mt-8'>
        <h2 className='text-lg font-semibold text-slate-900'>Các điểm dừng</h2>
        <div data-testid='order-review-stops-header' className='mt-3 grid grid-cols-12 gap-2 border-b border-slate-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>
          <span className='col-span-4'>Điểm</span>
          <span className='col-span-4'>Kho</span>
          <span data-testid='order-review-stops-date-header' className='col-span-2'>Ngày dự kiến</span>
          <span className='col-span-2'>Trạng thái</span>
        </div>
        <ol data-testid='order-review-stops' className='divide-y divide-slate-200 rounded-b-lg border border-t-0 border-slate-200'>
          {order.stops.map((s, i) => (
            <li key={s.sequence} data-testid='order-review-stop' className='grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm'>
              <span className='col-span-4 font-medium text-slate-700'>{slotLabels[i]}</span>
              <span data-testid='order-review-stop-warehouse' className='col-span-4 text-slate-700'>{dash(s.warehouseName)}</span>
              <span className='col-span-2 text-slate-500'>{formatDateTime(s.plannedAt)}</span>
              <span data-testid='order-review-stop-status' className='col-span-2 text-slate-700'>{stopStatusOf(s)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
