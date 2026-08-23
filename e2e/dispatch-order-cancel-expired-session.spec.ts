// e2e/dispatch-order-cancel-expired-session.spec.ts
// Hotfix (2026) regression: clicking Cancel (Hủy đơn) after the fleet_session
// has expired must take the dispatcher cleanly to /login, NEVER the route error
// boundary ("Something went wrong" / "An unexpected response was received from
// the server").
//
// Root cause (proven live via curl against xe.vominhchau.com — HTTP 404,
// x-nextjs-action-not-found:1, x-middleware-rewrite:/login, body "Server action
// not found."): a Cancel click is a Server Action POST fired against
// /dispatch/orders/:id, carrying the Next-Action header. The auth proxy matched
// that protected route and, with no session, REWROTE the request to /login.
// Next.js cannot forward a rewrite/redirect for a Server Action, so the action
// client received the /login payload instead of an action result and threw.
// Fix: the proxy passes Next-Action requests through; the action authenticates
// itself and redirect('/login') on a missing/expired session.
//
// Self-seeding (mirrors dispatch-board-reflects-cancel.spec.ts): the assigned
// list can be empty in a given DB state, which would skip this proof. So each run
// seeds its OWN driver-vehicle-order via the API (parallel-safe, immune to
// sibling cascades), drives the UI cancel against THAT order with the session
// dropped mid-form, then asserts the graceful /login outcome. Cleanup soft-
// deletes the seeded vehicle, which cascades to cancel the (still non-terminal)
// order. All API payloads are validated at the boundary against the
// @fleet/sync-protocol / contracts SSOT via parseJson (schema-first, no casts).
import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { type z } from 'zod';
import {
  parseJson,
  CreateDriverResponseSchema,
  ReferenceItemSchema,
  AssignmentResponseSchema,
  CreateTransportOrderResponseSchema,
} from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

async function apiPost<T>(
  api: APIRequestContext,
  token: string,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok())
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

interface SeededOrder {
  externalRef: string;
  transportOrderId: string;
  vehicleId: string;
  driverId: string;
  operatorId: string;
}

async function seedOrder(api: APIRequestContext): Promise<SeededOrder> {
  const token = mintDispatcherToken();
  const ts = String(Date.now());
  const phone = '09' + ts.slice(-8);
  const drv = await apiPost(
    api,
    token,
    '/admin/drivers',
    { fullName: 'E2E-EXPSESS-' + ts, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await apiPost(
    api,
    token,
    '/reference/vehicles',
    { name: 'E2E-EXPSESS-' + ts },
    ReferenceItemSchema,
  );
  await apiPost(
    api,
    token,
    '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const order = await apiPost(
    api,
    token,
    '/transport-orders',
    {
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
    },
    CreateTransportOrderResponseSchema,
  );
  return {
    externalRef: order.externalRef,
    transportOrderId: order.transportOrderId,
    vehicleId: veh.id,
    driverId: drv.driverId,
    operatorId: drv.operatorId,
  };
}

async function cleanupOrder(api: APIRequestContext, o: SeededOrder): Promise<void> {
  const token = mintDispatcherToken();
  await api.delete(API_URL + '/reference/vehicles/' + o.vehicleId, {
    headers: { Authorization: 'Bearer ' + token },
  });
}

const seededOrders: SeededOrder[] = [];

test.describe('dispatch order cancel — expired session', () => {
  test.afterEach(async ({ request }) => {
    while (seededOrders.length > 0) {
      const o = seededOrders.pop();
      if (o) await cleanupOrder(request, o);
    }
  });
  test('expired session at submit goes to /login, not the crash boundary', async ({
    page,
    request,
  }) => {
    const order = await seedOrder(request);
    seededOrders.push(order);

    await loginAs(page);
    await page.goto('/dispatch/orders/' + order.externalRef);
    await expect(page.getByTestId('order-cancel-open')).toBeVisible();
    await page.getByTestId('order-cancel-open').click();
    await page.getByTestId('order-cancel-reason').selectOption('customer_request');

    // Simulate the session expiring while the form was open: drop the auth cookie
    // so the Cancel Server Action POST is sent unauthenticated.
    await page.context().clearCookies();
    await page.getByTestId('order-cancel-submit').click();

    // Fix: a clean redirect to /login to re-authenticate...
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    // ...and never the opaque crash boundary.
    await expect(page.getByText('An unexpected response was received from the server')).toHaveCount(
      0,
    );
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});
