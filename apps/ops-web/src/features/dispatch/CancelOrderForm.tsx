// apps/ops-web/src/features/dispatch/CancelOrderForm.tsx
// T5 (2026): client component that lets a dispatcher cancel a transport
// order from the review view. Modal-style: an open button reveals the
// form (reason select + optional note + submit). Form posts via the
// useActionState hook so the server action surfaces idempotent / 409
// / 404 outcomes back to the UI.
//
// Defense in depth: the open button is hidden when the order is already
// in a non-cancellable state (cancelled / completed). The API remains
// the authority — if state was stale and the user races a click, the
// 409 path is still handled gracefully via the action's discriminated
// union return.
//
// data-testid hooks are the contract consumed by the Playwright L0
// acceptance spec: order-cancel-open, order-cancel-reason,
// order-cancel-note, order-cancel-submit. Do not rename without
// updating e2e/dispatch-order-cancel.spec.ts.
'use client';
import { useActionState, useState } from 'react';
import type { JSX } from 'react';
import { cancelOrder, type CancelOrderState } from './cancel-order.action';
const REASON_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'customer_request',  label: 'Khách hàng yêu cầu' },
  { value: 'driver_unavailable', label: 'Tài xế không khả dụng' },
  { value: 'vehicle_breakdown',  label: 'Sự cố phương tiện' },
  { value: 'weather',            label: 'Thời tiết' },
  { value: 'duplicate',          label: 'Đơn trùng lặp' },
  { value: 'other',              label: 'Khác' },
];
const NON_CANCELLABLE_STATES: ReadonlySet<string> = new Set(['cancelled', 'completed']);
export interface CancelOrderFormProps {
  readonly transportOrderId: string;
  readonly state: string;
}
export function CancelOrderForm({ transportOrderId, state }: CancelOrderFormProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [result, formAction, pending] = useActionState<CancelOrderState, FormData>(cancelOrder, undefined);
  if (NON_CANCELLABLE_STATES.has(state)) {
    return null;
  }
  if (!open) {
    return (
      <div className='mt-4'>
        <button
          type='button'
          data-testid='order-cancel-open'
          onClick={() => { setOpen(true); }}
          className='rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50'
        >
          Hủy đơn
        </button>
      </div>
    );
  }
  return (
    <div className='mt-4 rounded-2xl border border-red-200 bg-red-50/40 p-4'>
      <h3 className='text-lg font-semibold text-red-800'>Hủy đơn vận chuyển</h3>
      <form action={formAction} className='mt-3 space-y-3'>
        <input type='hidden' name='transportOrderId' value={transportOrderId} />
        <div>
          <label htmlFor='order-cancel-reason' className='block text-sm font-medium text-slate-700'>Lý do</label>
          <select
            id='order-cancel-reason'
            name='reason'
            data-testid='order-cancel-reason'
            defaultValue=''
            required
            className='mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
          >
            <option value='' disabled>-- Chọn lý do --</option>
            {REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor='order-cancel-note' className='block text-sm font-medium text-slate-700'>Ghi chú (tùy chọn)</label>
          <textarea
            id='order-cancel-note'
            name='note'
            data-testid='order-cancel-note'
            rows={3}
            maxLength={500}
            className='mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
          />
        </div>
        {result?.status === 'invalid' && (
          <div className='text-sm text-red-700'>
            {result.errors.reason ?? result.errors.note ?? result.errors.transportOrderId ?? 'Dữ liệu không hợp lệ'}
          </div>
        )}
        {result?.status === 'conflict' && (
          <div className='text-sm text-red-700'>Không thể hủy đơn ở trạng thái hiện tại.</div>
        )}
        {result?.status === 'not_found' && (
          <div className='text-sm text-red-700'>Không tìm thấy đơn.</div>
        )}
        {(result?.status === 'api_error' || result?.status === 'server_error') && (
          <div className='text-sm text-red-700'>{result.message}</div>
        )}
        <div className='flex gap-2'>
          <button
            type='submit'
            data-testid='order-cancel-submit'
            disabled={pending}
            className='rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50'
          >
            {pending ? 'Đang hủy...' : 'Xác nhận hủy'}
          </button>
          <button
            type='button'
            onClick={() => { setOpen(false); }}
            disabled={pending}
            className='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
          >
            Quay lại
          </button>
        </div>
      </form>
    </div>
  );
}
