// apps/ops-web/src/features/dispatch/cancel-order.action.ts
// Server Action (T5, 2026): dispatcher cancels a transport order. Calls
// API POST /transport-orders/:id/cancel via the BFF, using the
// fleet_session bearer cookie. On success the action triggers two
// revalidations (the review page being cancelled, and the dispatch board
// at '/'), then issues a server-side redirect to '/' so the dispatcher
// lands directly on the refreshed board.
//
// AUTH OWNERSHIP (hotfix 2026): this action OWNS its authentication. The auth
// proxy (apps/ops-web/src/proxy.ts) deliberately passes Server Action POSTs
// through untouched, because Next.js cannot forward a proxy rewrite/redirect for
// an action response -- diverting a Cancel POST to /login made the action client
// receive the /login payload instead of an action result and throw 'An
// unexpected response was received from the server' (the production crash:
// HTTP 404 + x-nextjs-action-not-found + x-middleware-rewrite:/login). Per the
// Next.js 2026 guidance (vercel/next.js #64993 + the May-2026 auth advisories),
// proxy.ts is a UX layer, not a security boundary; Server Actions are public
// POST endpoints that must authenticate themselves. So when the fleet_session
// cookie is missing/expired we redirect('/login') here, using the same
// Server-Action redirect protocol as the success path (the browser navigates to
// /login to re-authenticate, no opaque error). A genuine config fault
// (FLEET_API_URL unset) remains a server_error -- it is not an auth condition.
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
import { vnApiErrorMessage } from '../errors/present-problem';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CancelOrderInputSchema } from '@fleet/domain';
// transportOrderId is form-transport-specific; the reason/note contract and
// its reason===other-requires-note invariant come from the shared
// CancelOrderInputSchema SSOT. They are validated as two parses (id + cancel
// input) rather than a Zod intersection: intersecting an object with a
// refined schema (ZodEffects) does not compose the .refine reliably in Zod v4,
// so the shared schema is parsed directly to guarantee the same rule the API
// enforces fires here identically.
const IdSchema = z.guid('Invalid order id');
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
  const errors: Partial<Record<ErrorKey, string>> = {};
  const idResult = IdSchema.safeParse(formData.get('transportOrderId'));
  if (!idResult.success) {
    errors.transportOrderId = idResult.error.issues[0]?.message ?? 'Invalid order id';
  }
  const cancelResult = CancelOrderInputSchema.safeParse({
    reason: formData.get('reason'),
    ...(noteValue !== undefined ? { note: noteValue } : {}),
  });
  if (!cancelResult.success) {
    for (const issue of cancelResult.error.issues) {
      const k = issue.path[0];
      if (typeof k === 'string') errors[k as ErrorKey] = issue.message;
    }
  }
  if (!idResult.success || !cancelResult.success) {
    return { status: 'invalid', errors };
  }
  const parsed = { data: { transportOrderId: idResult.data, ...cancelResult.data } };
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) return { status: 'server_error', message: 'Hệ thống chưa được cấu hình. Vui lòng liên hệ quản trị.' };
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_session')?.value;
  // Missing/expired session: the proxy passed this Server Action through (it
  // cannot redirect an action response), so the action redirects to /login
  // itself. redirect() throws the Server-Action navigation directive; the
  // browser navigates to /login to re-authenticate. Never a server_error here.
  if (!token) redirect('/login');
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
    // Read the RFC 9457 body and present dispatcher Vietnamese; raw
    // transport text is structurally unreachable from here on.
    const errBody: unknown = await res.json().catch(() => undefined);
    return { status: 'api_error', message: vnApiErrorMessage(res.status, errBody) };
  }
  // Drain the response so the server doesn't leave the socket open.
  await res.json();
  revalidatePath('/dispatch/orders/' + parsed.data.transportOrderId);
  revalidatePath('/');
  // Server-Action redirect: terminates the action by throwing, Next.js
  // turns this into a navigation directive the browser follows reliably.
  redirect('/');
}
