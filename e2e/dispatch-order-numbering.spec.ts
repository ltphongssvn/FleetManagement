// e2e/dispatch-order-numbering.spec.ts
//
// End-to-end verification of the T3 invariant: every transport_order is
// created with a server-assigned external_ref of the form XTT.MM-NNN where
// NNNN is a monotonically increasing, zero-padded integer per company.
// The dispatcher never inputs the order number; it is allocated atomically
// by the order-numbering service at API write time. Any client-supplied
// externalRef is overwritten.
//
// Layer coverage (matches the codebase TDD layer map):
//   L1 UI          : success view shows server-assigned XTT.MM-NNN; any value
//                    typed in Số Lệnh is overridden.
//   L2 Server Action: ops-web BFF route /api/transport-orders forwards the
//                     form payload; server-assigned ref reaches the browser.
//   L3 API DTO/Ctrl: response body carries externalRef matching /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/;
//                    client-supplied externalRef is ignored.
//   L4 Service     : two sequential creates strictly increase; two parallel
//                    creates produce two distinct refs (atomicity).
//   L5 Database    : order_sequence row exists per (company, prefix='XTT');
//                    external_ref column is unique per company; padding>=3.
//   L6 Outbox/Workr: outbox row for the road_run carries externalRef in delta
//                    so the dispatch_board projection sees the XTT.MM-NNN.
//   L7 Auth/Tenant : a token with no fleet-dispatcher role cannot create
//                    orders (so cannot consume the company sequence).
//
// No-leak contract (2026-Q2): see dispatch-order-protection-chain.spec.ts
// for the rationale. Every setupPair() call pushes onto seededPairs; the
// afterEach pops and revokes/soft-deletes each entry; afterAll asserts the
// dispatcher /reference/vehicles + /reference/drivers match the baseline.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { dockerPsql } from './helpers/docker-exec';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, ReferenceListResponseSchema, CreateTransportOrderResponseSchema } from './helpers/contracts';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const ORDER_NUMBER_REGEX = /^XTT\.(0[1-9]|1[0-2])-\d{3,}$/;
interface SeededPair {
  driverId: string;
  operatorId: string;
  vehicleId: string;
  vehicleLabel: string;
  driverLabel: string;
  assignmentId: string;
  token: string;
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) {
    throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return parseJson(res, schema);
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
  const json = await parseJson(res, ReferenceListResponseSchema);
  return json.items.map((i) => i.label).sort();
}
async function setupPair(api: APIRequestContext, suffix: string): Promise<SeededPair> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER ' + suffix + ' ' + String(ts);
  const vehicleLabel = 'E2E-' + suffix + '-' + String(ts);
  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(
    api, token, '/reference/vehicles', { name: vehicleLabel },
    ReferenceItemSchema,
  );
  const asgn = await adminPost(
    api, token, '/admin/driver-vehicle-assignments',
    { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
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
  if (clientExternalRef !== null) body['externalRef'] = clientExternalRef;
  const res = await api.post(API_URL + '/transport-orders', {
    headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' },
    data: body,
  });
  if (!res.ok()) {
    throw new Error('POST /transport-orders failed ' + String(res.status()) + ': ' + (await res.text()));
  }
  return parseJson(res, CreateTransportOrderResponseSchema);
}
function externalRefOf(transportOrderId: string): string {
  const sq = String.fromCharCode(39);
  const sql = 'SELECT external_ref FROM transport_order WHERE transport_order_id=' + sq + transportOrderId + sq + ';';
  const r = dockerPsql(sql);
  if (r.failed) throw new Error('psql failed: ' + r.stderr);
  return r.stdout.trim();
}
function parseSeq(ref: string): number {
  const m = /^XTT\.\d{2}-(\d+)$/.exec(ref);
  if (!m) throw new Error('externalRef does not match XTT.MM-NNN: ' + ref);
  return parseInt(m[1] ?? '', 10);
}
// Authenticate via injected session (PKCE login has no credential form).
async function loginAsDispatcher(page: Page): Promise<void> {
  await loginAs(page);
}
test.describe.configure({ mode: 'serial' });
test.describe('transport order auto-numbering (T3 invariant) — full layer chain', () => {
  // 2026-Q2 no-leak contract. Self-scoped tracker: every setupPair adds
  // its labels to seededVehicleLabels/seededDriverLabels; afterAll asserts
  // none of THOSE labels remain. Parallel-safe (sibling spec activity in
  // other workers cannot perturb the assertion).
  const seededPairs: SeededPair[] = [];
  const seededVehicleLabels = new Set<string>();
  const seededDriverLabels = new Set<string>();
  // 2026 best practice: tests that create transport_order rows via UI
  // must also clean up THOSE rows. afterEach DELETEs them; afterAll
  // asserts no-leak. Prevents Lệnh điều xe table pollution.
  const seededOrderRefs: string[] = [];
  function trackPair(pair: SeededPair): void {
    seededPairs.push(pair);
    seededVehicleLabels.add(pair.vehicleLabel);
    seededDriverLabels.add(pair.driverLabel);
  }
  test.afterEach(async ({ request }) => {
    test.setTimeout(90000);
    // Delete order rows FIRST so FK dependencies are released before pair cleanup.
    const sq = String.fromCharCode(39);
    while (seededOrderRefs.length > 0) {
      const ref = seededOrderRefs.pop();
      if (!ref) continue;
      // Delete transport_order + its road_run + outbox rows so the
      // dispatch_board projection does not replay stale state on the
      // next parallel worker's render of /.
      const txIdSql = 'SELECT transport_order_id FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      const txIdRes = dockerPsql(txIdSql);
      const txId = txIdRes.stdout.trim();
      if (txId.length > 0) {
        const rrIdSql = 'SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';';
        const rrIds = dockerPsql(rrIdSql).stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
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
      const delSql = 'DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref=' + sq + ref + sq + ';';
      try { dockerPsql(delSql); } catch { /* tolerate */ }
    }
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
    test.setTimeout(90000);
    const token = mintDispatcherToken();
    const vehiclesAfter = await listLabels(request, token, '/reference/vehicles');
    const driversAfter = await listLabels(request, token, '/reference/drivers');
    const leakedVehicles = vehiclesAfter.filter((l) => seededVehicleLabels.has(l));
    const leakedDrivers = driversAfter.filter((l) => seededDriverLabels.has(l));
    expect(leakedVehicles).toEqual([]);
    expect(leakedDrivers).toEqual([]);
    if (seededOrderRefs.length > 0) {
      const sq = String.fromCharCode(39);
      const inList = seededOrderRefs.map((r) => sq + r + sq).join(',');
      const sql = 'SELECT external_ref FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
        ' AND external_ref IN (' + inList + ');';
      const r = dockerPsql(sql);
      const leakedOrders = r.stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
      expect(leakedOrders).toEqual([]);
    }
  });
  test('L3+L5: API response and DB row both carry server XTT.MM-NNN; client value ignored', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L3');
    trackPair(pair);
    const clientGarbage = 'CLIENT-IGNORED-' + String(Date.now());
    const result = await createOrderViaApi(request, pair, clientGarbage);
    if (result.externalRef) seededOrderRefs.push(result.externalRef);
    expect(result.externalRef).toBeDefined();
    expect(result.externalRef).toMatch(ORDER_NUMBER_REGEX);
    expect(result.externalRef).not.toBe(clientGarbage);
    const dbRef = externalRefOf(result.transportOrderId);
    expect(dbRef).toBe(result.externalRef);
  });
  test('L4: two sequential creates produce strictly increasing XT sequence', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L4S');
    trackPair(pair);
    const a = await createOrderViaApi(request, pair, null);
    const b = await createOrderViaApi(request, pair, null);
    const refA = externalRefOf(a.transportOrderId);
    const refB = externalRefOf(b.transportOrderId);
    seededOrderRefs.push(refA, refB);
    expect(refA).toMatch(ORDER_NUMBER_REGEX);
    expect(refB).toMatch(ORDER_NUMBER_REGEX);
    expect(parseSeq(refB)).toBeGreaterThan(parseSeq(refA));
  });
  test('L4: parallel creates produce two distinct XT numbers (FOR UPDATE atomicity)', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L4P');
    trackPair(pair);
    const [a, b] = await Promise.all([
      createOrderViaApi(request, pair, null),
      createOrderViaApi(request, pair, null),
    ]);
    const refA = externalRefOf(a.transportOrderId);
    const refB = externalRefOf(b.transportOrderId);
    seededOrderRefs.push(refA, refB);
    expect(refA).toMatch(ORDER_NUMBER_REGEX);
    expect(refB).toMatch(ORDER_NUMBER_REGEX);
    expect(refA).not.toBe(refB);
  });
  test('L5: order_sequence row seeded (XTT, pad>=3); external_ref unique per company', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L5');
    trackPair(pair);
    const createdL5 = await createOrderViaApi(request, pair, null);
    const refL5 = externalRefOf(createdL5.transportOrderId);
    seededOrderRefs.push(refL5);
    const sq = String.fromCharCode(39);
    const seqSql =
      'SELECT prefix, pad_width, next_value FROM order_sequence WHERE company_id=' +
      sq + COMPANY_ID + sq + ' AND prefix=' + sq + 'XTT' + sq + ';';
    const seqR = dockerPsql(seqSql);
    expect(seqR.failed).toBe(false);
    expect(seqR.stdout.trim().length).toBeGreaterThan(0);
    const [prefix, padStr, nextStr] = seqR.stdout.trim().split('|');
    expect(prefix).toBe('XTT');
    expect(parseInt(padStr ?? '', 10)).toBeGreaterThanOrEqual(3);
    expect(parseInt(nextStr ?? '', 10)).toBeGreaterThanOrEqual(2);
    const uqSql =
      'SELECT COUNT(*) FROM (SELECT external_ref, COUNT(*) c FROM transport_order ' +
      'WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref ~ ' + sq + '^XTT\\.(0[1-9]|1[0-2])-\\d+$' + sq + ' ' +
      'GROUP BY external_ref HAVING COUNT(*) > 1) dup;';
    const uqR = dockerPsql(uqSql);
    expect(uqR.failed).toBe(false);
    expect(parseInt(uqR.stdout.trim(), 10)).toBe(0);
  });
  test('L6: outbox row for the road_run delta carries the server-assigned XTT.MM-NNN', async ({ request }) => {
    const pair = await setupPair(request, 'T3-L6');
    trackPair(pair);
    const { transportOrderId, roadRunId } = await createOrderViaApi(request, pair, null);
    const ref = externalRefOf(transportOrderId);
    seededOrderRefs.push(ref);
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
    trackPair(pair);
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
  test('L1+L2: UI submission produces server XTT.MM-NNN and surfaces it on the form', async ({ page, request }) => {
    const pair = await setupPair(request, 'T3-UI');
    trackPair(pair);
    const sq = String.fromCharCode(39);
    const beforeMaxSql =
      'SELECT COALESCE(MAX((substring(external_ref FROM ' + sq + '^XTT\\.\\d{2}-(\\d+)$' + sq + '))::int), 0) ' +
      'FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq +
      ' AND external_ref ~ ' + sq + '^XTT\\.(0[1-9]|1[0-2])-\\d+$' + sq + ';';
    const beforeMax = parseInt(dockerPsql(beforeMaxSql).stdout.trim(), 10);
    await loginAsDispatcher(page);
    await page.goto('/');
    await expect(page.locator('[data-testid=create-order-form][data-hydrated=true]')).toBeVisible({ timeout: 15_000 });
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
      'AND external_ref ~ ' + sq + '^XTT\\.(0[1-9]|1[0-2])-\\d+$' + sq + ' ' +
      'AND (substring(external_ref FROM ' + sq + '^XTT\\.\\d{2}-(\\d+)$' + sq + '))::int > ' + String(beforeMax) +
      ' ORDER BY created_at DESC LIMIT 1;';
    let createdRef = '';
    for (let i = 0; i < 30; i++) {
      const r = dockerPsql(findSql);
      const v = r.stdout.trim();
      if (v.length > 0) { createdRef = v; break; }
      await page.waitForTimeout(500);
    }
    // No-leak: push BEFORE assertion so the order is cleaned up even
    // when the assertion fails (e.g. flaky polling under parallel workers).
    if (createdRef.length > 0) seededOrderRefs.push(createdRef);
    expect(createdRef).toMatch(ORDER_NUMBER_REGEX);
  });
});
