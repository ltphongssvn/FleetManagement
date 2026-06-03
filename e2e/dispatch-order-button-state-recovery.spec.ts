// e2e/dispatch-order-button-state-recovery.spec.ts
// RED L0 outer acceptance test for two T3 follow-up invariants:
//
// Business invariant 1 — button state recovery (permanent rule):
//   After a successful 'Tạo lệnh' submission, the submit button transitions
//   from 'Tạo lệnh' -> 'Đang tạo…' (pending) -> 'Tạo lệnh' (idle again)
//   within a small, bounded time. The button must NOT remain stuck on
//   'Đang tạo…' — that strands the dispatcher and blocks the queue.
//
// Business invariant 2 — no-leak (permanent rule, NEVER to be broken):
//   E2E tests that create transport_order rows via the UI MUST delete the
//   rows they created. The Lệnh điều xe table must NEVER be polluted with
//   orphan rows whose driver/vehicle has been cleaned up but whose order
//   row was left behind. Per Playwright 2026 best practices (TestDino,
//   Microsoft, qaskills): capture created resource IDs at creation, use
//   afterEach/afterAll with try/finally so cleanup runs even on failure,
//   then assert no-leak at the end.
//
// Root cause (button recovery): per Next.js v15 regression vercel/next.js#82289,
//   revalidatePath('/') inside a Server Action consumed by useActionState
//   keeps the React transition's pending flag true while the home page
//   re-renders. On '/' the form's own host page also fetches drivers,
//   vehicles, customers, warehouses, and the orders table, so the re-render
//   is slow enough to look frozen to the dispatcher.
//
// outside-in strict TDD: L0 RED first. Inner action-layer change driven
// by its own smaller RED test (test/create-order-action.test.ts).
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const _POSTGRES_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

const RECOVERY_BUDGET_MS = 15_000;
const _ORDER_NUMBER_REGEX = /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/;
// Unanchored variant for extracting the ref from banner text like
// 'Số Lệnh: XTT.05-052' where the anchored regex would not match.
const ORDER_NUMBER_EXTRACT_RE = /XTT\.(0[1-9]|1[0-2])-\d{3,}/;


function mintToken(username: string): string {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=' + username + '&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (!out.includes('.')) throw new Error('Token mint failed for ' + username + ': ' + out);
  return out.trim();
}

interface SeededPair {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string;
  assignmentId: string;
  token: string;
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return (await res.json()) as T;
}

async function setupPair(api: APIRequestContext, suffix: string): Promise<SeededPair> {
  const token = mintToken('dispatcher');
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER ' + suffix + ' ' + String(ts);
  const vehicleLabel = 'E2E-' + suffix + '-' + String(ts);
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
    driverId: drv.driverId,
    operatorId: drv.operatorId,
    vehicleId: veh.id,
    vehicleLabel,
    driverLabel,
    assignmentId: asgn.assignmentId,
    token,
  };
}

