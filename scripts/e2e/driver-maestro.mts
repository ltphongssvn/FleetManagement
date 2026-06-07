// scripts/e2e/driver-maestro.mts
// Self-contained driver-app release-build Maestro E2E harness (2026 pattern: the
// UI runner OWNS its entire data lifecycle -- seed just-in-time via the app's own
// API factory, run, then unconditionally clean up -- and does NOT depend on any
// other test's seed/teardown). Run: pnpm tsx scripts/e2e/driver-maestro.mts
//
// WHY self-contained (Red Hat 2026; Autonoma 2026; Bunnyshell 2026): a UI E2E
// canary must create exactly the data it needs and clean it up unconditionally.
// The previous harness reused e2e/dispatcher-to-driver-fulfillment.spec.ts to
// seed, but that spec's afterAll cleanupSeed() DELETES the order (it is the
// in-process dispatcher->driver proof, not a shared fixture), so the separate
// Maestro process then ran against an empty board and the order-detail/capture
// flows failed ("XTT.06-001" not visible). Cross-process shared state is the
// anti-pattern; this harness seeds its own order.
//
// Cycle: mint a dispatcher token (in-container -- mock-oauth2 is a compose-
// internal host) -> create driver + vehicle + assignment + order via the app's
// own admin/seed API (api:3000 is host-reachable) -> adb reverse (the address
// that reaches the api from the WSL2 emulator) -> hide_error_dialogs -> run every
// release Maestro flow -> copy failure screenshots to the Windows Desktop and
// LOOK -> ALWAYS clean up the seeded order (finally). See
// docs/adr/005-android-e2e-release-build.md and
// context/e2e-test-data-via-api-factory-not-manual-fixtures.md.
import { execa } from 'execa';
import { copyFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname_esm = dirname(fileURLToPath(import.meta.url));
const WT = resolve(__dirname_esm, '../..');
const DEVICE = 'emulator-5554';
const API = 'http://localhost:3000';
const PG = 'fleet-pilot-postgres-1';
const API_CTR = 'fleet-pilot-api-1';
const KNOWN_PASSWORD = 'e2e-pass-1234'; // pragma: allowlist secret
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const HANDOFF = join(WT, '.e2e-artifacts/driver-handoff.json');
// All four release-build flows. change-password is LAST: it sets a NEW password
// at the end, so no later flow re-logs-in with the original seed password.
const FLOWS = [
  'apps/driver-app/.maestro/driver-login-assignment.yaml',
  'apps/driver-app/.maestro/driver-assigned-order-detail.yaml',
  'apps/driver-app/.maestro/driver-capture-proof-per-warehouse.yaml',
  'apps/driver-app/.maestro/driver-change-password.yaml',
];
const env = { ...process.env };

function log(section: string, msg: string): void {
  console.log('\n=== ' + section + ' ===\n' + msg);
}

// mock-oauth2:8080 is a compose-internal hostname (not host-reachable), so the
// dispatcher token is minted from INSIDE the api container, exactly as
// dispatcher-to-driver-fulfillment.spec.ts does.
async function mintToken(): Promise<string> {
    const script = "fetch('http://mock-oauth2:8080/fleet/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=password&username=dispatcher&password=x&scope=fleet&client_id=ops-web&client_secret=ops-web-secret'}).then(r=>r.json()).then(j=>process.stdout.write(j.access_token))";
  const r = await execa('docker', ['exec', API_CTR, 'node', '-e', script], { all: true });
  const tok = (r.stdout ?? '').trim();
  if (!tok.includes('.')) throw new Error('token mint failed: ' + (r.all ?? ''));
  return tok;
}

interface PostOk { [k: string]: unknown }
async function apiPost(token: string, path: string, body: unknown): Promise<PostOk> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('POST ' + path + ' -> ' + String(res.status) + ': ' + text);
  return JSON.parse(text) as PostOk;
}

