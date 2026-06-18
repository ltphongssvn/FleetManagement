// e2e/dispatch-board-khachhang-phone.spec.ts
// L0 ACCEPTANCE (2026): permanent business rule. In the Lệnh điều xe board,
// the Khách hàng column also displays the customer's Số điện thoại (phone).
//
// Critical user journey: the dispatcher sees the customer's phone number in the
//   Lệnh điều xe board next to the customer name.
// Business invariant: every board row whose order has a customer with a phone
//   renders that Số điện thoại in the board.
//
// Outside-in: this fails first because (a) the API board row carries no
// customerPhone and (b) the board renders no phone. It drives the API read-time
// customer-phone enrichment (L3/L4), the ops-web type + render (L1/L2), and the
// /reference/customers create accepting a phone so the seed can set one.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginAs, mintDispatcherToken } from './helpers/auth';
import { z } from 'zod';
import { parseJson, CreateDriverResponseSchema, ReferenceItemSchema, AssignmentResponseSchema } from './helpers/contracts';

const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
const ROW_VISIBILITY_BUDGET_MS = 15_000;

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
  customerName: string;
  customerPhone: string;
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
  const driverPhone = '09' + String(ts).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const customerPhone = '08' + String(ts).slice(-6) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const driverLabel = 'E2E DRIVER KHP ' + rand;
  const vehicleLabel = 'E2E-KHP-' + rand;
  const customerName = 'E2E-KHACH-' + rand;
  const cargoName = 'E2E-HANG-' + rand;
  const pickupName = 'E2E-PICKUP-' + rand;
  const deliveryName = 'E2E-DELIVERY-' + rand;

  const drv = await adminPost(
    api, token, '/admin/drivers',
    { fullName: driverLabel, phone: driverPhone, password: 'e2e-pass-1234' }, // pragma: allowlist secret
    CreateDriverResponseSchema,
  );
  const veh = await adminPost(api, token, '/reference/vehicles', { name: vehicleLabel }, ReferenceItemSchema);
  await adminPost(api, token, '/admin/driver-vehicle-assignments', { driverId: drv.driverId, vehicleId: veh.id }, AssignmentResponseSchema);
  await adminPost(api, token, '/reference/customers', { name: customerName, phone: customerPhone }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/cargo-types', { name: cargoName }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/warehouses', { name: pickupName, role: 'pickup' }, ReferenceItemSchema);
  await adminPost(api, token, '/reference/warehouses', { name: deliveryName, role: 'delivery' }, ReferenceItemSchema);

  return { token, customerName, customerPhone, cargoName, vehicleLabel, driverLabel, pickupName, deliveryName };
}

test.describe.serial('Lệnh điều xe board: Khách hàng shows Số điện thoại', () => {
  test('board displays the customer phone number for the order', async ({ page, request }) => {
    const seed = await seedAll(request);

    // Authenticate via injected session (PKCE login has no credential form).
    await loginAs(page);

    await expect(page.getByTestId('create-order-form')).toBeVisible({ timeout: 15_000 });

    const localIso = '2026-06-02T08:00';
    await page.locator('#plannedStartAt').fill(localIso);
    await pickCombobox(page, 'customer', seed.customerName);
    await pickCombobox(page, 'cargo', seed.cargoName);
    await pickCombobox(page, 'vehiclePlate', seed.vehicleLabel);
    await page.locator('#pickupAt').fill(localIso);
    await pickCombobox(page, 'pickupWarehouse_1', seed.pickupName);
    await page.locator('#deliveryAt').fill(localIso);
    await pickCombobox(page, 'deliveryWarehouse_1', seed.deliveryName);
    await page.getByRole('button', { name: 'Tạo lệnh' }).click();

    // INVARIANT 1: the created order's customer name shows in the board
    // (proves the row reconciled, so the phone assertion is meaningful).
    await expect(
      page.getByRole('cell', { name: seed.customerName }),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });

    // INVARIANT 2: the customer's Số điện thoại shows in the board.
    await expect(
      page.getByText(seed.customerPhone),
    ).toBeVisible({ timeout: ROW_VISIBILITY_BUDGET_MS });
  });
});
