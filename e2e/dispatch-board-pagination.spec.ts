// e2e/dispatch-board-pagination.spec.ts
// L0 (Playwright E2E) RED-first acceptance for the Lệnh điều xe board
// pagination feature. Outside-in: this asserts the USER-VISIBLE contract
// before any source exists, so it MUST fail first (RED).
//
// Feature contract (2026 status-partitioned, pre-filtered-view pagination —
// the industry-standard Active/Finished tab model, with offset numbered pages
// + a jump-to-page search + a total count placed below the table):
//   - DEFAULT view shows ONLY active road runs (pending + in-progress ==
//     planned | dispatched | started). Finished (completed | cancelled) are
//     EXCLUDED from the default view.
//   - A status filter (Active default / Finished) switches to the finished
//     slice; finished rows appear there, active rows do not.
//   - A pagination control sits at the bottom: numbered pages, a jump-to-page
//     search input, and a total count.
//
// Self-seeding + self-cleaning + isolated per-test data via the repo's REAL
// API endpoints (2026 E2E best practice): create -> planned (active); finish
// via POST /transport-orders/:id/cancel, which cascades the linked road_run to
// 'cancelled' AND drains the dispatch_board projection synchronously before
// returning (deterministic, no eventual-consistency wait). Stable testid
// locators + Playwright auto-waits (no fixed timeouts).
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

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

// Seed one ACTIVE (planned) order with its own dedicated driver+vehicle pair.
async function seedActiveOrder(api: APIRequestContext, tag: string): Promise<SeededOrder> {
  const token = mintDispatcherToken();
  const ts = String(Date.now()) + Math.floor(Math.random() * 1000).toString();
  const phone = '09' + ts.slice(-8);
  const drv = await apiPost(api, token, '/admin/drivers', { fullName: 'E2E-PAGE-' + tag + '-' + ts, phone, password: 'e2e-pass-1234' }, CreateDriverResponseSchema); // pragma: allowlist secret
  const veh = await apiPost(api, token, '/reference/vehicles', { name: 'E2E-PAGE-' + tag + '-' + ts }, ReferenceItemSchema);
  await apiPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  const order = await apiPost(api, token, '/transport-orders', { stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id } }, CreateTransportOrderResponseSchema);
  return { externalRef: order.externalRef, transportOrderId: order.transportOrderId, vehicleId: veh.id, driverId: drv.driverId, operatorId: drv.operatorId };
}

// Move a seeded order's road run to FINISHED deterministically via the dispatcher
// cancel seam: POST /transport-orders/:id/cancel cascades every linked road_run
// to state 'cancelled' AND drains the dispatch_board projection SYNCHRONOUSLY
// before returning (see transport-orders.cancel.controller.ts). So on return the
// projection row already reads 'cancelled' (finished) -- no eventual-consistency
// wait. NOTE: vehicle soft-delete only cancels the ORDER, leaving road_run
// 'planned', so it must NOT be used to simulate a finished run.
async function finishViaCancel(api: APIRequestContext, o: SeededOrder): Promise<void> {
  const token = mintDispatcherToken();
  const res = await api.post(API_URL + '/transport-orders/' + o.transportOrderId + '/cancel', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify({ reason: 'customer_request' }),
  });
  if (!res.ok()) {
    throw new Error('cancel failed ' + String(res.status()) + ': ' + (await res.text()));
  }
}

const active: SeededOrder[] = [];
const finished: SeededOrder[] = [];

async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe('dispatch board pagination + active/finished partition (Lệnh điều xe)', () => {
  test.afterEach(async ({ request }) => {
    const token = mintDispatcherToken();
    for (const o of [...active, ...finished]) {
      await request.delete(API_URL + '/reference/vehicles/' + o.vehicleId, { headers: { Authorization: 'Bearer ' + token } }).catch(() => undefined);
    }
    active.length = 0;
    finished.length = 0;
  });

  test('default view = active only; finished behind Finished filter; bottom pagination has page-jump search + total count', async ({ page, request }) => {
    const a1 = await seedActiveOrder(request, 'A1'); active.push(a1);
    const a2 = await seedActiveOrder(request, 'A2'); active.push(a2);
    const a3 = await seedActiveOrder(request, 'A3'); active.push(a3);
    const f1 = await seedActiveOrder(request, 'F1'); finished.push(f1);
    await finishViaCancel(request, f1);

    await login(page);

    // (1) Bottom pagination control + jump-to-page search + total count exist.
    await expect(page.getByTestId('dispatch-board-pagination')).toBeVisible();
    await expect(page.getByTestId('dispatch-board-page-search')).toBeVisible();
    await expect(page.getByTestId('dispatch-board-total-count')).toBeVisible();

    // (2) Status filter exists (Active default / Finished).
    const activeTab = page.getByTestId('dispatch-board-filter-active');
    const finishedTab = page.getByTestId('dispatch-board-filter-finished');
    await expect(activeTab).toBeVisible();
    await expect(finishedTab).toBeVisible();

    // (3) Default (Active) view: active rows visible, finished row hidden.
    await expect(page.getByTestId('dispatch-board-row-' + a1.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + a2.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + a3.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + f1.externalRef)).toHaveCount(0);

    // (4) Switch to Finished: cancelled row shows; an active row does not.
    await finishedTab.click();
    await expect(page.getByTestId('dispatch-board-row-' + f1.externalRef)).toBeVisible();
    await expect(page.getByTestId('dispatch-board-row-' + a1.externalRef)).toHaveCount(0);
  });
});
