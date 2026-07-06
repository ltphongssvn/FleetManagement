// e2e/dispatch-hide-busy-driver-vehicle.spec.ts
//
// 2026 permanent business rule (L0 acceptance):
// A driver/truck already bound to a road_run that is NOT yet completed
// (state in planned|dispatched|started) MUST NOT appear in the dispatch
// form dropdowns Số xe (vehicles) and Tài xế (drivers). Completion means
// the road_run reached state='completed' (all pickup+delivery manifests
// captured). Until then the operator+asset are 'busy' and disappear from
// the selectable options so a dispatcher cannot double-book them onto a
// second simultaneous job.
//
// Critical user journey: truck plates and driver names ONLY reappear in
// Số xe / Tài xế once their current road_run is completed.
// Business invariant: no busy (incomplete-road-run) driver/vehicle is
// selectable.
//
// Strategy (mirrors dispatch-order-protection-chain seeding): mint a
// dispatcher token, seed a fresh driver+vehicle+assignment pair, then
// directly insert a road_run in a non-terminal state binding that pair,
// WITH a linked transport_order (2026-07-05 orphan rule: a link-less
// road_run is an artifact and no longer counts as busy; production
// always creates run + order + link in one transaction).
// Assert the pair's labels are ABSENT from /reference/drivers and
// /reference/vehicles while busy. Flip the road_run to 'completed' and
// assert the labels REAPPEAR. All test rows use unique timestamped
// labels + are torn down in afterEach (no live /reference leak).
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema, ReferenceListResponseSchema } from './helpers/contracts';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
function sq39(): string { return String.fromCharCode(39); }
function mintDispatcherToken(): string {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (out.length === 0 || !out.includes('.')) throw new Error('Token mint failed: ' + out);
  return out.trim();
}
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}
async function listLabels(api: APIRequestContext, token: string, path: string): Promise<readonly string[]> {
  const res = await api.get(API_URL + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok()) throw new Error('GET ' + path + ' failed ' + String(res.status()));
  const json = await parseJson(res, ReferenceListResponseSchema);
  return json.items.map((i) => i.label);
}
interface SeededPair {
  driverId: string; operatorId: string; vehicleId: string;
  vehicleLabel: string; driverLabel: string; assignmentId: string; token: string;
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
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  const asgn = await adminPost(
    api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id },
    AssignmentResponseSchema,
  );
  return { driverId: drv.driverId, operatorId: drv.operatorId, vehicleId: veh.id, vehicleLabel, driverLabel, assignmentId: asgn.assignmentId, token };
}
function insertRoadRun(operatorId: string, assetId: string, state: string): string {
  const sq = sq39();
  const T4 = sq + COMPANY_ID + sq + ',' + sq + COMPANY_ID + sq + ',' + sq + COMPANY_ID + sq + ',' + sq + COMPANY_ID + sq;
  const sql =
    'WITH rr AS (INSERT INTO road_run ' +
    '(company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id, started_at) VALUES (' +
    T4 + ',' +
    sq + state + sq + ',' + sq + operatorId + sq + ',' + sq + assetId + sq + ', now()) RETURNING road_run_id), ' +
    't AS (INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id) VALUES (' + T4 + ') RETURNING transport_order_id) ' +
    'INSERT INTO road_run_transport_order (company_id, business_unit_id, depot_id, legal_entity_id, road_run_id, transport_order_id, sequence) ' +
    'SELECT ' + T4 + ', rr.road_run_id, t.transport_order_id, 1 FROM rr, t RETURNING road_run_id;';
  const r = dockerPsql(sql);
  if (r.failed) throw new Error('road_run insert failed: ' + r.stderr);
  // psql -tA on an INSERT ... RETURNING emits the returned value AND a status
  // line (INSERT 0 1). Take only the first non-empty line (the uuid) so the
  // later completed-state UPDATE targets a clean road_run_id.
  const firstLine = r.stdout.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.length > 0)[0];
  if (firstLine === undefined) throw new Error('road_run insert returned no id: ' + r.stdout);
  return firstLine;
}
test.describe.configure({ mode: 'serial' });
test.describe('dispatch dropdowns hide busy (incomplete-road-run) driver + vehicle', () => {
  const seededPairs: SeededPair[] = [];
  const seededRoadRunIds: string[] = [];
  test.afterEach(async ({ request }) => {
    test.setTimeout(90000);
    const sq = sq39();
    while (seededRoadRunIds.length > 0) {
      const id = seededRoadRunIds.pop();
      if (id === undefined) continue;
      try {
        dockerPsql('DELETE FROM transport_order WHERE transport_order_id IN (SELECT transport_order_id FROM road_run_transport_order WHERE road_run_id=' + sq + id + sq + ');');
        dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + id + sq + ';');
      } catch { /* tolerate */ }
    }
    while (seededPairs.length > 0) {
      const pair = seededPairs.pop();
      if (pair === undefined) continue;
      try { await request.delete(API_URL + '/admin/driver-vehicle-assignments/' + pair.assignmentId, { headers: { Authorization: 'Bearer ' + pair.token, 'Content-Type': 'application/json' }, data: JSON.stringify({ reason: 'e2e-afterEach' }) }); } catch { /* tolerate */ }
      try { await request.delete(API_URL + '/reference/vehicles/' + pair.vehicleId, { headers: { Authorization: 'Bearer ' + pair.token } }); } catch { /* tolerate */ }
      try { await request.delete(API_URL + '/admin/drivers/' + pair.driverId, { headers: { Authorization: 'Bearer ' + pair.token } }); } catch { /* tolerate */ }
    }
  });
  test('busy pair (started road_run) is hidden from Số xe + Tài xế, reappears when completed', async ({ request }) => {
    const pair = await setupPair(request, 'BUSY');
    seededPairs.push(pair);
    // Baseline: a freshly-paired idle driver+vehicle IS selectable.
    const driversIdle = await listLabels(request, pair.token, '/reference/drivers');
    const vehiclesIdle = await listLabels(request, pair.token, '/reference/vehicles');
    expect(driversIdle).toContain(pair.driverLabel);
    expect(vehiclesIdle).toContain(pair.vehicleLabel);
    // Make the pair BUSY: bind it to a non-terminal (started) road_run.
    const rrId = insertRoadRun(pair.operatorId, pair.vehicleId, 'started');
    seededRoadRunIds.push(rrId);
    // INVARIANT: busy pair must DISAPPEAR from both dropdowns.
    const driversBusy = await listLabels(request, pair.token, '/reference/drivers');
    const vehiclesBusy = await listLabels(request, pair.token, '/reference/vehicles');
    expect(driversBusy).not.toContain(pair.driverLabel);
    expect(vehiclesBusy).not.toContain(pair.vehicleLabel);
    // Complete the road_run -> pair must REAPPEAR (free to be reassigned).
    const sq = sq39();
    dockerPsql('UPDATE road_run SET state=' + sq + 'completed' + sq + ', completed_at=now() WHERE road_run_id=' + sq + rrId + sq + ';');
    const driversDone = await listLabels(request, pair.token, '/reference/drivers');
    const vehiclesDone = await listLabels(request, pair.token, '/reference/vehicles');
    expect(driversDone).toContain(pair.driverLabel);
    expect(vehiclesDone).toContain(pair.vehicleLabel);
  });
});
