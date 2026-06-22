// e2e/dispatch-export-excel-all-columns.spec.ts
//
// L0 acceptance for the 2026 export invariant. The manually-exported Lệnh điều
// xe Excel workbook is a DATA export: after the 6 identifying columns
//   Số lệnh | Khách hàng | Tài xế | Xe | Ngày dự kiến | Số điểm
// each stop slot contributes a PAIR of columns — the warehouse NAME and the
// extracted net weight as a NUMBER (kg) — for pickup slots 1..4 and delivery
// slot 1, giving 16 columns total:
//   ... | Điểm nhận hàng 1 | Điểm nhận hàng 1 - KL (kg) | ... (slots 2..4) |
//       Kho giao hàng 1 | Kho giao hàng 1 - KL (kg)
// There is NO per-stop status text and no em-dash filler; a slot with no stop,
// or no extracted weight yet, leaves the kg cell blank (Feature 2).
// (Khách hàng renders the customer name with the phone on a sub-line; Excel is
// flat, so the phone is folded into the Khách hàng cell — it is NOT a column.)
//
// Seeding (anti-pattern guard): this spec OWNS its data. It mints a dispatcher
// token, creates a driver+vehicle+active-assignment pair via the admin API,
// creates a real order through the dispatcher UI (so the dispatch_board
// projection holds a genuine row with customer + stops), asserts on the
// downloaded workbook, then unconditionally cleans up the seeded graph.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema } from './helpers/contracts';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const POSTGRES_CONTAINER = process.env['E2E_PG_CONTAINER'] ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const EXPECTED_HEADERS = [
  'Số lệnh',
  'Khách hàng',
  'Tài xế',
  'Xe',
  'Ngày dự kiến',
  'Số điểm',
  'Điểm nhận hàng 1',
  'Điểm nhận hàng 1 - KL (kg)',
  'Điểm nhận hàng 2',
  'Điểm nhận hàng 2 - KL (kg)',
  'Điểm nhận hàng 3',
  'Điểm nhận hàng 3 - KL (kg)',
  'Điểm nhận hàng 4',
  'Điểm nhận hàng 4 - KL (kg)',
  'Kho giao hàng 1',
  'Kho giao hàng 1 - KL (kg)',
];
interface PsqlResult { stdout: string; stderr: string; failed: boolean }
function dockerPsql(sqlText: string): PsqlResult {
  const cmd = 'docker exec -i ' + POSTGRES_CONTAINER + ' psql -U fleet -d fleet -tA -v ON_ERROR_STOP=1';
  try {
    const stdout = execSync(cmd, { input: sqlText, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    return { stdout, stderr: '', failed: false };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    return { stdout: err.stdout ? err.stdout.toString() : '', stderr: (err.stderr ? err.stderr.toString() : '') + (err.message ?? ''), failed: true };
  }
}
interface Pair { vehicleId: string; vehicleLabel: string; token: string }
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, data: JSON.stringify(body) });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}
async function setupPair(api: APIRequestContext): Promise<Pair> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const driverLabel = 'E2E DRIVER XLSXCOL ' + String(ts);
  const vehicleLabel = 'E2E-XLSXCOL-' + String(ts);
  const drv = await adminPost(api, token, '/admin/drivers', { fullName: driverLabel, phone: '09' + String(ts).slice(-8), password: 'e2e-pass-1234' }, CreateDriverResponseSchema); // pragma: allowlist secret
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  return { vehicleId: veh.id, vehicleLabel, token };
}
function cleanupPair(pair: Pair): void {
  const sq = String.fromCharCode(39);
  const v = sq + pair.vehicleId + sq;
  const co = sq + COMPANY_ID + sq;
  const stmts = [
    'DELETE FROM stop WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t JOIN road_run_transport_order rrto ON rrto.transport_order_id=t.transport_order_id JOIN road_run r ON r.road_run_id=rrto.road_run_id WHERE r.assigned_asset_id=' + v + ');',
    'DELETE FROM road_run_transport_order WHERE road_run_id IN (SELECT road_run_id FROM road_run WHERE assigned_asset_id=' + v + ');',
    'DELETE FROM transport_order WHERE transport_order_id IN (SELECT t.transport_order_id FROM transport_order t WHERE NOT EXISTS (SELECT 1 FROM road_run_transport_order x WHERE x.transport_order_id=t.transport_order_id) AND t.company_id=' + co + ');',
    'DELETE FROM road_run WHERE assigned_asset_id=' + v + ';',
    'DELETE FROM dispatch_board_projection WHERE assigned_asset_id=' + v + ';',
  ];
  for (const s of stmts) { try { dockerPsql(s); } catch { /* tolerate */ } }
}
// Authenticate via injected session (PKCE login has no credential form).
async function login(page: Page): Promise<void> {
  await loginAs(page);
}
async function createOrderViaUi(page: Page, pair: Pair): Promise<void> {
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
  await expect(page.locator('a[href^=\"/dispatch/orders/\"]').first()).toBeVisible({ timeout: 15000 });
}
test.describe.serial('export Excel contains all on-screen Lệnh điều xe columns', () => {
  let pair: Pair | null = null;
  test.beforeAll(async ({ request }) => { pair = await setupPair(request); });
  test.afterAll(() => { if (pair) cleanupPair(pair); });
  test('exported workbook header row equals the 16 identifying + per-slot name/kg columns in order', async ({ page }) => {
    if (!pair) throw new Error('pair missing');
    await login(page);
    await createOrderViaUi(page, pair);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /xu.t excel/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('no worksheet in exported workbook');
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
    expect(header).toEqual(EXPECTED_HEADERS);
  });
});
