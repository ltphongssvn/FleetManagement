// apps/ops-web/src/features/dispatch/OrderReview.tsx
// Dispatcher review view: shows one transport order's key fields and stops.
// Pure presentational component — the page (server component) fetches the
// row via the BFF route and passes it in. Vietnamese labels match the rest
// of the dispatch UI; data-testid hooks are the contract consumed by the
// Playwright acceptance spec.
import type { JSX } from 'react';
import type { ListAssignedRow } from './types';
function dash(value: string | null): string {
  return value !== null && value !== '' ? value : '—';
}
function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}
export interface OrderReviewProps {
  readonly order: ListAssignedRow;
}
export function OrderReview({ order }: OrderReviewProps): JSX.Element {
  return (
    <section className='mx-auto w-full max-w-3xl rounded-2xl bg-white/95 p-6 shadow-sm'>
      <h1 className='text-2xl font-bold tracking-tight text-slate-900'>Chi tiết đơn vận chuyển</h1>
      <dl className='mt-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2'>
        <div>
          <dt className='font-medium text-slate-500'>Mã đơn (ID)</dt>
          <dd data-testid='order-review-id' className='mt-1 font-mono text-slate-900 break-all'>{order.transportOrderId}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Mã tham chiếu</dt>
          <dd data-testid='order-review-external-ref' className='mt-1 text-slate-900'>{dash(order.externalRef)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Biển số xe</dt>
          <dd data-testid='order-review-plate' className='mt-1 text-slate-900'>{dash(order.plate)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Khách hàng</dt>
          <dd data-testid='order-review-customer' className='mt-1 text-slate-900'>{dash(order.customerName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Điểm lấy hàng</dt>
          <dd data-testid='order-review-pickup' className='mt-1 text-slate-900'>{dash(order.pickupName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Điểm giao hàng</dt>
          <dd data-testid='order-review-delivery' className='mt-1 text-slate-900'>{dash(order.deliveryName)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Bắt đầu dự kiến</dt>
          <dd data-testid='order-review-planned-start' className='mt-1 text-slate-900'>{formatDateTime(order.plannedStartAt)}</dd>
        </div>
        <div>
          <dt className='font-medium text-slate-500'>Trạng thái</dt>
          <dd data-testid='order-review-state' className='mt-1 text-slate-900'>{order.state}</dd>
        </div>
      </dl>
      <div className='mt-8'>
        <h2 className='text-lg font-semibold text-slate-900'>Các điểm dừng</h2>
        <ol data-testid='order-review-stops' className='mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200'>
          {order.stops.map((s) => (
            <li key={s.sequence} data-testid='order-review-stop' className='flex items-center justify-between px-4 py-3 text-sm'>
              <span className='font-medium text-slate-700'>#{s.sequence} · {s.stopType}</span>
              <span className='text-slate-500'>{formatDateTime(s.plannedAt)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
