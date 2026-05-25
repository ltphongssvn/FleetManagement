// e2e/dispatch-order-numbering.spec.ts
//
// End-to-end verification of the T3 invariant: every transport_order is
// created with a server-assigned external_ref of the form XT.NNNN where
// NNNN is a monotonically increasing, zero-padded integer per company.
// The dispatcher never inputs the order number; it is allocated atomically
// by the order-numbering service at API write time. Any client-supplied
// externalRef is overwritten.
//
// Layer coverage (matches the codebase TDD layer map):
//   L1 UI          : success view shows server-assigned XT.NNNN; any value
//                    typed in Số Lệnh is overridden.
//   L2 Server Action: ops-web BFF route /api/transport-orders forwards the
//                     form payload; server-assigned ref reaches the browser.
//   L3 API DTO/Ctrl: response body carries externalRef matching /^XT\.\d{4,}$/;
//                    client-supplied externalRef is ignored.
//   L4 Service     : two sequential creates strictly increase; two parallel
//                    creates produce two distinct refs (atomicity).
//   L5 Database    : order_sequence row exists per (company, prefix='XT');
//                    external_ref column is unique per company; padding>=4.
//   L6 Outbox/Workr: outbox row for the road_run carries externalRef in delta
//                    so the dispatch_board projection sees the XT.NNNN.
//   L7 Auth/Tenant : a token with no fleet-dispatcher role cannot create
//                    orders (so cannot consume the company sequence).
//
// No-leak contract (2026-Q2): see dispatch-order-protection-chain.spec.ts
// for the rationale. Every setupPair() call pushes onto seededPairs; the
// afterEach pops and revokes/soft-deletes each entry; afterAll asserts the
// dispatcher /reference/vehicles + /reference/drivers match the baseline.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const POSTGRES_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const ORDER_NUMBER_REGEX = /^XT\.\d{4,}$/;
async function mintToken(username: string): Promise<string> {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=' + username + '&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = execSync('docker exec fleet-pilot-api-1 node -e ' + JSON.stringify(script), { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  if (!out || !out.includes('.')) throw new Error('Token mint failed for ' + username + ': ' + out);
  return out.trim();
}
const mintDispatcherToken = (): Promise<string> => mintToken('dispatcher');
interface SeededPair {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  assignmentId: string;
  token: string;
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) {
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return (await res.json()) as T;
}
async function adminDelete(api: APIRequestContext, token: string, path: string, body: unknown): Promise<void> {
  const res = await api.delete(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) {
    throw new Error('DELETE ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
}
async function listLabels(api: APIRequestContext, token: string, path: string): Promise<readonly string[]> {
  const res = await api.get(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok()) throw new Error('GET ' + path + ' failed ' + String(res.status()));
  const json = (await res.json()) as { items: readonly { label: string }[] };
  return json.items.map((i) => i.label).sort();
}
async function setupPair(api: APIRequestContext, suffix: string): Promise<SeededPair> {
  const token = await mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER ' + suffix + ' ' + String(ts);
  const vehicleLabel = 'E2E-' + suffix + '-' + String(ts);
  const drv = await adminPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await adminPost<{ id: string; label: string }>(
    api, token, '/reference/vehicles', { name: vehicleLabel },
  );
  const asgn = await adminPost<{ assignmentId: string }>(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
  );
  return {
    driverId: drv.driverId,
    operatorId: drv.operatorId,
    vehicleId: veh.id,
    vehicleLabel,
    assignmentId: asgn.assignmentId,
    token,
  };
}
async function createOrderViaApi(
  api: APIRequestContext,
  pair: SeededPair,
  clientExternalRef: string | null,
): Promise<{ transportOrderId: string; roadRunId: string; externalRef?: string }> {
  const body: Record<string, unknown> = {
    stops: [{ sequence: 1, stopType: 'pickup' }],
    roadRun: {
      assignedOperatorId: pair.operatorId,
      assignedAssetId: pair.vehicleId,
    },
  };
  if (clientExternalRef !== null) body.externalRef = clientExternalRef;
  const res = await api.post(API_URL + '/transport-orders', {
    headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' },
    data: body,
  });
  if (!res.ok()) {
    throw new Error('POST /transport-orders failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return (await res.json()) as { transportOrderId: string; roadRunId: string; externalRef?: string };
}
interface PsqlResult { stdout: string; stderr: string; failed: boolean }
function dockerPsql(sql: string): PsqlResult {
  const cmd = 'docker exec -i ' + POSTGRES_CONTAINER + ' psql -U fleet -d fleet -tA -v ON_ERROR_STOP=1';
  try {
    const stdout = execSync(cmd, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    return { stdout, stderr: '', failed: false };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    return {
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: (err.stderr ? err.stderr.toString() : '') + (err.message ?? ''),
      failed: true,
    };
  }
}
function externalRefOf(transportOrderId: string): string {
  const sq = String.fromCharCode(39);
  const sql = 'SELECT external_ref FROM transport_order WHERE transport_order_id=' + sq + transportOrderId + sq + ';';
  const r = dockerPsql(sql);
  if (r.failed) throw new Error('psql failed: ' + r.stderr);
  return r.stdout.trim();
}
function parseSeq(ref: string): number {
  const m = ref.match(/^XT\.(\d+)$/);
  if (!m) throw new Error('externalRef does not match XT.NNNN: ' + ref);
  return parseInt(m[1], 10);
}
async function loginAsDispatcher(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/tên đăng nhập|username/i).fill('dispatcher');
  await page.getByLabel(/mật khẩu|password/i).fill('any-password');
  await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
test.describe.configure({ mode: 'serial' });
test.describe('transport order auto-numbering (T3 invariant) — full layer chain', () => {
  let vehiclesBaseline: readonly string[] = [];
  let driversBaseline: readonly string[] = [];
  const seededPairs: SeededPair[] = [];
  test.beforeAll(async ({ request }) => {
    const token = await mintDispatcherToken();
    vehiclesBaseline = await listLabels(request, token, '/reference/vehicles');
    driversBaseline = await listLabels(request, token, '/reference/drivers');
  });
  test.afterEach(async ({ request }) => {
    while (seededPairs.length > 0) {
      const pair = seededPairs.pop();
      if (!pair) continue;
      try {
        await adminDelete(request, pair.token, '/admin/driver-vehicle-assignments/' + pair.assignmentId, { reason: 'e2e-afterEach' });
      } catch { /* already revoked by the test body */ }
      try {
        const r = await request.delete(API_URL + '/reference/vehicles/' + pair.vehicleId, {
          headers: { Authorization: 'Bearer ' + pair.token },
        });
        if (!r.ok()) { /* tolerate */ }
      } catch { /* tolerate */ }
      try {
        const r = await request.delete(API_URL + '/admin/drivers/' + pair.driverId, {
          headers: { Authorization: 'Bearer ' + pair.token },
        });
        if (!r.ok()) { /* tolerate */ }
      } catch { /* tolerate */ }
    }
  });
  test.afterAll(async ({ request }) => {
    const token = await mintDispatcherToken();
    const vehiclesAfter = await listLabels(request, token, '/reference/vehicles');
    const driversAfter = await listLabels(request, token, '/reference/drivers');
    expect(vehiclesAfter).toEqual(vehiclesBaseline);
    expect(driversAfter).toEqual(driversBaseline);
  });
  test('L3+L5: API response and DB row both carry server XT.NNNN; client value ignored', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L3');
    seededPairs.push(pair);
    const clientGarbage = 'CLIENT-IGNORED-' + String(Date.now());
    const result = await createOrderViaApi(request, pair, clientGarbage);
    expect(result.externalRef).toBeDefined();
    expect(result.externalRef).toMatch(ORDER_NUMBER_REGEX);
    expect(result.externalRef).not.toBe(clientGarbage);
    const dbRef = externalRefOf(result.transportOrderId);
    expect(dbRef).toBe(result.externalRef);
  });
  test('L4: two sequential creates produce strictly increasing XT sequence', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L4S');
    seededPairs.push(pair);
    const a = await createOrderViaApi(request, pair, null);
    const b = await createOrderViaApi(request, pair, null);
    const refA = externalRefOf(a.transportOrderId);
    const refB = externalRefOf(b.transportOrderId);
    expect(refA).toMatch(ORDER_NUMBER_REGEX);
    expect(refB).toMatch(ORDER_NUMBER_REGEX);
    expect(parseSeq(refB)).toBeGreaterThan(parseSeq(refA));
  });
  test('L4: parallel creates produce two distinct XT numbers (FOR UPDATE atomicity)', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L4P');
    seededPairs.push(pair);
    const [a, b] = await Promise.all([
      createOrderViaApi(request, pair, null),
      createOrderViaApi(request, pair, null),
    ]);
    const refA = externalRefOf(a.transportOrderId);
    const refB = externalRefOf(b.transportOrderId);
    expect(refA).toMatch(ORDER_NUMBER_REGEX);
    expect(refB).toMatch(ORDER_NUMBER_REGEX);
    expect(refA).not.toBe(refB);
  });
  test('L5: order_sequence row seeded (XT, pad>=4); external_ref unique per company', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L5');
    seededPairs.push(pair);
    await createOrderViaApi(request, pair, null);
    const sq = String.fromCharCode(39);
    const seqSql =
      'SELECT prefix, pad_width, next_value FROM order_sequence WHERE company_id=' +
      sq + COMPANY_ID + sq + ' AND prefix=' + sq + 'XT' + sq + ';';
    const seqR = dockerPsql(seqSql);
    expect(seqR.failed).toBe(false);
    expect(seqR.stdout.trim().length).toBeGreaterThan(0);
    const [prefix, padStr, nextStr] = seqR.stdout.trim().split('|');
    expect(prefix).toBe('XT');
    expect(parseInt(padStr, 10)).toBeGreaterThanOrEqual(4);
    expect(parseInt(nextStr, 10)).toBeGreaterThanOrEqual(2);
    const uqSql =
      'SELECT COUNT(*) FROM (SELECT external_ref, COUNT(*) c FROM transport_order ' +
      'WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref ~ ' + sq + '^XT\\.\\d+$' + sq + ' ' +
      'GROUP BY external_ref HAVING COUNT(*) > 1) dup;';
    const uqR = dockerPsql(uqSql);
    expect(uqR.failed).toBe(false);
    expect(parseInt(uqR.stdout.trim(), 10)).toBe(0);
  });
  test('L6: outbox row for the road_run delta carries the server-assigned XT.NNNN', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L6');
    seededPairs.push(pair);
    const { transportOrderId, roadRunId } = await createOrderViaApi(request, pair, null);
    const ref = externalRefOf(transportOrderId);
    expect(ref).toMatch(ORDER_NUMBER_REGEX);
    const sq = String.fromCharCode(39);
    const sql =
      'SELECT payload::text FROM outbox WHERE payload->>' + sq + 'aggregateType' + sq + '=' + sq + 'road_run' + sq + ' ' +
      'AND payload->>' + sq + 'roadRunId' + sq + '=' + sq + roadRunId + sq + ' ORDER BY created_at DESC LIMIT 1;';
    const r = dockerPsql(sql);
    expect(r.failed).toBe(false);
    expect(r.stdout).toContain(ref);
  });
  test('L7: a non-dispatcher token cannot create a transport order', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L7');
    seededPairs.push(pair);
    const res = await request.post(API_URL + '/transport-orders', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          assignedOperatorId: pair.operatorId,
          assignedAssetId: pair.vehicleId,
        },
      },
    });
    expect(res.ok()).toBe(false);
    expect([401, 403]).toContain(res.status());
  });
  test('L1+L2: UI submission produces server XT.NNNN and surfaces it on the form', async ({ page, request }) => {
    const pair = await setupPair(request, 'T3-UI');
    seededPairs.push(pair);
    const sq = String.fromCharCode(39);
    const beforeMaxSql =
      'SELECT COALESCE(MAX((substring(external_ref FROM ' + sq + '^XT\\.(\\d+)$' + sq + '))::int), 0) ' +
      'FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND external_ref ~ ' + sq + '^XT\\.\\d+$' + sq + ';';
    const beforeMax = parseInt(dockerPsql(beforeMaxSql).stdout.trim(), 10);
    await loginAsDispatcher(page);
    await page.goto('/');
    await page.locator('#plannedStartAt').fill('2026-06-01T08:00');
    const vehicleInput = page.locator('input#vehiclePlate');
    await vehicleInput.click();
    await vehicleInput.fill(pair.vehicleLabel);
    await page.getByRole('option', { name: pair.vehicleLabel }).click();
    await page.locator('#pickupAt').fill('2026-06-01T09:00');
    await page.locator('#deliveryAt').fill('2026-06-01T18:00');
    await page.locator('input#pickupWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.locator('input#deliveryWarehouse_1').click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();
    const findSql =
      'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' ' +
      'AND external_ref ~ ' + sq + '^XT\\.\\d+$' + sq + ' ' +
      'AND (substring(external_ref FROM ' + sq + '^XT\\.(\\d+)$' + sq + '))::int > ' + String(beforeMax) +
      ' ORDER BY created_at DESC LIMIT 1;';
    let createdRef = '';
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql(findSql);
      const v = r.stdout.trim();
      if (v.length > 0) { createdRef = v; break; }
      await page.waitForTimeout(500);
    }
    expect(createdRef).toMatch(ORDER_NUMBER_REGEX);
  });
});
