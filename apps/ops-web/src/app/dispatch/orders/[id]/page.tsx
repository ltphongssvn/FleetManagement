// apps/ops-web/src/app/dispatch/orders/[id]/page.tsx
// Dispatcher review page: server component fetches the order via the BFF
// (which forwards to the API with the fleet_session bearer token) and hands
// it to the OrderReview presentational component. notFound() is called on
// any non-2xx so unknown ids render the framework 404, matching the API.
//
// P0-#2 (2026): the BFF response is now PARSED at this trust boundary via
// ListAssignedRowSchema (the @fleet/sync-protocol SSOT) instead of being cast
// with 'as ListAssignedRow'. An untrusted server response that drifts from the
// contract now throws a descriptive ZodError here — at the boundary, with the
// offending path — rather than silently surfacing as undefined deep in the UI.
//
// T5 (2026):
//   * Composes the CancelOrderForm client component below the review pane.
//     The form decides for itself whether to render the open button based
//     on the order's current state; non-cancellable states make the form
//     invisible.
//   * The :id URL param can be either a transport_order UUID or the human-
//     readable XTT.MM-NNN external_ref. The API review endpoint accepts
//     either form (company-scoped findByCompanyIdOrRef under the hood) so
//     the page hands the param through unchanged. The dispatch board links
//     rows by external_ref; direct UUID links continue to work.
//
// T6 (2026): renders an explicit in-page Back control (testid
// order-review-back) linking to the dispatch board (/). Best-UX navigation:
// the dispatcher returns to the board without relying on the browser back
// button. Permanent rule: every page provides UI navigation back to the
// previous menu / between pages.
import type { JSX } from 'react';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sessionRefreshUrl } from '@/features/auth/session-refresh-navigation';
import { ListAssignedRowSchema } from '@fleet/sync-protocol';
import { OrderReview } from '@/features/dispatch/OrderReview';
import { CancelOrderForm } from '@/features/dispatch/CancelOrderForm';
import { AppShell } from '@/features/shell/AppShell';
import { RefetchOnFocusMount } from '@/features/shell/RefetchOnFocusMount';
export const dynamic = 'force-dynamic';
interface PageProps { params: Promise<{ id: string }> }
function decodeUsername(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  try {
    const payload = token.split('.')[1];
    if (payload === undefined) return undefined;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { preferred_username?: string; sub?: string };
    return claims.preferred_username ?? claims.sub;
  } catch {
    return undefined;
  }
}
async function bffBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3001';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return proto + '://' + host;
}
export default async function OrderReviewPage({ params }: PageProps): Promise<JSX.Element> {
  const { id: idOrRef } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('fleet_session');
  const username = decodeUsername(sessionCookie?.value);
  const base = await bffBaseUrl();
  const fetchHeaders = sessionCookie?.value !== undefined
    ? { cookie: 'fleet_session=' + sessionCookie.value }
    : {};
  const res = await fetch(base + '/api/transport-orders/' + encodeURIComponent(idOrRef), {
    headers: fetchHeaders,
    cache: 'no-store',
  });
  if (res.status === 404) notFound();
  // Idle-expired session: the RSC forwarded no/expired fleet_session and the
  // BFF answered 401. redirect() to the silent-refresh route (loadDispatchBoard
  // house pattern) -- a TOP-LEVEL navigation lets the rotated cookie pair ride
  // back to the browser legitimately; minting inside this internal fetch would
  // strand the pair and trip RFC 9700 refresh-token reuse detection.
  if (res.status === 401) redirect(sessionRefreshUrl('/dispatch/orders/' + idOrRef));
  if (!res.ok) throw new Error('Failed to load order: ' + String(res.status));
  // Trust boundary: validate the untrusted BFF response against the shared
  // contract instead of casting. Throws a descriptive ZodError on drift.
  const order = ListAssignedRowSchema.parse(await res.json());
  return (
    <AppShell {...(username !== undefined ? { username } : {})}>
      {/* Refetch-on-focus: this RSC fetches the order server-side and cannot use
          hooks, so a client mount re-runs router.refresh() on visible/focus to
          re-fetch the order (e.g. its state badge after an external cancel)
          without a manual reload. */}
      <RefetchOnFocusMount />
      <div className='mx-auto w-full max-w-5xl p-6'>
        <Link
          href='/'
          data-testid='order-review-back'
          className='mb-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline'
        >
          <span aria-hidden='true'>&larr;</span>
          Quay lại bảng điều phối
        </Link>
        <OrderReview order={order} />
        <CancelOrderForm transportOrderId={order.transportOrderId} state={order.state} />
      </div>
    </AppShell>
  );
}
