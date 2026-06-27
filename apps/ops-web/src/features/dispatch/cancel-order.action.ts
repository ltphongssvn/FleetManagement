// apps/ops-web/src/features/dispatch/cancel-order.action.ts
// Server Action (T5, 2026): dispatcher cancels a transport order. Calls
// API POST /transport-orders/:id/cancel via the BFF, using the
// fleet_session bearer cookie. On success the action triggers two
// revalidations (the review page being cancelled, and the dispatch board
// at '/'), then issues a server-side redirect to '/' so the dispatcher
// lands directly on the refreshed board.
//
// SCHEMA-FIRST SSOT (cancel-refactor 2026): the reason vocabulary is NOT
// declared here. It is imported from @fleet/domain (CancelReasonSchema), the
// SINGLE definition shared with the API DTO. This module previously declared
// its own z.enum copy that had drifted from the API (note had no min(1) here).
// note is now min(1).max(500) to match the API contract; this is behavior-
// preserving because whitespace-only notes are already coerced to undefined
// below before parsing, so a 1-char floor can never reject a real submission.
//
// Why redirect from the action instead of useEffect in the form: after a
// successful cancel the form's parent server component re-renders with
// state='cancelled', the form returns null and unmounts, and any post-mount
// client-side effect (router.push or window.location.assign) races the unmount.
// Calling redirect() inside the action delegates navigation to Next.js's
// Server-Action redirect protocol: the browser navigates to '/' before unmount.
//
// Discriminated-union return: only error branches are returned
// (invalid/server_error/api_error/not_found/conflict). The 'cancelled' branch is
// unreachable because redirect() throws and never returns; it is kept in the
// union for caller type-safety so form code checking result?.status compiles.
'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CancelReasonSchema } from '@fleet/domain';
const FormSchema = z.object({
  transportOrderId: z.guid('Invalid order id'),
  reason: CancelReasonSchema,
  note: z.string().min(1).max(500).optional(),
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
  // Drain the response so the server doesn't leave the socket open.
  await res.json();
  revalidatePath('/dispatch/orders/' + parsed.data.transportOrderId);
  revalidatePath('/');
  // Server-Action redirect: terminates the action by throwing, Next.js
  // turns this into a navigation directive the browser follows reliably.
  redirect('/');
}
