// apps/ops-web/src/app/dispatch/orders/[id]/page.tsx
// Dispatcher review page: server component loads the order via the server-only
// loadOrderReview loader (which calls the API directly at FLEET_API_URL and
// parses the response against the SSOT ListAssignedRowSchema) and hands it to
// the OrderReview presentational component. notFound() is raised by the loader
// on a 404 so unknown ids render the framework 404, matching the API.
//
// 2026-07-23 root fix: this page used to fetch its OWN BFF route, building the
// absolute URL from the incoming host header. That is the documented Next.js
// anti-pattern (a server component should fetch from the source, not jump
// through its own route handler) and it silently coupled the render to the
// PUBLISHED host port: ops-web always listens on 3001 in-container, so on a
// stack that publishes 25021:3001 the self-fetch targeted a port nothing was
// listening on, threw, and rendered the error boundary -- while every browser
// request still showed 200, because the failing fetch was server-side. The
// loader mirrors loadDispatchBoard, which never had this defect.
//
// P0-#2 (2026): the API response is PARSED at this trust boundary via
// ListAssignedRowSchema (the @fleet/sync-protocol SSOT) instead of being cast
// with 'as ListAssignedRow'. A server response that drifts from the contract
// throws a descriptive error at the boundary rather than silently surfacing as
// undefined deep in the UI. That parse now lives in the loader.
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
import { cookies } from 'next/headers';
import { OrderReview } from '@/features/dispatch/OrderReview';
import { CancelOrderForm } from '@/features/dispatch/CancelOrderForm';
import { loadOrderReview } from '@/features/dispatch/load-order-review';
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
export default async function OrderReviewPage({ params }: PageProps): Promise<JSX.Element> {
  const { id: idOrRef } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('fleet_session');
  const username = decodeUsername(sessionCookie?.value);
  const order = await loadOrderReview(idOrRef);
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
        <CancelOrderForm transportOrderId={order.transportOrderId} state={order.state} canCancel={order.canCancel} cancelBlockedReason={order.cancelBlockedReason} />
      </div>
    </AppShell>
  );
}
