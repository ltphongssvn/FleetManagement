// e2e/dispatch-board-row-navigation.spec.ts
// T5 acceptance: dispatcher reaches the order review (and the cancel
// form) by clicking a row on the dispatch board, not by direct URL.
// This closes the production UI gap that the original cancel spec
// missed: in the PDF the row was a plain text cell with no link, so
// the dispatcher had no way to navigate into the review/cancel view.
//
// The flow under test:
//   1. Dispatcher logs in -> /dispatch board renders 'Lệnh điều xe'.
//   2. The Số lệnh cell for at least one row is a Next.js Link with
//      href=/dispatch/orders/{externalRef}.
//   3. Clicking the link navigates to the review page; the review
//      heading and the CancelOrderForm container are visible.
//   4. The review page accepts the human-readable external_ref (not
//      a UUID) thanks to the page-level resolver.
//
// Isolation (2026-Q2): this spec seeds its own driver+vehicle+order
// via API so it does not depend on shared board state. Parallel
// workers cleaning up their orders cannot empty the board for this
// spec. afterAll cleans up the seeded order + projection rows.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';


interface Seeded {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string;
  assignmentId: string;
  transportOrderId: string;
  externalRef: string;
  token: string;
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

async function seedOrder(api: APIRequestContext): Promise<Seeded> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER T5-NAV ' + String(ts);
  const vehicleLabel = 'E2E-T5-NAV-' + String(ts);
  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  const asgn = await adminPost(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const order = await adminPost(
    api, token, '/transport-orders',
    {
      stops: [{ sequence: 1, stopType: 'pickup' }],
      roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
    },
    CreateTransportOrderResponseSchema,
  );
  return {
    driverId: drv.driverId,
    operatorId: drv.operatorId,
    vehicleId: veh.id,
    vehicleLabel,
    driverLabel,
    assignmentId: asgn.assignmentId,
    transportOrderId: order.transportOrderId,
    externalRef: order.externalRef,
    token,
  };
}

function cleanupSeeded(seeded: Seeded): void {
  const sq = String.fromCharCode(39);
  const txId = seeded.transportOrderId;
  const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';')
    .stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
  try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
  for (const rrId of rrIds) {
    try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
  }
  try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq + ' AND payload->>' + sq + 'externalRef' + sq + '=' + sq + seeded.externalRef + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ' AND transport_order_refs @> ' + sq + '["' + seeded.externalRef + '"]' + sq + '::jsonb;'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + seeded.externalRef + sq + ';'); } catch { /* tolerate */ }
}

async function cleanupPair(api: APIRequestContext, seeded: Seeded): Promise<void> {
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + seeded.assignmentId, {
      headers: { Authorization: 'Bearer ' + seeded.token, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/reference/vehicles/' + seeded.vehicleId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/admin/drivers/' + seeded.driverId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
}

// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}

test.describe.serial('dispatch board row navigation (T5)', () => {
  let seeded: Seeded | null = null;

  test.beforeAll(async ({ request }) => {
    seeded = await seedOrder(request);
    // Poll the dispatch_board_projection until the seeded order's row exists,
    // so the first test isn't racing the outbox processor.
    const sq = String.fromCharCode(39);
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql('SELECT 1 FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ' AND transport_order_refs @> ' + sq + '["' + seeded.externalRef + '"]' + sq + '::jsonb LIMIT 1;');
      if (r.stdout.trim() === '1') break;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  });

  test.afterAll(async ({ request }) => {
    if (!seeded) return;
    cleanupSeeded(seeded);
    await cleanupPair(request, seeded);
  });

  test('the Số lệnh cell links to /dispatch/orders/{externalRef} for at least one row', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await login(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
    // Target THIS spec's own seeded row, not any random row that a parallel
    // worker may have just cleaned up between locator resolution and click.
    const rowLink = page.getByTestId('dispatch-board-row-' + seeded.externalRef).first();
    await expect(rowLink, 'seeded dispatch board row must be visible').toBeVisible({ timeout: 10000 });
    const href = await rowLink.getAttribute('href');
    expect(href).toBe('/dispatch/orders/' + seeded.externalRef);
  });

  test('clicking the row opens the review page with the cancel form composed below', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await login(page);
    await page.goto('/');
    await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });
    const rowLink = page.getByTestId('dispatch-board-row-' + seeded.externalRef).first();
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    await rowLink.click();
    await expect(page).toHaveURL(/\/dispatch\/orders\/.+/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /chi tiết|order review|đơn vận chuyển/i })).toBeVisible();
    const stateEl = page.getByTestId('order-review-state');
    await expect(stateEl).toBeVisible();
    const state = (await stateEl.textContent())?.trim() ?? '';
    if (state === 'cancelled' || state === 'completed') {
      await expect(page.getByTestId('order-cancel-open')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('order-cancel-open')).toBeVisible();
    }
  });
});
