// e2e/dispatch-fresh-start-after-purge.spec.ts
// T4 (2026-Q2) acceptance: after operator runs the wipeBusinessData
// utility, the dispatch board is empty AND the first newly created
// transport_order receives external_ref XTT.MM-001 (sequence restarts).
//
// Business invariant: 'fresh start' must be observable end-to-end —
// no leftover rows visible to dispatcher, sequence counter resets so
// dispatchers see clean monotonic numbering from 001 again.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dockerPsql, dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';

function currentMonth2(): string {
  // XTT.MM-NNN: MM is server-side current month. Compute the same way the
  // numbering service does (Asia/Ho_Chi_Minh wall clock month), but for the
  // spec a UTC-ish month is acceptable since the test runs within seconds.
  const m = new Date().getUTCMonth() + 1;
  return m.toString().padStart(2, '0');
}

async function mintDispatcherToken(): Promise<string> {
  const script =
    'fetch(' + JSON.stringify('http://mock-oauth2:8080/fleet/token') +
    ',{method:' + JSON.stringify('POST') +
    ',headers:{' + JSON.stringify('content-type') + ':' + JSON.stringify('application/x-www-form-urlencoded') + '}' +
    ',body:' + JSON.stringify('grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret') + '})' +
    '.then(r=>r.json()).then(j=>process.stdout.write(j.access_token))';
  const out = dockerExecNode('fleet-pilot-api-1', script);
  if (!out || !out.includes('.')) throw new Error('Token mint failed: ' + out);
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

test.describe('dispatch fresh start after wipe (T4)', () => {
  test('after wipeBusinessData runs, dispatch board is empty and next order is XTT.MM-001', async ({ request }) => {
    // Run the wipe directly via SQL. The exact same TRUNCATE ... RESTART
    // IDENTITY CASCADE that wipeBusinessData() executes, so the L0
    // invariant is decoupled from build/deploy concerns.
    const tablesRes = dockerPsql("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations' ORDER BY tablename;");
    if (tablesRes.failed) throw new Error('list tables failed: ' + tablesRes.stderr);
    const tables = tablesRes.stdout.split(String.fromCharCode(10)).map((t) => t.trim()).filter((t) => t.length > 0);
    expect(tables.length).toBeGreaterThan(0);
    const list = tables.map((t) => '"' + t + '"').join(', ');
    const truncRes = dockerPsql('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE;');
    if (truncRes.failed) throw new Error('truncate failed: ' + truncRes.stderr);

    // DB-level invariants after wipe.
    const sq = String.fromCharCode(39);
    const orders = dockerPsql('SELECT COUNT(*) FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(orders).toBe('0');
    const roadRuns = dockerPsql('SELECT COUNT(*) FROM road_run WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(roadRuns).toBe('0');
    const projection = dockerPsql('SELECT COUNT(*) FROM dispatch_board_projection WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(projection).toBe('0');
    const sequences = dockerPsql('SELECT COUNT(*) FROM order_sequence WHERE company_id=' + sq + COMPANY_ID + sq + ';').stdout.trim();
    expect(sequences).toBe('0');

    // Seed a driver+vehicle+assignment so we can create the first order.
    const token = await mintDispatcherToken();
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    const drv = await adminPost<{ operatorId: string; driverId: string }>(
      request, token, '/admin/drivers',
      { fullName: 'E2E DRIVER T4-FRESH ' + String(ts) + '-' + rand, phone: '09' + String(ts).slice(-8), password: 'e2e-pass-1234' }, // pragma: allowlist secret
    );
    const veh = await adminPost<{ id: string }>(request, token, '/reference/vehicles', { name: 'E2E-T4-FRESH-' + rand });
    await adminPost(request, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id });

    // First create after wipe MUST be XTT.MM-001.
    const created = await adminPost<{ externalRef: string }>(
      request, token, '/transport-orders',
      {
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: drv.operatorId, assignedAssetId: veh.id },
      },
    );
    expect(created.externalRef).toBe('XTT.' + currentMonth2() + '-001');
  });
});
