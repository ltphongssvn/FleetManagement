// e2e/dispatch-board-khachhang-column.spec.ts
// L0 ACCEPTANCE (2026): permanent business rule. In the Lệnh điều xe board the
// Trạng thái (state) column is REPLACED by a Khách hàng (customer) column.
//
// Critical user journey: the dispatcher sees Khách hàng in the board.
// Business invariant: the board renders a Khách hàng column showing the order's
//   customer name, and no longer renders a Trạng thái column.
//
// Outside-in: this fails first because (a) the board header still reads
// Trạng thái and (b) the API board row carries no customerName. It drives the
// ops-web column swap (L2) and the API read-time customer enrichment (L3).
//
// ISOLATION (2026-07-23 root fix). This spec previously had NO cleanup at all:
// it seeded a driver, vehicle, pair and seven reference rows, created an order
// through the UI, and left every one of them behind. Its sibling
// dispatch-board-khachhang-phone.spec.ts then ran against a polluted board and
// failed -- proven by the failure DOM, which showed exactly ONE row carrying
// THIS spec's labels (E2E-KH-/E2E DRIVER KH) while the sibling waited for its
// own. The sibling passes when run alone and fails when run after this one,
// which is the textbook signature of order-dependent shared state rather than
// a timing race.
//
// Every other board spec already cleans up after itself (see
// dispatch-board-row-navigation.spec.ts cleanupSeeded/cleanupPair); these two
// were the outliers. 2026 practice is explicit: each test operates on its own
// data set, created per test and deleted in an after hook, which costs a few
// hundred milliseconds and eliminates cross-test contamination.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { dockerPsql } from './helpers/docker-exec';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const ROW_VISIBILITY_BUDGET_MS = 15_000;

// Headless UI Combobox is an <input role=combobox> with portal-rendered
// role=option items, opened on focus (immediate). Drive it by typing to filter
// then clicking the option, with a deterministic open-retry (overlay/hydration
// race hardening per harness-artifact-combobox-contention).
async function pickCombobox(page: import('@playwright/test').Page, inputId: string, optionLabel: string): Promise<void> {
  const input = page.locator('#' + inputId);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(input).toBeEditable({ timeout: 15_000 });
  const opt = page.getByRole('option', { name: optionLabel });
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.fill('');
    await input.fill(optionLabel);
    try { await expect(opt).toBeVisible({ timeout: 5_000 }); break; }
    catch { if (attempt === 3) throw new Error('combobox option not visible: ' + optionLabel); await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
  }
  await opt.click();
}

async function adminPost<T>(api: APIRequestContext, token: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await api.post(API_URL + path, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: JSON.stringify(body),
  });
  if (!res.ok()) throw new Error('POST ' + path + ' failed ' + String(res.status()) + ': ' + (await res.text()));
  return parseJson(res, schema);
}

interface Seed {
  token: string;
  driverId: string;
  vehicleId: string;
  assignmentId: string;
  customerId: string;
  cargoTypeId: string;
  pickupId: string;
  deliveryId: string;
  customerName: string;
  cargoName: string;
  vehicleLabel: string;
  driverLabel: string;
  pickupName: string;
  deliveryName: string;
}

async function seedAll(api: APIRequestContext): Promise<Seed> {
  const token = mintDispatcherToken();
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  const phone = '09' + String(ts).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const driverLabel = 'E2E DRIVER KH ' + rand;
  const vehicleLabel = 'E2E-KH-' + rand;
  const customerName = 'E2E-KHACH-' + rand;
  const cargoName = 'E2E-HANG-' + rand;
  const pickupName = 'E2E-PICKUP-' + rand;
  const deliveryName = 'E2E-DELIVERY-' + rand;

  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  const asgn = await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  const cust = await adminPost(api, token, '/reference/customers', { name: customerName }, ReferenceItemSchema);
  const cargo = await adminPost(api, token, '/reference/cargo-types', { name: cargoName }, ReferenceItemSchema);
  const pickup = await adminPost(api, token, '/reference/warehouses', { name: pickupName, role: 'pickup' }, ReferenceItemSchema);
  const delivery = await adminPost(api, token, '/reference/warehouses', { name: deliveryName, role: 'delivery' }, ReferenceItemSchema);

  return {
    token,
    driverId: drv.driverId,
    vehicleId: veh.id,
    assignmentId: asgn.assignmentId,
    customerId: cust.id,
    cargoTypeId: cargo.id,
    pickupId: pickup.id,
    deliveryId: delivery.id,
    customerName, cargoName, vehicleLabel, driverLabel, pickupName, deliveryName,
  };
}

