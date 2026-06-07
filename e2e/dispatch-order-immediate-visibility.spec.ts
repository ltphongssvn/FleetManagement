// e2e/dispatch-order-immediate-visibility.spec.ts
// T3 (2026-Q2) acceptance: when the dispatcher clicks 'Tạo lệnh' and the
// success banner appears, the new row MUST be visible in the Lệnh điều xe
// table without any manual browser refresh.
//
// Business invariant (critical user journey):
//   created record displayed immediately in Lệnh điều xe table (no F5)
//
// Root cause this spec pins down: /dispatch/board reads from the
// dispatch_board_projection, which is populated asynchronously by the
// projection-runner draining the outbox. Default drain cadence is 5s,
// so a client-side router.refresh() right after the action returns may
// see an empty projection and re-render an empty board. The fix nudges
// the projection runner to drain inline during POST /transport-orders,
// so by the time the action resolves the projection row already exists.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'pw';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

// Hard ceiling between 'created' banner appearing and the row being visible
// in the board. 1s is well below what a user would notice as a 'stale page'
// problem (the threshold beyond which dispatchers reach for F5).
// 500ms — sub-perceptual threshold. This is achievable only with optimistic
// UI rendering (industry-standard 2026 pattern for CQRS read-model lag).
// Renders the just-created row from local client state immediately when
// the server action returns status='created'; the eventually-consistent
// dispatch_board projection reconciles in the background via router.refresh.
const ROW_VISIBILITY_BUDGET_MS = 500;

function mintDispatcherToken(): string {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (!out.includes('.')) throw new Error('Token mint failed: ' + out);
  return out.trim();
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}

interface Pair {
  driverId: string; operatorId: string; vehicleId: string;
  vehicleLabel: string; driverLabel: string; assignmentId: string;
  token: string;
}

async function seedPair(api: APIRequestContext): Promise<Pair> {
  const token = mintDispatcherToken();
  // Add a random suffix so parallel workers (and --repeat-each) never collide
  // on the (company_id, full_name) unique constraint.
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  const phone = '09' + String(ts).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const driverLabel = 'E2E DRIVER T3-VIZ ' + String(ts) + '-' + rand;
  const vehicleLabel = 'E2E-T3-VIZ-' + String(ts) + '-' + rand;
  const drv = await adminPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await adminPost<{ id: string; label: string }>(api, token, '/reference/vehicles', { name: vehicleLabel });
  const asgn = await adminPost<{ assignmentId: string }>(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
  );
  return {
    driverId: drv.driverId, operatorId: drv.operatorId, vehicleId: veh.id,
    vehicleLabel, driverLabel, assignmentId: asgn.assignmentId, token,
  };
}

async function cleanupPair(api: APIRequestContext, p: Pair): Promise<void> {
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + p.assignmentId, {
      headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/reference/vehicles/' + p.vehicleId, { headers: { Authorization: 'Bearer ' + p.token } }); } catch { /* tolerate */ }
  try { await api.delete(API_URL + '/admin/drivers/' + p.driverId, { headers: { Authorization: 'Bearer ' + p.token } }); } catch { /* tolerate */ }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
  await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dispatch|\/$/, { timeout: 10_000 });
}

test.describe('created order immediate visibility on dispatch board (T3)', () => {
  let pair: Pair | null = null;
  const seededOrderRefs: string[] = [];

  test.beforeAll(async ({ request }) => { pair = await seedPair(request); });

  test.afterEach(() => {
    const sq = String.fromCharCode(39);
    while (seededOrderRefs.length > 0) {
      const ref = seededOrderRefs.pop();
      if (!ref) continue;
      const txId = dockerPsql('SELECT transport_order_id FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + ref + sq + ';').stdout.trim();
      if (txId.length > 0) {
        const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';').stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
        try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        for (const rrId of rrIds) {
          try { dockerPsql('DELETE FROM dispatch_board_projection WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
          try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
        }
      }
      try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq + ' AND payload::text LIKE ' + sq + '%' + ref + '%' + sq + ';'); } catch { /* tolerate */ }
      try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + ref + sq + ';'); } catch { /* tolerate */ }
    }
  });

  test.afterAll(async ({ request }) => { if (pair) await cleanupPair(request, pair); });

  test('new row appears in Lệnh điều xe within 1000ms of the success banner, no manual refresh', async ({ page }) => {
    if (!pair) throw new Error('pair not seeded');
    await login(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Lệnh điều xe' })).toBeVisible();

    const now = new Date(Date.now() + 60 * 60 * 1000);
    const localIso = now.toISOString().slice(0, 16);
    await page.locator('#plannedStartAt').fill(localIso);
    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill(pair.vehicleLabel);
    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await page.locator('#pickupAt').fill(localIso);
    await page.locator('#deliveryAt').fill(localIso);
    await page.locator('input#pickupWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.locator('input#deliveryWarehouse_1').click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: 'Tạo lệnh' }).click();
    const banner = page.getByRole('status').filter({ hasText: /XTT\./ });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const bannerText = (await banner.textContent()) ?? '';
    const m = /XTT\.[0-9]+-[0-9]+/.exec(bannerText);
    if (!m) throw new Error('Banner did not contain an XTT external_ref: ' + bannerText);
    const externalRef = m[0];
    seededOrderRefs.push(externalRef);

    const t0 = Date.now();
    const row = page.getByTestId('dispatch-board-row-' + externalRef).first();
    await expect(row, 'new row must appear without manual refresh').toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThanOrEqual(ROW_VISIBILITY_BUDGET_MS);
  });
});