interface SeedResult {
  phone: string;
  password: string;
  orderRef: string;
  vehicleLabel: string;
  vehicleId: string;
}

// Create a UNIQUE driver + vehicle + assignment + order through the app's own
// API (the factory pattern). One pickup + one delivery stop -> the driver sees a
// loading capture and a delivery capture. yardId is omitted (optional in
// CreateTransportOrderSchema): the migrated flows assert seed-INDEPENDENT
// capture-screen titles + the order ref + the seeded vehicle label, never
// warehouse names, so a null warehouse does not affect any assertion.
async function seed(): Promise<SeedResult> {
  const token = await mintToken();
  const ts = Date.now();
  const phone = '09' + String(ts).slice(-8);
  const driverLabel = 'E2E DRIVER MAESTRO ' + String(ts);
  const vehicleLabel = 'E2E-MAESTRO-' + String(ts);
  const drv = await apiPost(token, '/admin/drivers', { fullName: driverLabel, phone, password: KNOWN_PASSWORD });
  const veh = await apiPost(token, '/reference/vehicles', { name: vehicleLabel });
  await apiPost(token, '/admin/driver-vehicle-assignments', { driverId: drv['driverId'], vehicleId: veh['id'] });
  const order = await apiPost(token, '/transport-orders', {
    stops: [ { sequence: 1, stopType: 'pickup' }, { sequence: 2, stopType: 'delivery' } ],
    roadRun: { assignedOperatorId: drv['operatorId'], assignedAssetId: veh['id'], plannedStartAt: new Date().toISOString() },
  });
  const orderRef = String(order['externalRef']);
  const vehicleId = String(veh['id']);
  log('seed', 'phone=' + phone + ' order=' + orderRef + ' vehicle=' + vehicleLabel);
  mkdirSync(dirname(HANDOFF), { recursive: true });
  writeFileSync(HANDOFF, JSON.stringify({
    driverPhone: phone, driverPassword: KNOWN_PASSWORD, orderRef,
    operatorId: drv['operatorId'], vehicleId, vehicleLabel,
  }, null, 2));
  return { phone, password: KNOWN_PASSWORD, orderRef, vehicleLabel, vehicleId };
}

// Unconditional, vehicle-scoped teardown (mirrors the spec's cleanupSeed): delete
// the seeded order graph so it does not pollute the board / manual verification.
// Tolerant: a failed statement does not abort the rest.
async function cleanup(vehicleId: string): Promise<void> {
  const sq = String.fromCharCode(39);
  const v = sq + vehicleId + sq;
  const stmts = [
    'DELETE FROM stop WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t JOIN road_run_transport_order rrto ON rrto.transport_order_id=t.transport_order_id JOIN road_run r ON r.road_run_id=rrto.road_run_id WHERE r.assigned_asset_id=' + v + ');',
    'DELETE FROM road_run_transport_order WHERE road_run_id IN (SELECT road_run_id FROM road_run WHERE assigned_asset_id=' + v + ');',
    'DELETE FROM transport_order WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t WHERE NOT EXISTS (SELECT 1 FROM road_run_transport_order x WHERE x.transport_order_id=t.transport_order_id) AND t.company_id=' + sq + COMPANY_ID + sq + ');',
    'DELETE FROM road_run WHERE assigned_asset_id=' + v + ';',
    'DELETE FROM dispatch_board_projection WHERE assigned_asset_id=' + v + ';',
    // FULL-LIFECYCLE cleanup (anti-leak): the harness owns its seed end to end.
    // global-teardown only runs after a Playwright suite, NOT after this
    // standalone Maestro harness, so the seeded driver/vehicle/assignment would
    // otherwise leak forever. Delete them here in FK order. passkey_credential
    // has no cascade -> delete any children first (the seed creates none, but be
    // safe). Driver is resolved via the assignment on this vehicle.
    'DELETE FROM passkey_credential WHERE driver_id IN (SELECT driver_id FROM driver_vehicle_assignment WHERE vehicle_id=' + v + ');',
    'DELETE FROM driver_vehicle_assignment WHERE vehicle_id=' + v + ';',
    'DELETE FROM driver WHERE company_id=' + sq + COMPANY_ID + sq + ' AND full_name LIKE ' + sq + 'E2E%MAESTRO%' + sq + ';',
    'DELETE FROM vehicle WHERE vehicle_id=' + v + ';',
  ];
  for (const s of stmts) {
    await execa('docker', ['exec', PG, 'psql', '-U', 'fleet', '-d', 'fleet', '-c', s], { reject: false, all: true });
  }
  log('cleanup', 'order graph removed for vehicle ' + vehicleId);
}

