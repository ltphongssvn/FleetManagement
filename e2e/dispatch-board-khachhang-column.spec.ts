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
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dockerExecNode } from './helpers/docker-exec';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const OPS_USER = process.env['E2E_OPS_USERNAME'] ?? 'dieuxe';
const OPS_PASS = process.env['E2E_OPS_PASSWORD'] ?? 'pw';
const ROW_VISIBILITY_BUDGET_MS = 15_000;
const DOLLAR = String.fromCharCode(36);
const POST_LOGIN_URL = new RegExp('/dispatch|/' + DOLLAR);

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

interface Seed {
  token: string;
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

  const drv = await adminPost<{ driverId: string; operatorId: string }>(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
  );
  const veh = await adminPost<{ id: string; label: string }>(api, token, '/reference/vehicles', { name: vehicleLabel });
  await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id });
  await adminPost(api, token, '/reference/customers', { name: customerName });
  await adminPost(api, token, '/reference/cargo-types', { name: cargoName });
  await adminPost(api, token, '/reference/warehouses', { name: pickupName, role: 'pickup' });
  await adminPost(api, token, '/reference/warehouses', { name: deliveryName, role: 'delivery' });

  return { token, customerName, cargoName, vehicleLabel, driverLabel, pickupName, deliveryName };
}

test.describe.serial('Lệnh điều xe board: Khách hàng column replaces Trạng thái', () => {
  test('board shows Khách hàng header + customer name, and no Trạng thái column', async ({ page, request }) => {
    const seed = await seedAll(request);

    await page.goto('/login');
    await page.getByLabel(/tên đăng nhập|username/i).fill(OPS_USER);
    await page.getByLabel(/mật khẩu|password/i).fill(OPS_PASS);
    await page.getByRole('button', { name: /đăng nhập|sign in|log in/i }).click();
    await expect(page).toHaveURL(POST_LOGIN_URL, { timeout: 10_000 });

    await expect(page.getByTestId('create-order-form')).toBeVisible({ timeout: 15_000 });

    // Fill the create-order form via the real UI (minimal happy path).
    // datetime-local inputs require a YYYY-MM-DDTHH:mm value string; the en-US
    // 'May 30, 2026' the board shows is a DISPLAY format produced server-side,
    // not the input value.
    const localIso = '2026-06-02T08:00';
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
