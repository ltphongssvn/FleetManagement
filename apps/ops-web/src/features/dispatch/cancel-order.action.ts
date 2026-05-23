// apps/ops-web/src/features/dispatch/cancel-order.action.ts
// Server Action (T5, 2026): dispatcher cancels a transport order. Calls
// API POST /transport-orders/:id/cancel via the BFF, using the
// fleet_session bearer cookie. On success revalidates the review page so
// the dispatcher sees the new 'cancelled' state immediately.
//
// Discriminated-union return matches the create-order.action.ts shape so
// the form caller can branch on status without parsing messages. The
// distinct 'not_found' and 'conflict' statuses (vs lumping into api_error)
// let the UI render specific guidance: "this order no longer exists" vs
// "this order can no longer be cancelled because ...".
'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
const CancelReasonSchema = z.enum([
  'customer_request',
  'driver_unavailable',
  'vehicle_breakdown',
  'weather',
  'duplicate',
  'other',
]);
const FormSchema = z.object({
  transportOrderId: z.string().uuid('Invalid order id'),
  reason: CancelReasonSchema,
  note: z.string().max(500).optional(),
});
type ErrorKey = 'transportOrderId' | 'reason' | 'note';
export type CancelOrderState =
  | undefined
  | { status: 'invalid'; errors: Partial<Record<ErrorKey, string>> }
  | { status: 'server_error'; message: string }
  | { status: 'api_error'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'cancelled'; transportOrderId: string; idempotent: boolean };
export async function cancelOrder(_prev: CancelOrderState, formData: FormData): Promise<CancelOrderState> {
  const rawNote = formData.get('note');
  const noteValue = typeof rawNote === 'string' && rawNote.trim() !== '' ? rawNote : undefined;
  const parsed = FormSchema.safeParse({
    transportOrderId: formData.get('transportOrderId'),
    reason: formData.get('reason'),
    ...(noteValue !== undefined ? { note: noteValue } : {}),
  });
  if (!parsed.success) {
    const errors: Partial<Record<ErrorKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === 'string') errors[k as ErrorKey] = issue.message;
    }
    return { status: 'invalid', errors };
  }
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return { status: 'server_error', message: 'FLEET_API_URL not configured' };
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  if (!token) return { status: 'server_error', message: 'Not authenticated' };
  const body: { reason: string; note?: string } = { reason: parsed.data.reason };
  if (parsed.data.note !== undefined) body.note = parsed.data.note;
  const res = await fetch(apiUrl + '/transport-orders/' + parsed.data.transportOrderId + '/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.status === 404) {
    return { status: 'not_found', message: 'Transport order not found' };
  }
  if (res.status === 409) {
    return { status: 'conflict', message: 'Transport order cannot be cancelled in its current state' };
  }
  if (!res.ok) {
    return { status: 'api_error', message: 'API request failed: ' + String(res.status) + ' ' + res.statusText };
  }
  const json = (await res.json()) as { transportOrderId: string; idempotent: boolean };
  revalidatePath('/dispatch/orders/' + parsed.data.transportOrderId);
  return { status: 'cancelled', transportOrderId: json.transportOrderId, idempotent: json.idempotent };
}