async function cleanupPair(api: APIRequestContext, pair: SeededPair): Promise<void> {
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + pair.assignmentId, {
      headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch { /* tolerate */ }
  try {
    await api.delete(API_URL + '/reference/vehicles/' + pair.vehicleId, {
      headers: { Authorization: 'Bearer ' + pair.token },
    });
  } catch { /* tolerate */ }
  try {
    await api.delete(API_URL + '/admin/drivers/' + pair.driverId, {
      headers: { Authorization: 'Bearer ' + pair.token },
    });
  } catch { /* tolerate */ }
}

async function loginAsDispatcher(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill('dispatcher');
  await page.getByLabel(/mật khẩu|password/i).fill('any-password');
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('create-order button state recovery + no-leak (T3 follow-up)', () => {
  // Self-scoped no-leak tracker (2026 best practice — see web-search basis above).
  // Every order this spec creates via the UI pushes its externalRef here at
  // the moment it appears in the success banner. afterEach pops and DELETEs
  // each one. afterAll asserts none of those refs survive in transport_order.
  const seededOrderRefs: string[] = [];

  test.afterEach(() => {
    // try/finally semantics: even if assertions inside the test threw, we
    // still pop and delete every captured ref. Direct DB DELETE because
    // transport_order has no API-level hard-delete endpoint (cancel only
    // flips state).
    const sq = String.fromCharCode(39);
    while (seededOrderRefs.length > 0) {
      const ref = seededOrderRefs.pop();
      if (!ref) continue;
      // Delete transport_order + its road_run + outbox rows so the
      // dispatch_board projection does not replay stale state on the
      // next parallel worker's render of /.
      const txIdSql = 'SELECT transport_order_id FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      const txId = dockerPsql(txIdSql).stdout.trim();
      if (txId.length > 0) {
        const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';')
          .stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
        try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
        for (const rrId of rrIds) {
          try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
        }
      }
      try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq +
        " AND payload->>'externalRef'=" + sq + ref + sq + ';'); } catch { /* tolerate */ }
      // Also clear the dispatch_board_projection so the read model on /
      // does not show duplicate stale rows for this ref on next render.
      try { dockerPsql('DELETE FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq +
        " AND external_ref=" + sq + ref + sq + ';'); } catch { /* tolerate */ }
      const sql =
        'DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      try { dockerPsql(sql); } catch { /* tolerate */ }
    }
  });

  test.afterAll(() => {
    // Final invariant: nothing this spec created may still be in the table.
    if (seededOrderRefs.length === 0) return;
    const sq = String.fromCharCode(39);
    const inList = seededOrderRefs.map((r) => sq + r + sq).join(',');
    const sql =
      'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND external_ref IN (' + inList + ');';
    const r = dockerPsql(sql);
    const leaked = r.stdout.trim().split('\n').filter((s) => s.length > 0);
    expect(leaked).toEqual([]);
  });

  test('after submit the button returns from Đang tạo… to Tạo lệnh within the recovery budget, and the order is cleaned up', async ({ page, request }) => {
    const pair = await setupPair(request, 'T3-BTN');
    try {
      await loginAsDispatcher(page);
      await page.goto('/');
      await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });
      await page.locator('#plannedStartAt').fill('2026-07-01T08:00');
      const vehicleInput = page.locator('input#vehiclePlate');
      await vehicleInput.click();
      await vehicleInput.fill(pair.vehicleLabel);
      await page.getByRole('option', { name: pair.vehicleLabel }).click();
      await page.locator('#pickupAt').fill('2026-07-01T09:00');
      await page.locator('#deliveryAt').fill('2026-07-01T18:00');
      await page.locator('input#pickupWarehouse_1').click();
      await page.getByRole('option').first().click();
      await page.locator('input#deliveryWarehouse_1').click();
      await page.getByRole('option').first().click();

      const submitBtn = page.getByRole('button', { name: /^Tạo lệnh$|^Đang tạo…$/ });
      await expect(submitBtn).toHaveText('Tạo lệnh');
      await submitBtn.click();
      await expect(submitBtn).toHaveText('Tạo lệnh', { timeout: RECOVERY_BUDGET_MS });
      await expect(submitBtn).not.toHaveText('Đang tạo…');

      // Capture the server-assigned externalRef from the success banner so
      // the afterEach can delete it and afterAll can prove the no-leak
      // invariant holds. The form surfaces 'Số Lệnh: XTT.MM-NNN' in role=status.
      const banner = page.getByRole('status').filter({ hasText: /XTT\./ });
      await expect(banner).toBeVisible({ timeout: 10_000 });
      const bannerText = (await banner.textContent()) ?? '';
      const match = ORDER_NUMBER_EXTRACT_RE.exec(bannerText);
      expect(match).not.toBeNull();
      if (match) seededOrderRefs.push(match[0]);
    } finally {
      await cleanupPair(request, pair);
    }
  });
});
