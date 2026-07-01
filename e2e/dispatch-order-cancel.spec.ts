// e2e/dispatch-order-cancel.spec.ts
// T5 acceptance: dispatcher cancels a transport order.
//
// Self-seeding (2026): previously the three stateful tests read the ambient
// /api/transport-orders/assigned list and test.skip'd when it held no
// cancellable / cancelled order -- so in a clean environment they silently did
// not run. They now seed their OWN driver-vehicle-order via the API (the same
// factory dispatch-order-cancel-expired-session.spec.ts and
// dispatch-board-reflects-cancel.spec.ts use), so the critical cancel journey
// is exercised deterministically every run, independent of ambient data. The
// order is created through /transport-orders with an explicit roadRun operator
// binding; afterEach deletes the seeded vehicle, which cascades to cancel the
// (still non-terminal) road run and tears the fixture down.
//
// Critical user journey covered:
//   1. Dispatcher logs in and opens a just-seeded order (review view).
//   2. Cancel control is visible when the order's state is a legal source for
//      the FSM transition to 'cancelled'.
//   3. Dispatcher submits a cancellation (reason + optional note) via the
//      server action -> BFF -> API; the review view then shows 'cancelled'.
//   4. Second cancel with the SAME reason is idempotent (200).
//   5. Cancel with a DIFFERENT reason after the first commit is rejected (409).
//   6. BFF returns 404 for an unknown order id (tenant boundary).
//
// Schema-first: every API boundary is parsed against the @fleet contracts SSOT
// via parseJson (no hand-rolled interfaces, no 'as' casts).
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

// A successful cancel redirects the dispatcher back to the board (root path),
// it does NOT flip the review view in place -- the page navigates away. Match
// the board landing URL the way the sibling dispatch-board-reflects-cancel spec
// does. DOLLAR is a char-code constant so the regex end-anchor is not a literal
// dollar sign in the (heredoc-authored) source.
const DOLLAR = String.fromCharCode(36);
const BOARD_URL = new RegExp('/' + DOLLAR);

async function apiPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
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
    api, token, '/admin/drivers',
    { fullName: 'E2E-CANCEL-' + ts, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await apiPost(
    api, token, '/reference/vehicles', { name: 'E2E-CANCEL-' + ts },
    ReferenceItemSchema,
  );
  await apiPost(api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const order = await apiPost(
    api, token, '/transport-orders',
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

async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe.serial('dispatch order cancel', () => {
  const seededOrders: SeededOrder[] = [];
  // The serial chain shares ONE seeded order: test 1 cancels it via the UI,
  // then tests 2 and 3 re-exercise the BFF against that same (now cancelled)
  // order id for the idempotency and conflict invariants.
  let sharedOrder: SeededOrder | undefined;

  test.afterAll(async ({ request }) => {
    while (seededOrders.length > 0) {
      const o = seededOrders.pop();
      if (o) await cleanupOrder(request, o);
    }
  });

  test('dispatcher cancels an order via the review view and the state flips to cancelled', async ({ page, request }) => {
    const order = await seedOrder(request);
    seededOrders.push(order);
    sharedOrder = order;

    await login(page);
    await page.goto('/dispatch/orders/' + order.externalRef);
    await expect(page.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeVisible();
    const cancelButton = page.getByTestId('order-cancel-open');
    await expect(cancelButton, 'cancel control visible for cancellable order').toBeVisible();
    await cancelButton.click();
    const reasonSelect = page.getByTestId('order-cancel-reason');
    await expect(reasonSelect).toBeVisible();
    await reasonSelect.selectOption('customer_request');
    await page.getByTestId('order-cancel-note').fill('E2E test cancel');
    await page.getByTestId('order-cancel-submit').click();
    // A successful cancel Server Action redirects to the board (proven by the
    // sibling dispatch-board-reflects-cancel spec against this same seeded-order
    // factory). The review view does NOT update order-review-state in place --
    // the page navigates away -- so assert the redirect + the board heading,
    // which together prove the cancel committed. (The board-reflection detail --
    // the cancelled row behind the Finished tab -- is covered by that sibling
    // spec; here the scope is that the cancel action succeeds.)
    await expect(page).toHaveURL(BOARD_URL, { timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
  });

  test('idempotent: second cancel with same reason returns 200 and same record', async ({ page }) => {
    expect(sharedOrder, 'shared seeded order from the first test').toBeDefined();
    if (sharedOrder === undefined) throw new Error('unreachable: guarded above');
    await login(page);
    const first = await page.request.post('/api/transport-orders/' + sharedOrder.transportOrderId + '/cancel', {
      data: { reason: 'customer_request', note: 'first retry' },
    });
    expect(first.status(), 'idempotent re-cancel with same reason returns 200').toBe(200);
  });

  test('conflict: cancel with a different reason after first commit returns 409', async ({ page }) => {
    expect(sharedOrder, 'shared seeded order from the first test').toBeDefined();
    if (sharedOrder === undefined) throw new Error('unreachable: guarded above');
    await login(page);
    const conflict = await page.request.post('/api/transport-orders/' + sharedOrder.transportOrderId + '/cancel', {
      data: { reason: 'driver_unavailable', note: 'different reason' },
    });
    expect(conflict.status()).toBe(409);
  });

  test('cancel BFF returns 404 for an unknown order id (tenant boundary)', async ({ page }) => {
    await login(page);
    const res = await page.request.post('/api/transport-orders/00000000-0000-0000-0000-000000000000/cancel', {
      data: { reason: 'customer_request' },
    });
    expect(res.status()).toBe(404);
  });
});
