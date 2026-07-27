// e2e/review-back-navigation.spec.ts
// T6 acceptance: the order review view must provide an explicit in-page Back
// control that returns the dispatcher to the dispatch board (/), rather than
// forcing reliance on the browser's back button.
//
// Permanent business rule under test:
//   Critical user journey: every page provides UI navigation back to the
//   previous menu / between pages, skipping intermediate menus.
//   Business invariant: a best-UX navigation element is always present.
//
// Self-seeding (2026-Q2 no-leak contract): like the T5 nav spec, this spec
// creates its own driver+vehicle+assignment+order via the API and polls the
// dispatch_board_projection so it never depends on shared board state that
// the global-teardown wipes. afterAll cleans up the seeded rows.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';
import { waitForBoardReady } from './helpers/create-order';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
interface Seeded {
  driverId: string; operatorId: string; vehicleId: string;
  assignmentId: string; transportOrderId: string; externalRef: string; token: string;
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
  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: 'E2E DRIVER T6-BACK ' + String(ts), phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: 'E2E-T6-BACK-' + String(ts) }, ReferenceItemSchema);
  const asgn = await adminPost(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  const order = await adminPost(
    api, token, '/transport-orders',
    { stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id } },
    CreateTransportOrderResponseSchema,
  );
  return { driverId: drv.driverId, operatorId: drv.operatorId, vehicleId: veh.id, assignmentId: asgn.assignmentId, transportOrderId: order.transportOrderId, externalRef: order.externalRef, token };
}
function cleanupSeeded(seeded: Seeded): void {
  const sq = String.fromCharCode(39);
  const txId = seeded.transportOrderId;
  const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';')
    .stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
  try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
  for (const rrId of rrIds) { try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ } }
  try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq + ' AND payload->>' + sq + 'externalRef' + sq + '=' + sq + seeded.externalRef + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ' AND transport_order_refs @> ' + sq + '["' + seeded.externalRef + '"]' + sq + '::jsonb;'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + seeded.externalRef + sq + ';'); } catch { /* tolerate */ }
}
async function cleanupPair(api: APIRequestContext, seeded: Seeded): Promise<void> {
  try { await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + seeded.assignmentId, { headers: { Authorization: 'Bearer ' + seeded.token, 'Content-Type': 'application/json' }, data: JSON.stringify({ reason: 'e2e-cleanup' }) }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/reference/vehicles/' + seeded.vehicleId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/admin/drivers/' + seeded.driverId, { headers: { Authorization: 'Bearer ' + seeded.token } }); } catch { /* tolerate */ }
}
// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}
test.describe.serial('review view back navigation (T6)', () => {
  let seeded: Seeded | null = null;
  test.beforeAll(async ({ request }) => {
    test.setTimeout(60000);
    seeded = await seedOrder(request);
    const sq = String.fromCharCode(39);
    for (let i = 0; i < 40; i++) {
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
  test('review view shows a back control that links to the board', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await login(page);
    await page.goto('/');
    await waitForBoardReady(page);
    const rowLink = page.getByTestId('dispatch-board-row-' + seeded.externalRef).first();
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    await rowLink.click();
    await expect(page).toHaveURL(/\/dispatch\/orders\/.+/, { timeout: 10000 });
    const back = page.getByTestId('order-review-back');
    await expect(back, 'review view must render an explicit back control').toBeVisible();
    await expect(back).toHaveAttribute('href', '/');
  });
  test('clicking the back control returns to the dispatch board', async ({ page }) => {
    if (!seeded) throw new Error('seeded order missing');
    await login(page);
    await page.goto('/');
    await waitForBoardReady(page);
    const rowLink = page.getByTestId('dispatch-board-row-' + seeded.externalRef).first();
    await expect(rowLink).toBeVisible({ timeout: 10000 });
    await rowLink.click();
    await expect(page).toHaveURL(/\/dispatch\/orders\/.+/, { timeout: 10000 });
    await page.getByTestId('order-review-back').click();
    await expect(page).toHaveURL(/\/$|\/dispatch$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();
  });
});