// Delete the order family this spec created through the UI, keyed by the
// external_ref the success banner reported. Mirrors cleanupSeeded in
// dispatch-board-row-navigation.spec.ts; every statement tolerates not-found so
// a partially-created order still cleans up.
function cleanupOrder(externalRef: string): void {
  const sq = String.fromCharCode(39);
  const txId = dockerPsql('SELECT transport_order_id FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + externalRef + sq + ';').stdout.trim();
  if (txId.length > 0) {
    const rrIds = dockerPsql('SELECT road_run_id FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';')
      .stdout.trim().split(String.fromCharCode(10)).filter((line) => line.length > 0);
    try { dockerPsql('DELETE FROM stop WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
    try { dockerPsql('DELETE FROM road_run_transport_order WHERE transport_order_id=' + sq + txId + sq + ';'); } catch { /* tolerate */ }
    for (const rrId of rrIds) {
      try { dockerPsql('DELETE FROM dispatch_board_projection WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
      try { dockerPsql('DELETE FROM road_run WHERE road_run_id=' + sq + rrId + sq + ';'); } catch { /* tolerate */ }
    }
  }
  try { dockerPsql('DELETE FROM outbox WHERE company_id=' + sq + COMPANY_ID + sq + ' AND payload::text LIKE ' + sq + '%' + externalRef + '%' + sq + ';'); } catch { /* tolerate */ }
  try { dockerPsql('DELETE FROM transport_order WHERE company_id=' + sq + COMPANY_ID + sq + ' AND external_ref=' + sq + externalRef + sq + ';'); } catch { /* tolerate */ }
}

// Revoke the pair and remove every reference row this spec seeded, so the next
// spec sees the dropdowns it expects. Mirrors cleanupPair, extended to the
// reference vocabulary this spec also creates.
async function cleanupSeed(api: APIRequestContext, seed: Seed): Promise<void> {
  const auth = { Authorization: 'Bearer ' + seed.token };
  try {
    await api.delete(API_URL + '/admin/driver-vehicle-assignments/' + seed.assignmentId, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'e2e-cleanup' }),
    });
  } catch { /* tolerate */ }
  for (const path of [
    '/reference/vehicles/' + seed.vehicleId,
    '/admin/drivers/' + seed.driverId,
    '/reference/customers/' + seed.customerId,
    '/reference/cargo-types/' + seed.cargoTypeId,
    '/reference/warehouses/' + seed.pickupId,
    '/reference/warehouses/' + seed.deliveryId,
  ]) {
    try { await api.delete(API_URL + path, { headers: auth }); } catch { /* tolerate */ }
  }
}

test.describe.serial('Lệnh điều xe board: Khách hàng column replaces Trạng thái', () => {
  let seed: Seed | null = null;
  let createdRef = '';

  test.afterAll(async ({ request }) => {
    if (createdRef !== '') cleanupOrder(createdRef);
    if (seed) await cleanupSeed(request, seed);
  });

  test('board shows Khách hàng header + customer name, and no Trạng thái column', async ({ page, request }) => {
    seed = await seedAll(request);

    // Authenticate via injected session (PKCE login has no credential form).
    await loginAs(page);

    await expect(page.getByTestId('create-order-form')).toBeVisible({ timeout: 15_000 });

    // Fill the create-order form via the real UI (minimal happy path).
    // date inputs (type='date') require a YYYY-MM-DD value string; the en-US
    // 'May 30, 2026' the board shows is a DISPLAY format produced server-side,
    // not the input value.
    const localIso = '2026-06-02';
    await page.locator('#plannedStartAt').fill(localIso);
    await pickCombobox(page, 'customer', seed.customerName);
    await pickCombobox(page, 'cargo', seed.cargoName);
    // Picking the vehicle auto-fills the paired driver via the form's
    // bidirectional Số xe <-> Tài xế binding, so no explicit driver pick.
    await pickCombobox(page, 'vehiclePlate', seed.vehicleLabel);
    await page.locator('#pickupAt').fill(localIso);
    await pickCombobox(page, 'pickupWarehouse_1', seed.pickupName);
    await page.locator('#deliveryAt').fill(localIso);
    await pickCombobox(page, 'deliveryWarehouse_1', seed.deliveryName);
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();

    // Capture the server-assigned Số lệnh from the success banner so afterAll
    // can delete exactly this order (and so a failed create fails loudly here
    // rather than as a confusing missing-cell assertion below).
    const banner = page.getByRole('status').filter({ hasText: /XTT[.]/ });
    await expect(banner).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
    const bannerText = (await banner.textContent()) ?? '';
    const match = /XTT[.][0-9]+-[0-9]+/.exec(bannerText);
    if (!match) throw new Error('create banner carried no XTT external_ref: ' + bannerText);
    createdRef = match[0];

    // INVARIANT 1: the board renders a Khách hàng column header.
    await expect(
      page.getByRole('columnheader', { name: 'Khách hàng' }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });

    // INVARIANT 2: the created order's customer name shows in the board.
    await expect(
      page.getByRole('cell', { name: seed.customerName }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });

    // INVARIANT 3: the Trạng thái column is gone from the board.
    await expect(
      page.getByRole('columnheader', { name: 'Trạng thái' }),
    ).toHaveCount(0);
  });
});
