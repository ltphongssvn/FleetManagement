// apps/ops-web/src/app/dispatch/orders/[id]/page.tsx
// Dispatcher review page: server component fetches the order via the BFF
// (which forwards to the API with the fleet_session bearer token) and hands
// it to the OrderReview presentational component. notFound() is called on
// any non-2xx so unknown ids render the framework 404, matching the API.
//
// T5 (2026):
//   * Composes the CancelOrderForm client component below the review pane.
//     The form decides for itself whether to render the open button based
//     on the order's current state; non-cancellable states make the form
//     invisible.
//   * The :id URL param can be either a transport_order UUID or the human-
//     readable XT.NNNN external_ref. The API review endpoint now accepts
//     either form (company-scoped findByCompanyIdOrRef under the hood) so
//     the page hands the param through unchanged. The dispatch board links
//     rows by external_ref; direct UUID links continue to work.
import type { JSX } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { OrderReview } from '@/features/dispatch/OrderReview';
import { CancelOrderForm } from '@/features/dispatch/CancelOrderForm';
import { AppShell } from '@/features/shell/AppShell';
import type { ListAssignedRow } from '@/features/dispatch/types';
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
  if (!res.ok) throw new Error('Failed to load order: ' + String(res.status));
  const order = await res.json() as ListAssignedRow;
  return (
    <AppShell {...(username !== undefined ? { username } : {})}>
      <div className='mx-auto w-full max-w-5xl p-6'>
        <OrderReview order={order} />
        <CancelOrderForm transportOrderId={order.transportOrderId} state={order.state} />
      </div>
    </AppShell>
  );
}