async function adbReverse(): Promise<void> {
  await execa('adb', ['-s', DEVICE, 'reverse', 'tcp:3000', 'tcp:3000'], { reject: false });
  const r = await execa('adb', ['-s', DEVICE, 'reverse', '--list'], { reject: false, all: true });
  log('adb reverse', r.all ?? '');
}

// hide_error_dialogs=1 stops the headless swiftshader emulator's system_server
// ANR modal from occluding the app / blocking gesture injection. Per-emulator
// setting, not persisted across a fresh AVD, so applied every run.
async function ensureEmulatorSettings(): Promise<void> {
  await execa('adb', ['-s', DEVICE, 'shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'], { reject: false });
  const r = await execa('adb', ['-s', DEVICE, 'shell', 'settings', 'get', 'global', 'hide_error_dialogs'], { reject: false, all: true });
  log('hide_error_dialogs', (r.all ?? '').trim());
}

interface FlowResult { flow: string; rc: number }
async function runFlow(flowPath: string, seedEnv: Record<string, string>): Promise<FlowResult> {
  const r = await execa('maestro', ['test', flowPath], { cwd: WT, env: { ...env, ...seedEnv }, reject: false, all: true });
  log('maestro ' + basename(flowPath), (r.all ?? '') + '\nRC=' + String(r.exitCode));
  return { flow: basename(flowPath), rc: r.exitCode ?? 1 };
}

function copyScreens(): void {
  const base = join(homedir(), '.maestro/tests');
  if (!existsSync(base)) return;
  const runs = readdirSync(base).map((d) => join(base, d)).filter((d) => statSync(d).isDirectory());
  if (runs.length === 0) return;
  const latest = runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const pngs = readdirSync(latest).filter((f) => f.endsWith('.png')).map((f) => join(latest, f));
  const usersDir = '/mnt/c/Users';
  const desks = existsSync(usersDir) ? readdirSync(usersDir).map((u) => join(usersDir, u, 'Desktop')).filter((d) => existsSync(d)) : [];
  for (const png of pngs) {
    for (const desk of desks) copyFileSync(png, join(desk, 'rel_' + basename(png)));
  }
  log('screens', latest + '\n' + pngs.map((f) => basename(f)).join('\n'));
}

async function main(): Promise<void> {
  let vehicleId: string | null = null;
  try {
    const s = await seed();
    vehicleId = s.vehicleId;
    await adbReverse();
    await ensureEmulatorSettings();
    const flowEnv = {
      MAESTRO_DRIVER_PHONE: s.phone,
      MAESTRO_DRIVER_PASSWORD: s.password,
      MAESTRO_ORDER_REF: s.orderRef,
      MAESTRO_VEHICLE_LABEL: s.vehicleLabel,
    };
    const results: FlowResult[] = [];
    for (const f of FLOWS) results.push(await runFlow(f, flowEnv));
    const failed = results.filter((r) => r.rc !== 0);
    if (failed.length > 0) {
      copyScreens();
      log('result', 'FAILED: ' + failed.map((f) => f.flow).join(', '));
      process.exitCode = 1;
    } else {
      log('result', 'ALL FLOWS GREEN (' + String(results.length) + ')');
    }
  } finally {
    if (vehicleId !== null) await cleanup(vehicleId);
  }
}

void main();
