// apps/ops-web/src/features/dispatch/CancelOrderForm.tsx
// T5 (2026): client component that lets a dispatcher cancel a transport
// order from the review view. Modal-style: an open button reveals the
// form (reason select + optional note + submit). Form posts via the
// useActionState hook so the server action surfaces idempotent / 409
// / 404 outcomes back to the UI.
//
// SCHEMA-FIRST SSOT (cancel-refactor 2026): the reason VALUES are no longer
// hardcoded here. REASON_LABELS is a Record<CancelReason, string> keyed by the
// @fleet/domain enum, and the <option> list is derived by iterating the shared
// CANCEL_REASONS (canonical order preserved). Adding a reason to the domain enum
// is now a COMPILE ERROR here until a Vietnamese label is supplied for it -- the
// type-safety guard that was missing when the six values were a loose string[].
// The labels themselves remain Vietnamese domain language (presentation layer);
// only the value vocabulary is shared contract.
//
// Defense in depth: the open button is hidden when the order is already in a
// non-cancellable state (cancelled / completed). The API remains the authority --
// if state was stale and the user races a click, the 409 path is handled
// gracefully via the action's discriminated union return.
//
// Post-cancel navigation: the action itself issues redirect('/') on success.
// Next.js's Server-Action redirect protocol drives the browser to '/' before the
// form unmounts, so the dispatcher lands on the refreshed Bảng điều phối board.
// The form never sees a status='cancelled' result here.
//
// data-testid hooks are the contract consumed by the Playwright L0 acceptance
// spec: order-cancel-open, order-cancel-reason, order-cancel-note,
// order-cancel-submit. Do not rename without updating the e2e specs.
'use client';
import { useActionState, useState } from 'react';
import type { JSX } from 'react';
import { CANCEL_REASONS, type CancelReason } from '@fleet/domain';
import { cancelOrder, type CancelOrderState } from './cancel-order.action';
// Vietnamese display labels for each canonical reason code. Keyed by CancelReason
// so the compiler enforces exhaustiveness: a new enum member breaks this build
// until its label is added. Order shown to the dispatcher follows CANCEL_REASONS.
const REASON_LABELS: Record<CancelReason, string> = {
  customer_request: 'Khách hàng yêu cầu',
  driver_unavailable: 'Tài xế không khả dụng',
  vehicle_breakdown: 'Sự cố phương tiện',
  weather: 'Thời tiết',
  duplicate: 'Đơn trùng lặp',
  other: 'Khác',
};
const NON_CANCELLABLE_STATES: ReadonlySet<string> = new Set(['cancelled', 'completed']);
export interface CancelOrderFormProps {
  readonly transportOrderId: string;
  readonly state: string;
  // Server-computed cancel affordance (single source of truth). When the API
  // reports the order is no longer cancellable (e.g. weigh-slip photos received),
  // canCancel is false and cancelBlockedReason carries the reason code. The form
  // renders an explanatory blocked notice instead of the open button -- it never
  // re-derives the rule. Optional with cancellable defaults for back-compat with
  // call sites that predate the flag; the API stays the ultimate authority.
  readonly canCancel?: boolean;
  readonly cancelBlockedReason?: string | null;
}
export function CancelOrderForm({
  transportOrderId,
  state,
  canCancel = true,
  cancelBlockedReason = null,
}: CancelOrderFormProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  // The other bucket is only a recorded reason when a free-text note explains
  // it, so the note becomes required (and the submit disabled) until then.
  const [note, setNote] = useState<string>('');
  const noteRequired = reason === 'other';
  const noteMissing = noteRequired && note.trim().length === 0;
  const [result, formAction, pending] = useActionState<CancelOrderState, FormData>(
    cancelOrder,
    undefined,
  );
  if (NON_CANCELLABLE_STATES.has(state)) {
    return null;
  }
  // Server says this order can no longer be cancelled. Show WHY instead of the
  // open button. The reason code -> Vietnamese message map lives here (labels
  // are presentation); the rule itself is server-authored.
  if (!canCancel) {
    const blockedMessage =
      cancelBlockedReason === 'photos_received'
        ? 'Không thể hủy đơn: đã nhận phiếu cân. Đơn đã bắt đầu vận chuyển.'
        : 'Không thể hủy đơn ở trạng thái hiện tại.';
    return (
      <div className="mt-4">
        <p
          data-testid="order-cancel-blocked"
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600"
        >
          {blockedMessage}
        </p>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          data-testid="order-cancel-open"
          onClick={() => {
            setOpen(true);
          }}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50"
        >
          Hủy đơn
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/40 p-4">
      <h3 className="text-lg font-semibold text-red-800">Hủy đơn vận chuyển</h3>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="transportOrderId" value={transportOrderId} />
        <div>
          <label htmlFor="order-cancel-reason" className="block text-sm font-medium text-slate-700">
            Lý do
          </label>
          <select
            id="order-cancel-reason"
            name="reason"
            data-testid="order-cancel-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            required
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="" disabled>
              -- Chọn lý do --
            </option>
            {CANCEL_REASONS.map((value) => (
              <option key={value} value={value}>
                {REASON_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="order-cancel-note" className="block text-sm font-medium text-slate-700">
            {noteRequired ? 'Ghi chú (bắt buộc khi chọn Khác)' : 'Ghi chú (tùy chọn)'}
          </label>
          <textarea
            id="order-cancel-note"
            name="note"
            data-testid="order-cancel-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            required={noteRequired}
            aria-required={noteRequired}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          {noteMissing && (
            <p className="mt-1 text-sm text-red-700" data-testid="order-cancel-note-required">
              Vui lòng nhập lý do cụ thể khi chọn "Khác".
            </p>
          )}
        </div>
        {result?.status === 'invalid' && (
          <div className="text-sm text-red-700">
            {result.errors.reason ??
              result.errors.note ??
              result.errors.transportOrderId ??
              'Dữ liệu không hợp lệ'}
          </div>
        )}
        {result?.status === 'conflict' && (
          <div className="text-sm text-red-700">Không thể hủy đơn ở trạng thái hiện tại.</div>
        )}
        {result?.status === 'not_found' && (
          <div className="text-sm text-red-700">Không tìm thấy đơn.</div>
        )}
        {(result?.status === 'api_error' || result?.status === 'server_error') && (
          <div className="text-sm text-red-700">{result.message}</div>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            data-testid="order-cancel-submit"
            disabled={pending || noteMissing}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Đang hủy...' : 'Xác nhận hủy'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            disabled={pending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Quay lại
          </button>
        </div>
      </form>
    </div>
  );
}
