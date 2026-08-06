// e2e/dispatch-export-excel-search-filter.spec.ts
//
// L0 acceptance for the T67 invariant: the exported Lenh dieu xe workbook
// contains the rows the dispatcher can SEE -- the rows matching the ACTIVE
// board search -- never the whole board.
//
// Why this spec must exist at THIS level. Every layer below is already green:
// the Zod contract, the shared SQL clause, the API controller and service, the
// server action, and the button all have unit coverage. None of them proves the
// chain HOLDS end to end. That is the exact gap the Chenh lech column fell
// through once before: it reached the service and package tests but not the e2e
// spec, so it passed the PR gate and only failed on the release push. A
// dispatcher does not experience a Zod schema; they type a term and press a
// button. This is the level that proves the fix reached them.
//
// Seeding (anti-pattern guard): this spec OWNS its data. It seeds TWO
// distinguishable vehicle+driver pairs and creates one order through the
// dispatcher UI for each, so the board genuinely holds two projection rows.
// Searching for one vehicle label must yield a workbook containing that order
// and NOT the other. Both graphs are cleaned up unconditionally.
//
// The assertion is deliberately two-sided. Asserting only that the match is
// PRESENT would pass against the old broken behaviour, which returned every
// row: presence alone cannot distinguish a filtered export from a full one.
// The exclusion assertion is what actually pins the fix.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema } from './helpers/contracts';
import { openCreateOrderDrawer, plannedStartAtField, waitForBoardReady } from './helpers/create-order';
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const POSTGRES_CONTAINER = process.env['E2E_PG_CONTAINER'] ?? 'fleet-pilot-postgres-1';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
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
interface Pair { vehicleId: string; vehicleLabel: string }
async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, data: JSON.stringify(body) });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}
async function setupPair(api: APIRequestContext, tag: string): Promise<Pair> {
  const token = mintDispatcherToken();
  const ts = String(Date.now()) + tag;
  const driverLabel = 'E2E DRIVER XLSXSRCH ' + ts;
  const vehicleLabel = 'E2E-XLSXSRCH-' + tag + '-' + String(Date.now());
  const drv = await adminPost(api, token, '/admin/drivers', { fullName: driverLabel, phone: '09' + ts.slice(-8), password: 'e2e-pass-1234' }, CreateDriverResponseSchema); // pragma: allowlist secret
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  return { vehicleId: veh.id, vehicleLabel };
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
async function createOrderViaUi(page: Page, pair: Pair): Promise<void> {
  await page.goto('/');
  await openCreateOrderDrawer(page);
  await plannedStartAtField(page.locator('[data-testid=nl-create-order-form]')).fill('2026-06-01');
  const vehicleInput = page.locator('input#vehiclePlate');
  await vehicleInput.click();
  await vehicleInput.fill(pair.vehicleLabel);
  await page.getByRole('option', { name: pair.vehicleLabel }).click();
  await page.locator('#pickupAt').fill('2026-06-01');
  await page.locator('#deliveryAt').fill('2026-06-01');
  await page.locator('input#pickupWarehouse_1').click();
  await page.getByRole('option').first().click();
  await page.locator('input#deliveryWarehouse_1').click();
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Tao lenh' }).click();
  await expect(page.locator('a[href^=/dispatch/orders/]').first()).toBeVisible({ timeout: 15000 });
}
// Every cell of every data row, flattened to one lowercase string per row, so a
// label can be located without depending on which column carries it.
async function readDataRows(downloadPath: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(downloadPath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('no worksheet in exported workbook');
  const rows: string[] = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const cells = (row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : String(v)));
    rows.push(cells.join(' | ').toLowerCase());
  });
  return rows;
}
async function exportAndReadRows(page: Page): Promise<string[]> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /xu.t excel/i }).click();
  const download = await downloadPromise;
  const p = await download.path();
  expect(p).toBeTruthy();
  return readDataRows(p);
}
test.describe.serial('export Excel honours the active board search', () => {
  let matching: Pair | null = null;
  let other: Pair | null = null;
  test.beforeAll(async ({ request }) => {
    matching = await setupPair(request, 'HIT');
    other = await setupPair(request, 'MISS');
  });
  test.afterAll(() => {
    if (matching) cleanupPair(matching);
    if (other) cleanupPair(other);
  });
  test('a search term narrows the workbook to the matching rows and EXCLUDES the rest', async ({ page }) => {
    if (!matching || !other) throw new Error('seed pairs missing');
    await loginAs(page);
    await createOrderViaUi(page, matching);
    await createOrderViaUi(page, other);
    // Unfiltered export: both seeded orders present. This pins the seeding so a
    // later exclusion cannot pass vacuously through an empty or broken board.
    await page.goto('/');
    await waitForBoardReady(page);
    const allRows = (await exportAndReadRows(page)).join(chr10());
    expect(allRows).toContain(matching.vehicleLabel.toLowerCase());
    expect(allRows).toContain(other.vehicleLabel.toLowerCase());
    // Now search, then export. The workbook must mirror the filtered view.
    const box = page.getByTestId('dispatch-board-search');
    await box.fill(matching.vehicleLabel);
    await box.press('Enter');
    await waitForBoardReady(page);
    const filtered = (await exportAndReadRows(page)).join(chr10());
    expect(filtered).toContain(matching.vehicleLabel.toLowerCase());
    // The assertion that actually pins the fix: before T67 the export ignored
    // the search and this row was present, so the whole board leaked out.
    expect(filtered).not.toContain(other.vehicleLabel.toLowerCase());
  });
});
function chr10(): string {
  return String.fromCharCode(10);
}
