// apps/ops-web/src/features/dispatch/load-order-review.ts
// Server-only RSC loader for the dispatcher order-review page.
//
// ROOT CAUSE THIS CLOSES (2026-07-23). The review page previously fetched its
// OWN BFF route, building an absolute URL from the incoming host header:
//   const base = proto + '://' + h.get('host');
//   await fetch(base + '/api/transport-orders/' + id)
// Two things are wrong with that, one architectural and one operational.
//
// Architectural: it is the documented Next.js anti-pattern. A server component
// must fetch from the SOURCE rather than jump through its own route handler --
// the server otherwise fetches data from itself while pretending to be a
// separate server, which adds a hop, loses end-to-end types, and forces manual
// re-forwarding of cookies/headers. The Next.js team states this directly.
//
// Operational: it silently couples the render to the PUBLISHED host port.
// compose.yaml maps ${FLEET_PORT_OPS_WEB:-3001}:3001, so ops-web always LISTENS
// on 3001 inside the container. On the default stack the mapping is 3001:3001
// and the self-fetch coincidentally worked. On the isolated per-worktree stack
// the mapping is e.g. 25021:3001, so the host header said localhost:25021 and
// nothing listens on 25021 INSIDE the container: the fetch failed, the page
// threw, and the framework rendered the error boundary. Every browser request
// still returned 200, because the failing request was server-side and never
// appeared in a browser trace -- which is what made this so long-lived.
//
// The fix mirrors loadDispatchBoard, the sibling loader that already works on
// every stack: fetch FLEET_API_URL (the in-network service address, immune to
// published host ports) directly with the fleet_session bearer, then parse the
// response at the trust boundary against the SSOT ListAssignedRowSchema from
// @fleet/sync-protocol. No BFF hop, no host header, no port coupling.
//
// PRESERVED CONTRACT (T11 idle-timeout arc). Going direct must not weaken the
// session-expiry behaviour the BFF used to provide:
//   401 -> redirect() to the silent-refresh route with next=<this page>. A
//          TOP-LEVEL navigation is required so the rotated cookie pair can ride
//          back to the browser legitimately; forwarding fleet_refresh into this
//          internal fetch would strand the pair and trip RFC 9700 refresh-token
//          reuse detection.
//   404 -> notFound(), so unknown ids render the framework 404 like the API.
//   else -> descriptive throw carrying the status.
import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sessionRefreshUrl } from '@/features/auth/session-refresh-navigation';
import { ListAssignedRowSchema, type ListAssignedRow } from '@fleet/sync-protocol';

// Resolve one order for the dispatcher review page by transport_order UUID or
// human-readable external_ref (the API accepts either; the board links by ref).
export async function loadOrderReview(idOrRef: string): Promise<ListAssignedRow> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) {
    throw new Error('FLEET_API_URL must be set to load the order review');
  }
  const cookieStore = await cookies();
  const authToken = cookieStore.get('fleet_session')?.value;
  const res = await fetch(apiUrl + '/transport-orders/' + encodeURIComponent(idOrRef), {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + (authToken ?? '') },
  });
  if (res.status === 404) {
    notFound();
  }
  // Idle-expired session: a TOP-LEVEL navigation to the silent-refresh route so
  // the rotated cookie pair reaches the browser (see the note above).
  if (res.status === 401) {
    redirect(sessionRefreshUrl('/dispatch/orders/' + idOrRef));
  }
  if (!res.ok) {
    throw new Error('Failed to load order: ' + String(res.status));
  }
  const json = (await res.json()) as unknown;
  const parsed = ListAssignedRowSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Order review response shape invalid: ' + parsed.error.message);
  }
  return parsed.data;
}
